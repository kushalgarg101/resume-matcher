# Architecture & System Design Notes

This document explains the *why* behind the design decisions — useful both for
maintaining the project and for discussing it in interviews.

## 1. Why separate API and Worker services?

The API must respond to the user in milliseconds; scoring a resume via an LLM
can take several seconds (and is rate-limited). Coupling them would block the
HTTP worker and waste Render's limited free request budget. Splitting into a
**web service** (accept + enqueue) and a **worker service** (do the slow work)
is the classic producer/consumer pattern:

- The API returns immediately with an analysis id (201 Created).
- The worker pulls jobs from Redis and updates Postgres when done.
- The client polls for completion (simple, no websockets needed for a demo).

On Render this costs **two** of the 25 free services plus a free Redis — still
$0. An alternative considered was `BackgroundTasks` in FastAPI (no extra service)
but that ties job lifetime to the request and doesn't survive restarts, so the
queue approach is more "real".

## 2. Why Redis holds only metadata, not the file

Render's free Redis is **25 MB** and ephemeral-ish. We never put the PDF bytes
in the job payload. The job carries `{analysis_id, storage_path, jd_text}`; the
worker re-downloads the PDF from Supabase Storage. Benefits:

- Tiny queue footprint → free Redis tier is plenty.
- Single source of truth for the file (Storage), not duplicated in Redis/disk.
- Render's filesystem is ephemeral, so we *cannot* rely on local file writes
  between the API upload and the worker read.

## 3. Authentication & authorization

- **Supabase Auth** provides email/password (no custom password hashing).
- The frontend gets a JWT and sends it as `Authorization: Bearer`.
- The API verifies the JWT locally (`app/core/jwt_verify.py`). It supports
  **both** signing setups Supabase uses:
  - **HS256** with the project's `SUPABASE_JWT_SECRET` (legacy/self-hosted).
  - **ES256/RS256** via the project's published JWKS
    (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`) for newer projects that
    use asymmetric "JWT Signing Keys".
  - In all cases it validates `iss` (= `<SUPABASE_URL>/auth/v1`),
    `aud` (`authenticated`), `exp`, `sub`, and asserts `role == "authenticated"`.
  - NOTE: Supabase user tokens carry `aud: "authenticated"`, **not** the anon
    key. We never verify with the anon key.
- **Row-Level Security** enforces that a user only sees/inserts *their* rows.
  The API uses a *user-scoped* Supabase client carrying the caller's JWT in the
  `Authorization` header, so RLS runs as that user.
- The **worker** uses the `service_role` key (bypasses RLS) — it is trusted code
  updating any row's result. That key is never sent to the browser. The
  enqueue-failure rollback also uses this admin client, because authenticated
  users intentionally have **no** UPDATE policy.

## 4. Database schema & RLS

- `profiles` (1:1 with `auth.users`, auto-created by trigger).
- `analyses` with a `status` state machine: `queued → processing → completed|failed`.
- RLS policies: `select`/`insert` scoped to `auth.uid() = user_id`. Updates are
  performed only by the worker via `service_role`, so no `update` policy for
  `authenticated` users (defence in depth).

## 5. LLM integration & rate limits

Groq's free tier is **30 RPM / ~6K TPM / 1K–14.4K RPD** (model-dependent). Design:

- One request per analysis, asking for a **single compact JSON object** to
  minimise tokens (staying under TPM).
- `response_format: json_object` plus a strict system prompt pins the shape.
- Robust extraction (`_extract_json_object`) handles markdown fences / trailing
  text, then `_normalise` validates and clamps fields.
- **Exponential backoff** on HTTP 429 / 5xx with `groq_max_retries`.
- Model is **env-configurable** (`GROQ_MODEL`) so you can swap 8B (high quota)
  vs 70B (stronger reasoning) without code changes.

## 6. Free-tier reliability tricks

- **Render sleep (15 min):** a GitHub Actions cron hits `/ping` every 14 min.
- **Supabase pause (7 days):** the same cron hits the REST endpoint, which
  resets the inactivity timer.
- These keep a live demo warm without paid tiers.

- **Worker cold start:** the keep-alive cron pings `/ping`, which only keeps the
  **web** service warm. The **worker** service stays spun-down until a job is
  enqueued; the first analysis after a long idle period therefore waits for the
  worker to boot (often 15–50s on the free tier). The client already polls for up
  to ~2.5 minutes to absorb this. No action needed for a demo.

## 7. Failure handling

- If extraction or the LLM fails, the worker sets `status = failed` and records a
  truncated `error_message` on the row — the user sees a clear failure instead of
  a hung spinner.
- Upload validation rejects non-PDF and oversized files before any processing.

## 8. Testing strategy

- **Unit:** PDF extraction, JSON parsing/normalisation, LLM backoff (Groq mocked).
- **Integration:** API routes with Supabase/Redis/Auth mocked via `TestClient` —
  verifies auth enforcement, validation, and the enqueue path without network.
- CI runs `ruff` + `pytest` on every push to `backend/`.

## 9. Possible extensions (good for follow-up interviews)

- Webhook / WebSocket push instead of polling.
- Caching: skip re-scoring identical (resume hash, JD hash) pairs.
- Batch mode: score one resume against many JDs.
- Add OAuth (Google) login — the schema/RLS already supports it.
- Metrics: track p95 scoring latency and Groq 429 rate in a dashboard.
