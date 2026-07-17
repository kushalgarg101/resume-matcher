"""Tests for the Supabase Storage helper using a mocked admin client.

We patch `get_admin_client` so no real network/Supabase call is made — this
keeps the suite fast, offline, and free-tier safe.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.services import storage as storage_mod


@pytest.fixture
def fake_bucket():
    """Mock the storage bucket and the client returned by get_admin_client."""
    bucket = MagicMock()
    client = MagicMock()
    client.storage.from_.return_value = bucket
    with pytest.MonkeyPatch().context() as mp:
        mp.setattr(storage_mod, "get_admin_client", lambda: client)
        yield bucket


def test_upload_resume_builds_namespaced_path(fake_bucket, override_settings):
    override_settings(supabase_storage_bucket="resumes")
    path = storage_mod.upload_resume(
        user_id="u1", analysis_id="a1", pdf_bytes=b"%PDF-1.4 fake"
    )
    assert path == "u1/a1.pdf"
    fake_bucket.upload.assert_called_once()


def test_upload_resume_passes_boolean_upsert(fake_bucket, override_settings):
    override_settings(supabase_storage_bucket="resumes")
    storage_mod.upload_resume(user_id="u1", analysis_id="a1", pdf_bytes=b"%PDF-1.4")
    _, kwargs = fake_bucket.upload.call_args
    assert kwargs["file_options"]["upsert"] is False


def test_download_resume_returns_bytes(fake_bucket, override_settings):
    override_settings(supabase_storage_bucket="resumes")
    fake_bucket.download.return_value = b"%PDF-1.4 fake"
    data = storage_mod.download_resume(storage_path="u1/a1.pdf")
    assert data == b"%PDF-1.4 fake"
    fake_bucket.download.assert_called_once_with("u1/a1.pdf")


def test_download_resume_missing_raises(fake_bucket, override_settings):
    override_settings(supabase_storage_bucket="resumes")
    fake_bucket.download.return_value = None
    with pytest.raises(storage_mod.StorageError):
        storage_mod.download_resume(storage_path="u1/missing.pdf")
