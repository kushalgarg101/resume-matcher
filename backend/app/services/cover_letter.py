from __future__ import annotations

import time
from typing import Any

from groq import Groq

from app.core.config import get_settings
from app.models.schemas import UserProfileOut
from app.services.llm import LLMError


def generate_cover_letter(
    profile: UserProfileOut,
    job: dict[str, Any],
    *,
    temperature: float = 0.4,
) -> str:
    """
    Generate a tailored cover letter using Groq.

    Args:
        profile: User's profile (skills, experience, etc.)
        job: Job listing dict (title, company, description)
        temperature: LLM temperature

    Returns:
        The generated cover letter text.

    Raises:
        LLMError: If generation fails.
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)

    name = profile.full_name or "Candidate"
    skills_text = ", ".join(profile.skills[:10]) if profile.skills else "various skills"
    exp_text = _format_experience(profile)

    system_prompt = (
        "You are a professional cover letter writer. Write a concise, authentic "
        "cover letter based on the candidate's profile and the job description. "
        "Keep it to 3-4 paragraphs. Use a professional tone. "
        "Do not use placeholders like [Your Name] — use the actual information provided."
    )

    user_prompt = (
        f"Candidate: {name}\n"
        f"Skills: {skills_text}\n"
        f"Experience:\n{exp_text}\n"
        f"\n"
        f"Job Title: {job.get('title', '')}\n"
        f"Company: {job.get('company_name', '')}\n"
        f"Description: {(job.get('description') or '')[:3000]}\n"
        f"\n"
        f"Write a tailored cover letter for this job."
    )

    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
                timeout=settings.groq_request_timeout,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            if attempt < settings.groq_max_retries:
                time.sleep(min(2 ** (attempt - 1), 10.0))
                continue
            raise LLMError(f"Cover letter generation failed: {exc}") from exc


def _format_experience(profile: UserProfileOut) -> str:
    """Format experience for the prompt."""
    lines = []
    for exp in (profile.experience or []):
        years = f"{exp.start_date or ''} - {exp.end_date or 'Present'}"
        desc = (exp.description or "")[:200]
        lines.append(f"- {exp.role} at {exp.company} ({years}): {desc}")
    return "\n".join(lines) if lines else "No formal experience listed."
