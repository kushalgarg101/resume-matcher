"""
PDF text extraction.

Extracts plain text from an uploaded resume PDF. Kept as a small, pure function
so it is trivially unit-testable without any external services. We cap the
number of pages read to avoid runaway memory on the 512 MB free tier.
"""

from __future__ import annotations

from io import BytesIO

from pdfminer.high_level import extract_text

# Guardrail: very long resumes are unusual; cap pages to bound memory/time.
MAX_PAGES = 20


def extract_pdf_text(pdf_bytes: bytes, max_pages: int = MAX_PAGES) -> str:
    """
    Extract text from a PDF given as raw bytes.

    Args:
        pdf_bytes: The raw PDF file contents.
        max_pages: Maximum pages to process (defensive bound).

    Returns:
        Extracted text. Empty string if nothing could be read.

    Raises:
        ValueError: If the input is not a valid PDF.
    """
    if not pdf_bytes.startswith(b"%PDF"):
        raise ValueError("Uploaded file does not look like a PDF (missing %PDF header).")

    # pdfminer's maxpages stops after N pages without erroring. A file that
    # starts with `%PDF` but is truncated/corrupt raises a pdfminer-specific
    # exception rather than returning empty text, so normalise it into a clear
    # ValueError the worker can store as a human-readable failure reason.
    try:
        text = extract_text(BytesIO(pdf_bytes), maxpages=max_pages) or ""
    except Exception as exc:  # noqa: BLE001 - normalise parser failures
        raise ValueError(f"Could not parse the resume PDF: {exc}") from exc
    return text.strip()
