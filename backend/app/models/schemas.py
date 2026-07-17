"""
Pydantic models for API request/response bodies.

Keeping validation in one place means the API layer stays thin and the worker
can reuse the same response shape when it persists results.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class AnalysisCreate(BaseModel):
    """Payload for creating a new analysis (resume file handled separately)."""

    jd_text: str = Field(
        ..., min_length=10, max_length=20_000, description="Job description text"
    )


class MatchResult(BaseModel):
    """Structured output produced by the LLM and stored as result_json."""

    score: int = Field(..., ge=0, le=100, description="Overall match 0-100")
    matched_skills: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    rationale: str = Field(..., description="Short human-readable explanation")


class AnalysisOut(BaseModel):
    """Public representation of an analysis row."""

    id: str
    filename: str
    status: str
    result: MatchResult | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    completed_at: datetime | None = None
