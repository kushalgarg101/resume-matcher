"""
Pydantic models for API request/response bodies.

Keeping validation in one place means the API layer stays thin and the worker
can reuse the same response shape when it persists results.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Existing analysis models ─────────────────────────────────────────────────

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


# ── Phase 1: Profile models ──────────────────────────────────────────────────

class Experience(BaseModel):
    company: str
    role: str
    start_date: str | None = None
    end_date: str | None = None
    description: str | None = None
    current: bool = False


class Education(BaseModel):
    institution: str
    degree: str | None = None
    field: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class Project(BaseModel):
    name: str
    description: str | None = None
    technologies: list[str] = Field(default_factory=list)
    url: str | None = None


class Certification(BaseModel):
    name: str
    issuer: str | None = None
    date: str | None = None
    url: str | None = None


class UserProfileUpdate(BaseModel):
    """Payload for updating profile fields. All fields optional — only set fields are changed."""

    full_name: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    portfolio_url: str | None = None
    skills: list[str] | None = None
    experience: list[Experience] | None = None
    education: list[Education] | None = None
    projects: list[Project] | None = None
    certifications: list[Certification] | None = None
    summary: str | None = None
    preferred_roles: list[str] | None = None
    preferred_locations: list[str] | None = None
    is_open_to_work: bool | None = None
    is_complete: bool | None = None


class UserProfileOut(BaseModel):
    """Public representation of a user profile."""

    id: str
    user_id: str
    full_name: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    portfolio_url: str | None = None
    skills: list[str] = Field(default_factory=list)
    experience: list[Experience] = Field(default_factory=list)
    education: list[Education] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    certifications: list[Certification] = Field(default_factory=list)
    summary: str | None = None
    preferred_roles: list[str] = Field(default_factory=list)
    preferred_locations: list[str] = Field(default_factory=list)
    is_open_to_work: bool = True
    is_complete: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ── Chat models ──────────────────────────────────────────────────────────────

class ChatMessageOut(BaseModel):
    """A single message in a conversation."""

    id: str
    role: str  # user | assistant
    content: str
    created_at: datetime | None = None


class ChatConversationOut(BaseModel):
    """Public representation of a conversation."""

    id: str
    status: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ChatRequest(BaseModel):
    """Send a message to the agent."""

    message: str = Field(..., min_length=1, max_length=2000)
    conversation_id: str | None = None  # None = start new


class ChatResponse(BaseModel):
    """Agent response to a chat message."""

    conversation_id: str
    message: ChatMessageOut
    profile: UserProfileOut | None = None  # current profile after any updates
    profile_complete: bool = False


# ── Phase 2: Job models ──────────────────────────────────────────────────────

class JobOut(BaseModel):
    """Public representation of a job listing."""

    id: str
    source: str
    title: str
    company_name: str
    company_logo: str | None = None
    location: str | None = None
    description: str | None = None
    requirements: list[str] = Field(default_factory=list)
    experience_level: str | None = None
    employment_type: str | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    currency: str | None = None
    application_url: str | None = None
    is_remote: bool = False
    posted_at: datetime | None = None
    created_at: datetime | None = None


class JobSearchParams(BaseModel):
    q: str | None = None
    source: str | None = None
    remote: bool | None = None
    location: str | None = None
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)


class JobListResponse(BaseModel):
    jobs: list[JobOut]
    total: int
    page: int
    per_page: int


class JobSyncResult(BaseModel):
    new: int = 0
    updated: int = 0
    errors: list[str] = Field(default_factory=list)


# ── Planner models ───────────────────────────────────────────────────────────

class SearchPlan(BaseModel):
    """Structured search plan produced by the planner agent."""

    roles: list[str] = Field(default_factory=list, description="Job titles/roles to search")
    location: str | None = Field(None, description="Target location (city, region)")
    salary_min: float | None = Field(None, ge=0, description="Minimum salary")
    salary_max: float | None = Field(None, ge=0, description="Maximum salary")
    remote: bool | None = Field(None, description="Remote preference")
    employment_type: str | None = Field(None, description="full-time, part-time, contract, etc.")
    experience_level: str | None = Field(None, description="entry, mid, senior, lead")
    max_applications: int = Field(10, ge=1, le=100, description="Max applications to process")


class PlannerRequest(BaseModel):
    """User's natural language query for the planner agent."""

    query: str = Field(..., min_length=3, max_length=1000, description="Natural language job search request")


class PlannerResponse(BaseModel):
    """Structured plan returned by the planner agent."""

    search_plan: SearchPlan
    suggestions: list[str] = Field(default_factory=list, description="Suggested refinements or clarifications")


# ── Optimized resume models ─────────────────────────────────────────────────

class OptimizedResumeOut(BaseModel):
    """A per-job tailored resume version."""

    id: str
    job_id: str
    storage_path: str
    summary: str | None = None
    skills: list[str] = Field(default_factory=list)
    created_at: datetime | None = None


class TailorResumeRequest(BaseModel):
    """Request to tailor a resume for a specific job."""

    job_id: str


class TailorResumeResponse(BaseModel):
    """Result of tailoring a resume."""

    optimized_resume: OptimizedResumeOut
    tailored_profile: dict[str, Any] = Field(default_factory=dict, description="Tailored profile fields")


# ── Phase 3: Match + Application models ──────────────────────────────────────

class MatchBreakdown(BaseModel):
    skills: int = 0
    role: int = 0
    location: int = 0
    experience: int = 0


class MatchDetails(BaseModel):
    matched_skills: list[str] = Field(default_factory=list)
    total_skills: int = 0
    job_title: str = ""
    is_remote: bool = False
    experience_count: int = 0


class JobMatchResult(BaseModel):
    score: int = Field(..., ge=0, le=100)
    breakdown: MatchBreakdown = Field(default_factory=MatchBreakdown)
    details: MatchDetails = Field(default_factory=MatchDetails)


class ApplicationCreate(BaseModel):
    job_id: str
    cover_letter: str | None = None
    notes: str | None = None


class ApplicationUpdate(BaseModel):
    status: str | None = None
    cover_letter: str | None = None
    notes: str | None = None
    tailored_resume_url: str | None = None
    email_thread_id: str | None = None
    match_score: int | None = None


class ApplicationOut(BaseModel):
    id: str
    job_id: str
    status: str
    cover_letter: str | None = None
    notes: str | None = None
    tailored_resume_url: str | None = None
    email_thread_id: str | None = None
    match_score: int | None = Field(None, ge=0, le=100)
    applied_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    job: JobOut | None = None


class CoverLetterRequest(BaseModel):
    job_id: str


class CoverLetterResponse(BaseModel):
    cover_letter: str


# ── Raw DB row helpers ───────────────────────────────────────────────────────

def profile_from_db(row: dict[str, Any]) -> UserProfileOut:
    """Convert a Supabase DB row to a UserProfileOut."""
    def _parse_list(raw: Any) -> list:
        if isinstance(raw, list):
            return raw
        return []

    def _parse_experience(raw: Any) -> list[Experience]:
        items = _parse_list(raw)
        return [Experience(**item) for item in items if isinstance(item, dict)]

    def _parse_education(raw: Any) -> list[Education]:
        items = _parse_list(raw)
        return [Education(**item) for item in items if isinstance(item, dict)]

    def _parse_projects(raw: Any) -> list[Project]:
        items = _parse_list(raw)
        return [Project(**item) for item in items if isinstance(item, dict)]

    def _parse_certs(raw: Any) -> list[Certification]:
        items = _parse_list(raw)
        return [Certification(**item) for item in items if isinstance(item, dict)]

    return UserProfileOut(
        id=str(row.get("id", "")),
        user_id=str(row.get("user_id", "")),
        full_name=row.get("full_name"),
        phone=row.get("phone"),
        location=row.get("location"),
        linkedin_url=row.get("linkedin_url"),
        portfolio_url=row.get("portfolio_url"),
        skills=_parse_list(row.get("skills", [])),
        experience=_parse_experience(row.get("experience", [])),
        education=_parse_education(row.get("education", [])),
        projects=_parse_projects(row.get("projects", [])),
        certifications=_parse_certs(row.get("certifications", [])),
        summary=row.get("summary"),
        preferred_roles=_parse_list(row.get("preferred_roles", [])),
        preferred_locations=_parse_list(row.get("preferred_locations", [])),
        is_open_to_work=row.get("is_open_to_work", True),
        is_complete=row.get("is_complete", False),
        created_at=_parse_dt(row.get("created_at")),
        updated_at=_parse_dt(row.get("updated_at")),
    )


def _parse_dt(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
    if isinstance(val, datetime):
        return val
    return None
