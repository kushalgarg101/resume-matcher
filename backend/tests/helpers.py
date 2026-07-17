"""Shared test helpers."""

from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def make_sample_pdf_text() -> str:
    """Return the text we expect a generated sample PDF to contain."""
    return (
        "Jane Doe\n"
        "Python Developer\n"
        "Skills: Python, FastAPI, PostgreSQL, Docker, Kubernetes\n"
        "Experience: 2 years building REST APIs."
    )


def build_sample_pdf_bytes() -> bytes:
    """Generate a minimal in-memory PDF containing known resume text."""
    text = make_sample_pdf_text()
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.drawString(72, 720, text)
    pdf.save()
    buffer.seek(0)
    return buffer.read()


def make_fake_pdf_bytes() -> bytes:
    """A non-PDF payload to test validation."""
    return b"not a real pdf"
