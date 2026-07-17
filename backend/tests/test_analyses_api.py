"""
Integration tests for the Analyses API.

We drive the real FastAPI app with TestClient but mock the heavy externals:
  - Supabase clients (storage + DB) via monkeypatching the factories
  - Redis/RQ queue via monkeypatching get_queue
  - Groq is not touched because the API only ENQUEUES a job; the worker (which
    calls Groq) is tested separately in test_llm.py / test_worker.py.
This verifies auth enforcement, request validation, and the enqueue path.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

# A fake but structurally valid Supabase JWT (HS256) signed with the anon key.
import jwt as _jwt


def _make_token(user_id: str, secret: str) -> str:
    """Build a structurally valid Supabase user JWT (HS256, aud=authenticated)."""
    import time as _time

    return _jwt.encode(
        {
            "sub": user_id,
            "iss": "https://example.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "exp": int(_time.time()) + 3600,
        },
        secret,
        algorithm="HS256",
    )


@pytest.fixture
def client(override_settings):
    # The JWT is verified with supabase_jwt_secret and must carry iss/aud.
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        supabase_storage_bucket="resumes",
        redis_url="redis://localhost:6379/0",
    )
    # Patch the Supabase client factories.
    admin = MagicMock()
    admin.storage.from_.return_value.upload.return_value = None
    admin.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        error=None
    )

    user_client = MagicMock()
    user_client.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "aid", "filename": "r.pdf", "status": "queued"}],
        error=None,
    )
    user_client.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
        data=[], error=None
    )
    # The list endpoint also chains `.limit(100)`; wire that branch too so the
    # auto-mocked select chain resolves either way.
    user_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[], error=None
    )

    with patch("app.services.storage.get_admin_client", return_value=admin), patch(
        "app.api.analyses.get_user_client", return_value=user_client
    ), patch("app.api.analyses.get_queue") as q:
        q.return_value.enqueue.return_value = None
        token = _make_token("uid", "jwt-secret-at-least-32-bytes-long-xxxxxxxxx")
        yield TestClient(app), token, user_client


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_create_analysis_requires_auth(client):
    tc, token, _ = client
    # No header -> 401
    resp = tc.post("/api/analyses", data={"jd_text": "need python"}, files={})
    assert resp.status_code == 401


def test_create_analysis_rejects_non_pdf_by_magic_bytes(client):
    # Content-type is no longer hard-rejected; the authoritative check is the
    # %PDF magic-byte test. A non-PDF payload must still be refused.
    tc, token, _ = client
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": "need python developer with fastapi"},
        files={"resume": ("r.txt", b"not pdf at all", "text/plain")},
    )
    assert resp.status_code == 400


def test_create_analysis_rejects_empty_upload(client):
    # A 0-byte body satisfies the `%PDF` prefix check, so it must be rejected
    # explicitly before any storage write.
    tc, token, _ = client
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": "need python developer with fastapi"},
        files={"resume": ("empty.pdf", b"", "application/pdf")},
    )
    assert resp.status_code == 400


def test_create_analysis_rejects_oversized_jd(client):
    # jd_text is bounded (max_length=20000) so a huge JD can't blow up request
    # memory or DB storage on the free tier.
    tc, token, _ = client
    big_jd = "need python developer with fastapi " * 2000  # ~48k chars
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": big_jd},
        files={"resume": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert resp.status_code == 422


def test_create_analysis_without_content_length_header(client):
    # Starlette/TestClient normally sets `size` from Content-Length. When it is
    # absent (size=None), the bounded read must still enforce the magic-byte
    # check rather than trusting a missing size.
    tc, token, _ = client
    pdf = b"%PDF-1.4 fake content"
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": "need python developer with fastapi and postgres"},
        files={"resume": ("resume.pdf", pdf, "application/octet-stream")},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "queued"


def test_create_analysis_accepts_pdf_sent_as_octet_stream(client):
    # Many real clients (curl, programmatic uploads) send application/octet-
    # stream for valid PDFs; we must accept them since the magic-byte check
    # confirms the contents.
    tc, token, user_client = client
    pdf = b"%PDF-1.4 fake content"
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": "need python developer with fastapi and postgres"},
        files={"resume": ("resume.pdf", pdf, "application/octet-stream")},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "queued"


def test_create_analysis_enqueues_and_returns_201(client):
    tc, token, user_client = client
    pdf = b"%PDF-1.4 fake content"
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": "need python developer with fastapi and postgres"},
        files={"resume": ("resume.pdf", pdf, "application/pdf")},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    # DB insert happened with the user's id.
    inserted = user_client.table.return_value.insert.call_args[0][0]
    assert inserted["user_id"] == "uid"
    assert inserted["storage_path"].startswith("uid/")


def test_get_analysis_not_found_returns_404(client):
    tc, token, user_client = client
    # make the select return empty
    user_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[], error=None
    )
    resp = tc.get("/api/analyses/does-not-exist", headers=_auth(token))
    assert resp.status_code == 404


def test_enqueue_passes_job_timeout(client):
    # RQ's default job timeout (180s) can kill a slow LLM+backoff run before our
    # except block finalises the row, leaving it stuck `processing`. The enqueue
    # must pass a generous job_timeout so the worker isn't SIGKILLed prematurely.
    # T7.
    tc, token, _ = client
    with patch("app.api.analyses.get_queue") as qmock:
        qmock.return_value.enqueue.return_value = None
        resp = tc.post(
            "/api/analyses",
            headers=_auth(token),
            data={"jd_text": "need python developer with fastapi and postgres"},
            files={"resume": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    assert resp.status_code == 201
    enqueue_kwargs = qmock.return_value.enqueue.call_args.kwargs
    assert enqueue_kwargs.get("job_timeout") == 600


def test_create_analysis_with_bad_token_is_401(client):
    tc, _token, _ = client
    # Token signed with wrong secret -> 401.
    bad = _make_token("uid", "wrong-secret-wrong-secret-wrong-secret-xxxx")
    resp = tc.post(
        "/api/analyses",
        headers=_auth(bad),
        data={"jd_text": "need python developer with fastapi and postgres"},
        files={"resume": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert resp.status_code == 401


def test_create_analysis_rejects_oversized_pdf(client, override_settings):
    # Tiny limit; a 2-byte body exceeds it. Re-specify the auth settings too,
    # since override_settings replaces the whole Settings instance.
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        supabase_storage_bucket="resumes",
        redis_url="redis://localhost:6379/0",
        max_pdf_bytes=1,
    )
    tc, token, _ = client
    resp = tc.post(
        "/api/analyses",
        headers=_auth(token),
        data={"jd_text": "need python developer with fastapi and postgres"},
        files={"resume": ("resume.pdf", b"AB", "application/pdf")},
    )
    assert resp.status_code == 413


def test_get_analysis_malformed_result_json_does_not_500(client):
    """A corrupt stored result_json must not crash the endpoint."""
    tc, token, user_client = client
    # Inject a row whose result_json is missing the required "score" field.
    corrupt_row = {
        "id": "aid",
        "filename": "r.pdf",
        "status": "completed",
        "result_json": {"matched_skills": ["X"]},  # missing score/rationale
        "error_message": None,
    }
    user_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[corrupt_row], error=None
    )
    resp = tc.get("/api/analyses/aid", headers=_auth(token))
    assert resp.status_code == 200
    # Malformed result is dropped rather than raising.
    assert resp.json()["result"] is None


def test_enqueue_failure_marks_row_failed(client):
    tc, token, user_client = client
    # The rollback uses the admin (service_role) client. Point the API's admin
    # factory at the same mock the fixture uses for storage so we can observe it.
    admin = MagicMock()
    admin.storage.from_.return_value.upload.return_value = None
    admin.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        error=None
    )
    # Make the queue enqueue raise so we exercise the rollback path.
    with patch("app.api.analyses.get_queue") as qmock, patch(
        "app.api.analyses.get_admin_client", return_value=admin
    ):
        qmock.return_value.enqueue.side_effect = RuntimeError("redis down")
        resp = tc.post(
            "/api/analyses",
            headers=_auth(token),
            data={"jd_text": "need python developer with fastapi and postgres"},
            files={"resume": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    assert resp.status_code == 502
    # The rollback must use the ADMIN (service_role) client, not the user-scoped
    # client — authenticated users have no UPDATE policy, so a user-scoped
    # update would be silently blocked by RLS and leave the row orphaned.
    user_update = user_client.table.return_value.update.call_args
    assert user_update is None, "rollback must NOT use the user-scoped client"
    admin_update = admin.table.return_value.update.call_args
    assert admin_update is not None, "expected an admin update call after enqueue error"
    update_payload = admin_update.args[0]
    assert update_payload.get("status") == "failed", (
        f"expected the analysis row to be marked failed, got {update_payload}"
    )


def test_insert_failure_cleans_up_storage(client, override_settings):
    tc, token, user_client = client
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        supabase_storage_bucket="resumes",
        redis_url="redis://localhost:6379/0",
    )
    # Make the DB insert report an error so we exercise the rollback path.
    user_client.table.return_value.insert.return_value.execute.return_value = MagicMock(
        error="unique violation", data=None
    )
    deleted = []

    def _fake_delete(*, storage_path: str) -> None:
        deleted.append(storage_path)

    with patch("app.api.analyses.delete_resume", side_effect=_fake_delete):
        resp = tc.post(
            "/api/analyses",
            headers=_auth(token),
            data={"jd_text": "need python developer with fastapi and postgres"},
            files={"resume": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    assert resp.status_code == 500
    # The already-uploaded PDF must be cleaned up from Storage.
    assert deleted, "expected the orphaned resume to be deleted after insert failure"


def test_get_analysis_happy_path_with_result(client):
    tc, token, user_client = client
    row = {
        "id": "aid",
        "filename": "r.pdf",
        "status": "completed",
        "result_json": {
            "score": 75,
            "matched_skills": ["Python"],
            "missing_skills": ["Go"],
            "rationale": "solid match",
        },
        "error_message": None,
    }
    user_client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[row], error=None
    )
    resp = tc.get("/api/analyses/aid", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "completed"
    assert body["result"]["score"] == 75
    assert body["result"]["matched_skills"] == ["Python"]


def test_list_analyses_happy_path(client):
    tc, token, user_client = client
    rows = [
        {
            "id": "a1",
            "filename": "r1.pdf",
            "status": "completed",
            "result_json": None,
            "error_message": None,
        },
        {
            "id": "a2",
            "filename": "r2.pdf",
            "status": "queued",
            "result_json": None,
            "error_message": None,
        },
    ]
    user_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=rows, error=None
    )
    resp = tc.get("/api/analyses", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert {a["id"] for a in body} == {"a1", "a2"}


def test_list_analyses_is_bounded(client):
    # Guard against pulling an unbounded payload on the free tier: the select
    # must apply a .limit(100) (T5).
    tc, token, user_client = client
    resp = tc.get("/api/analyses", headers=_auth(token))
    assert resp.status_code == 200
    limit_call = (
        user_client.table.return_value.select.return_value.eq.return_value.order.return_value.limit
    )
    assert limit_call.call_args == ((100,),)


def test_enqueue_failure_cleans_up_uploaded_pdf(client):
    # Mirroring the insert-failure path, an enqueue failure must roll back the
    # already-uploaded PDF so Storage doesn't accumulate orphaned objects.
    tc, token, user_client = client
    admin = MagicMock()
    admin.storage.from_.return_value.upload.return_value = None
    admin.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        error=None
    )
    deleted = []

    def _fake_delete(*, storage_path: str) -> None:
        deleted.append(storage_path)

    with patch("app.api.analyses.get_queue") as qmock, patch(
        "app.api.analyses.get_admin_client", return_value=admin
    ), patch("app.api.analyses.delete_resume", side_effect=_fake_delete):
        qmock.return_value.enqueue.side_effect = RuntimeError("redis down")
        resp = tc.post(
            "/api/analyses",
            headers=_auth(token),
            data={"jd_text": "need python developer with fastapi and postgres"},
            files={"resume": ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    assert resp.status_code == 502
    assert deleted, "expected the uploaded PDF to be cleaned up after enqueue failure"


def test_reap_marks_stuck_rows_failed(override_settings):
    # The internal reaper must flip long-stuck queued/processing rows to failed
    # via the admin client, and must be reachable with the internal key.
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        groq_api_key="x",
        internal_api_key="secret-reaper-key",
    )
    admin = MagicMock()
    admin.table.return_value.update.return_value.in_.return_value.lt.return_value.execute.return_value = MagicMock(
        data=[{"id": "stuck1"}, {"id": "stuck2"}], error=None
    )
    with patch("app.api.internal.get_admin_client", return_value=admin):
        from app.main import app
        from fastapi.testclient import TestClient

        tc = TestClient(app)
        resp = tc.post("/internal/reap", headers={"x-internal-key": "secret-reaper-key"})
    assert resp.status_code == 200
    assert resp.json()["reclaimed"] == 2
    # The reaper scopes the update to in-flight statuses only.
    in_call = admin.table.return_value.update.return_value.in_
    assert in_call.call_args == (("status", ["queued", "processing"]),)
    # The time filter must be an ABSOLUTE timestamp, not a SQL expression
    # (PostgREST quotes `now() - interval ...` as a literal string and matches
    # nothing). This guards against the reaper silently reclaiming zero rows.
    lt_call = admin.table.return_value.update.return_value.in_.return_value.lt
    col, value = lt_call.call_args[0]
    assert col == "updated_at"
    assert "now()" not in str(value) and "interval" not in str(value)
    # A valid ISO-8601 timestamp parses back via datetime.
    from datetime import datetime

    datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def test_reap_does_not_touch_fresh_rows(override_settings):
    # A recently-inserted (non-stuck) row must NOT be reaped, even if it is still
    # `queued`/`processing` — only rows untouched for >30 min are eligible. This
    # guards against an over-aggressive (or regressed) reaper.
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        groq_api_key="x",
        internal_api_key="secret-reaper-key",
        delete_resume_after_processing=True,
    )
    admin = MagicMock()
    # Simulate PostgREST returning zero rows because the fresh row is not stuck.
    admin.table.return_value.update.return_value.in_.return_value.lt.return_value.execute.return_value = MagicMock(
        data=[], error=None
    )
    deleted = []
    with patch("app.api.internal.get_admin_client", return_value=admin), patch(
        "app.api.internal.delete_resume", side_effect=lambda **kw: deleted.append(kw)
    ):
        from app.main import app
        from fastapi.testclient import TestClient

        tc = TestClient(app)
        resp = tc.post("/internal/reap", headers={"x-internal-key": "secret-reaper-key"})
    assert resp.status_code == 200
    assert resp.json()["reclaimed"] == 0
    assert deleted == [], "no PDF should be deleted when nothing was reaped"


def test_reap_deletes_pdfs_only_when_opt_in(override_settings):
    # When DELETE_RESUME_AFTER_PROCESSING is true, reaped rows' PDFs are deleted.
    # When false, they are kept (no deletion call).
    base = dict(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        groq_api_key="x",
        internal_api_key="secret-reaper-key",
    )
    stuck_rows = [
        {"id": "s1", "storage_path": "u1/s1.pdf"},
        {"id": "s2", "storage_path": "u2/s2.pdf"},
    ]

    def _run(opt_in: bool):
        override_settings(**base, delete_resume_after_processing=opt_in)
        admin = MagicMock()
        admin.table.return_value.update.return_value.in_.return_value.lt.return_value.execute.return_value = MagicMock(
            data=stuck_rows, error=None
        )
        deleted = []
        with patch("app.api.internal.get_admin_client", return_value=admin), patch(
            "app.api.internal.delete_resume", side_effect=lambda **kw: deleted.append(kw)
        ):
            from app.main import app
            from fastapi.testclient import TestClient

            tc = TestClient(app)
            tc.post("/internal/reap", headers={"x-internal-key": "secret-reaper-key"})
        return deleted

    assert len(_run(opt_in=True)) == 2, "opt-in should delete both reaped PDFs"
    assert _run(opt_in=False) == [], "opt-out should keep PDFs"


def test_reap_rejects_missing_key(override_settings):
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_jwt_secret="jwt-secret-at-least-32-bytes-long-xxxxxxxxx",
        supabase_service_key="svc-secret",
        groq_api_key="x",
        internal_api_key="secret-reaper-key",
    )
    from app.main import app
    from fastapi.testclient import TestClient

    tc = TestClient(app)
    resp = tc.post("/internal/reap")  # no key
    assert resp.status_code == 401


def test_app_boots_without_jwt_secret(override_settings):
    # Newer Supabase projects use asymmetric (JWKS) signing and leave the legacy
    # JWT secret blank. The service must still boot in that configuration.
    override_settings(
        supabase_url="https://example.supabase.co",
        supabase_anon_key="anon-secret",
        supabase_service_key="svc-secret",
        supabase_jwt_secret="",  # asymmetric-only project
        groq_api_key="x",
        cors_allow_origins="http://localhost:3000",
    )
    from app.main import create_app

    app = create_app()
    # Entering the lifespan must not raise (the boot check no longer requires
    # SUPABASE_JWT_SECRET).
    import asyncio

    async def _enter():
        async with app.router.lifespan_context(app):
            return True

    assert asyncio.run(_enter()) is True
