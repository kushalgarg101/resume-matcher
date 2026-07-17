"""Tests for PDF text extraction (no external services required)."""

from __future__ import annotations

import pytest

from app.services.pdf_extract import extract_pdf_text
from tests.helpers import build_sample_pdf_bytes, make_fake_pdf_bytes


def test_extract_returns_known_text():
    pdf = build_sample_pdf_bytes()
    text = extract_pdf_text(pdf)
    assert "Python" in text
    assert "FastAPI" in text
    # pdfminer encodes newlines inside drawString as literal 'n', so check the
    # meaningful keywords rather than exact whitespace.
    for token in ("Jane Doe", "Python Developer", "PostgreSQL", "Kubernetes", "REST APIs"):
        assert token in text


def test_extract_rejects_non_pdf():
    with pytest.raises(ValueError):
        extract_pdf_text(make_fake_pdf_bytes())


def test_extract_corrupt_pdf_raises_clear_valueerror():
    # A payload that starts with `%PDF` but is truncated/corrupt should raise a
    # clean ValueError (not leak a raw pdfminer exception). T6.
    corrupt = b"%PDF-1.4 truncated garbage with no proper structure"
    with pytest.raises(ValueError):
        extract_pdf_text(corrupt)
