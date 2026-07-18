from __future__ import annotations

from typing import Any


def compute_match(profile: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    """
    Compute a match score (0-100) between a user profile and a job.

    Uses multi-factor scoring:
      - Skills overlap (40%)
      - Role title similarity (30%)
      - Location / remote match (15%)
      - Experience presence (15%)

    Returns a breakdown dict with score + per-factor details.
    """
    scores: dict[str, float] = {}
    details: dict[str, Any] = {}

    # 1. Skills match (40%)
    profile_skills = _norm_set(profile.get("skills", []) or [])
    job_text = _job_text(job)
    matched_skills = [s for s in profile_skills if s in job_text]
    skills_weight = 40
    skills_score = (len(matched_skills) / max(len(profile_skills), 1)) * skills_weight if profile_skills else 0
    scores["skills"] = skills_score
    details["matched_skills"] = matched_skills
    details["total_skills"] = len(profile_skills)

    # 2. Role match (30%)
    preferred_roles = _norm_list(profile.get("preferred_roles", []) or [])
    job_title = (job.get("title") or "").lower().strip()
    role_weight = 30

    if preferred_roles and job_title:
        title_words = set(job_title.split())
        role_score = 0
        for role in preferred_roles:
            role_words = set(role.split())
            overlap = len(title_words & role_words)
            ratio = overlap / max(len(title_words | role_words), 1)
            role_score = max(role_score, ratio)
        role_score = role_score * role_weight
    else:
        role_score = role_weight * 0.5  # neutral if no preferences set

    scores["role"] = role_score
    details["job_title"] = job_title

    # 3. Location match (15%)
    preferred_locations = _norm_list(profile.get("preferred_locations", []) or [])
    job_location = (job.get("location") or "").lower().strip()
    is_remote = job.get("is_remote", False)
    loc_weight = 15

    if is_remote:
        loc_score = loc_weight  # remote always matches
    elif job_location and preferred_locations:
        loc_score = 0
        for loc in preferred_locations:
            if loc in job_location or job_location in loc:
                loc_score = loc_weight
                break
    else:
        loc_score = loc_weight * 0.5  # neutral

    scores["location"] = loc_score
    details["is_remote"] = is_remote

    # 4. Experience presence (15%)
    exp_list = profile.get("experience", []) or []
    exp_weight = 15
    exp_score = min(len(exp_list) / 3, 1.0) * exp_weight
    scores["experience"] = exp_score
    details["experience_count"] = len(exp_list)

    breakdown = {
        "skills": round(scores["skills"]),
        "role": round(scores["role"]),
        "location": round(scores["location"]),
        "experience": round(scores["experience"]),
    }
    total = max(0, min(100, sum(breakdown.values())))

    return {
        "score": total,
        "breakdown": breakdown,
        "details": details,
    }


def _norm_set(items: list) -> set[str]:
    return {str(s).strip().lower() for s in items if s}


def _norm_list(items: list) -> list[str]:
    return [str(s).strip().lower() for s in items if s]


def _job_text(job: dict[str, Any]) -> str:
    """Combine all searchable job text into a single lowercase string."""
    parts = [
        job.get("title") or "",
        job.get("description") or "",
        job.get("company_name") or "",
    ]
    parts.extend(job.get("requirements", []) or [])
    return " ".join(parts).lower()
