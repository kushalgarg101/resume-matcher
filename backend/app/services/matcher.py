"""
Matcher orchestration.

High-level pipeline used by the RQ worker: given a stored resume's bytes and the
job description, produce a MatchResult. Kept separate from the LLM module so the
worker's flow is easy to follow and unit-test with a faked LLM.
"""

from __future__ import annotations

from app.models.schemas import MatchResult
from app.services import llm
from app.services.pdf_extract import extract_pdf_text


def run_match(*, pdf_bytes: bytes, jd_text: str) -> MatchResult:
    """
    Extract text from the resume PDF and score it against the JD.

    Args:
        pdf_bytes: Raw resume PDF.
        jd_text: Job description text.

    Returns:
        A validated MatchResult (score, matched/missing skills, rationale).
    """
    resume_text = extract_pdf_text(pdf_bytes)
    if not resume_text:
        raise ValueError("Could not extract any text from the resume PDF.")
    return llm.score_match(resume_text=resume_text, jd_text=jd_text)
