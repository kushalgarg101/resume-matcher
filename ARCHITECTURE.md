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
- `user_profiles` — structured resume data (skills, experience, education, etc.),
   filled by extraction on analysis or via agent chat.
- `chat_conversations` + `chat_messages` — agent session storage.
- `jobs` — normalised job listings from various sources.
- `applications` — user job applications with status pipeline.
- RLS policies: all tables scoped to `auth.uid() = user_id` for
  `select`/`insert`/`update`/`delete`. The `jobs` table is select-only for all
  authenticated users (shared feed). Updates are performed only by the worker
  via `service_role`, so no `update` policy for `authenticated` users on
  `analyses` (defence in depth).

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

## 6. Job aggregation system

The job aggregation layer (`app/jobs/`) is a modular source system designed for
easy extensibility:

- **Base class** (`sources/base.py`): an ABC defining `fetch()` → list of raw
  dicts and `normalized_job()` → `NormalizedJob`. Each source implements
  its own HTTP fetching and response parsing.
- **Source implementations**:
  - `arbeitnow.py` — REST API with pagination, native `location` field.
  - `jooble.py` — REST API with custom salary parser (`€50K`, `$1M`, `£40K`).
  - `adzuna.py` — REST API with salary normalisation.
  - `rss_source.py` — RSS/Atom feeds (RemoteOK, We Work Remotely, LinkedIn) with
    tag-based requirements parsing.
- **Fetcher** (`fetcher.py`): runs all sources concurrently, deduplicates by
  `source:external_id`, skips entries with `None` external IDs.
- **Sync** (`sync.py`): upserts to Supabase with conflict handling on the
  `(external_id, source)` unique index.
- **Periodic sync**: `main.py` spawns an `asyncio.create_task` that calls
  `sync_all_sources` via `asyncio.to_thread` every 6 hours. Triggers an
  on-demand sync when the jobs table is empty.
- **Design trade-off**: We accept occasional duplicates across sources (same
  job posted on RemoteOK and Jooble) in favour of simpler code. A content-based
  dedup (title + company hash) could be added later.

**Why not a single API?** No single free job board provides comprehensive
coverage. By supporting multiple sources with graceful degradation (missing API
keys just skip that source), we maximise the job feed quality while keeping the
system zero-cost.

## 7. Job matching (matcher_v2)

The `matcher_v2` service computes a 0–100 match score between a user profile
and a job listing:

| Component | Weight | Logic |
|-----------|--------|-------|
| Skills    | 60%    | Intersection-over-union of profile skills vs job requirements |
| Role      | 20%    | Keyword overlap with preferred roles |
| Location  | 10%    | Remote-friendly, location fuzzy match |
| Experience| 10%    | Years-of-experience proximity |

The breakdown is returned alongside matched/missing skill lists for transparency.

## 8. Profile extraction & agent chat

- **Profile extraction** (`profile_extraction.py`): called automatically after
  resume scoring. Uses Groq to parse resume text into structured fields (skills,
  experience, education, projects). Only fills empty fields to avoid overwriting
  user edits.
- **Chat agent** (`chat_agent.py`): a conversational interface powered by Groq
  that interactively fills and refines the user profile. The agent maintains
  conversation context and updates profile fields via function calls. This
  progressive-fill approach avoids overwhelming users with a long form.

## 9. Free-tier reliability tricks

- **Render sleep (15 min):** a GitHub Actions cron hits `/ping` every 14 min.
- **Supabase pause (7 days):** the same cron hits the REST endpoint, which
  resets the inactivity timer.
- These keep a live demo warm without paid tiers.

- **Worker cold start:** the keep-alive cron pings `/ping`, which only keeps the
  **web** service warm. The **worker** service stays spun-down until a job is
  enqueued; the first analysis after a long idle period therefore waits for the
  worker to boot (often 15–50s on the free tier). The client already polls for up
  to ~2.5 minutes to absorb this. No action needed for a demo.

## 10. Failure handling

- If extraction or the LLM fails, the worker sets `status = failed` and records a
  truncated `error_message` on the row — the user sees a clear failure instead of
  a hung spinner.
- Upload validation rejects non-PDF and oversized files before any processing.
- Job source failures are isolated: one source timing out doesn't block others.
  Errors are collected and reported in the sync result.
- Profile extraction is best-effort; if it fails, the analysis result is still
  saved and the profile extraction is simply skipped.

## 11. Testing strategy

- **Unit:** PDF extraction, JSON parsing/normalisation, LLM backoff (Groq mocked),
  salary parsing, JWKS verification.
- **Integration:** API routes with Supabase/Redis/Auth mocked via `TestClient` —
  verifies auth enforcement, validation, and the enqueue path without network.
- CI runs `ruff` + `pytest` on every push to `backend/`.

## 12. Possible extensions (good for follow-up interviews)

- Webhook / WebSocket push instead of polling.
- Caching: skip re-scoring identical (resume hash, JD hash) pairs.
- Batch mode: score one resume against many JDs.
- Add OAuth (Google) login — the schema/RLS already supports it.
- Metrics: track p95 scoring latency and Groq 429 rate in a dashboard.
- Job alerting: email/SMS notifications for new jobs matching saved filters.
- Content-based job deduplication (title + company hash across sources).
