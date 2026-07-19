"""
Supabase Storage helper.

Uploads and downloads resume PDFs in a private bucket. Files are stored under
`<user_id>/<analysis_id>.pdf` so paths are unguessable and scoping is obvious.
The worker downloads the bytes to extract text; the API only stores them.
"""

from __future__ import annotations

from app.core.config import get_settings
from app.core.supabase import get_admin_client


class StorageError(RuntimeError):
    """Raised when a Supabase Storage upload/download operation fails."""


def upload_resume(
    *, user_id: str, analysis_id: str, pdf_bytes: bytes
) -> str:
    """
    Upload a resume PDF to the private storage bucket.

    Args:
        user_id: Owner's uuid (used to namespace the path).
        analysis_id: The analysis uuid (used as the filename).
        pdf_bytes: Raw PDF contents.

    Returns:
        The storage path (e.g. "user_id/analysis_id.pdf") for later retrieval.

    Raises:
        StorageError: If the upload fails (e.g. bucket missing, permissions).
    """
    settings = get_settings()
    path = f"{user_id}/{analysis_id}.pdf"
    client = get_admin_client()
    try:
        client.storage.from_(settings.supabase_storage_bucket).upload(
            path=path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf", "upsert": False},
        )
    except Exception as exc:  # noqa: BLE001 - normalise storage failures
        raise StorageError(f"Failed to upload resume to storage: {exc}") from exc
    return path


def download_resume(*, storage_path: str) -> bytes:
    """
    Download a resume PDF from storage as raw bytes.

    Args:
        storage_path: Path returned by `upload_resume`.

    Returns:
        Raw PDF bytes. The caller (worker) is responsible for deletion if needed.

    Raises:
        StorageError: If the download fails or the object is missing.
    """
    client = get_admin_client()
    try:
        # download() returns bytes when no `destination` path is given.
        data = client.storage.from_(
            get_settings().supabase_storage_bucket
        ).download(storage_path)
    except Exception as exc:  # noqa: BLE001 - normalise storage failures
        raise StorageError(f"Failed to download resume from storage: {exc}") from exc
    if data is None:
        raise StorageError(f"Resume not found at storage path: {storage_path}")
    return data


def upload_tailored_resume(
    *,
    user_id: str,
    job_id: str,
    text: str,
) -> str:
    """
    Upload a tailored resume text to the private storage bucket.

    Args:
        user_id: Owner's uuid.
        job_id: The job uuid (used in the filename).
        text: The tailored resume text content.

    Returns:
        The storage path for later retrieval.
    """
    settings = get_settings()
    path = f"{user_id}/optimized/{job_id}.txt"
    client = get_admin_client()
    try:
        client.storage.from_(settings.supabase_storage_bucket).upload(
            path=path,
            file=text.encode("utf-8"),
            file_options={"content-type": "text/plain", "upsert": True},
        )
    except Exception as exc:
        raise StorageError(f"Failed to upload tailored resume: {exc}") from exc
    return path


def delete_resume(*, storage_path: str) -> None:
    """
    Delete a resume PDF from Storage (used to bound storage growth).

    Args:
        storage_path: Path previously returned by `upload_resume`.

    Raises:
        StorageError: If the delete fails.
    """
    client = get_admin_client()
    try:
        client.storage.from_(get_settings().supabase_storage_bucket).remove([storage_path])
    except Exception as exc:  # noqa: BLE001 - normalise storage failures
        raise StorageError(f"Failed to delete resume from storage: {exc}") from exc
