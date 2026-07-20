from __future__ import annotations

import time
from typing import Any

from groq import Groq

from app.core.config import get_settings
from app.models.schemas import UserProfileOut

_OPTIMIZER_PROMPT = (
    "You are a professional resume writer. Given a candidate's profile and a job description, "
    "tailor the resume to highlight the most relevant skills and experience for this specific role. "
    "Keep all facts accurate — never fabricate experience or skills.\n\n"
    "Return ONLY a valid JSON object, no markdown, no commentary, with this exact shape:\n"
    "{\n"
    '  "summary": "A 2-3 sentence professional summary optimized for this job",\n'
    '  "skills": ["skill1", "skill2", ...],\n'
    '  "experience": [\n'
    '    {\n'
    '      "company": "...",\n'
    '      "role": "...",\n'
    '      "start_date": "...",\n'
    '      "end_date": "... or Present",\n'
    '      "description": "Rewritten to highlight relevant achievements (max 3 bullet points)",\n'
    '      "current": false\n'
    "    }\n"
    "  ],\n"
    '  "tailored_text": "Full tailored resume text ready for PDF generation"\n'
    "}\n\n"
    "Rules:\n"
    "- Reorder skills so the most relevant to this job appear first.\n"
    "- Reword experience descriptions to emphasize accomplishments relevant to the target role.\n"
    "- Do NOT add skills or experience the candidate doesn't have.\n"
    "- The tailored_text field should be a plain-text version of the full tailored resume."
)


def tailor_resume(
    profile: UserProfileOut,
    job: dict[str, Any],
    resume_text: str | None = None,
) -> dict[str, Any]:
    """
    Tailor a resume to a specific job description.

    Args:
        profile: The user's current profile.
        job: Job listing dict (title, company, description, requirements).
        resume_text: Optional raw resume text for additional context.

    Returns:
        dict with tailored profile fields: summary, skills, experience, tailored_text
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)

    skills_text = ", ".join(profile.skills[:20]) if profile.skills else "Not listed"
    exp_text = _format_experience(profile)

    user_prompt = (
        f"Candidate Profile:\n"
        f"Summary: {profile.summary or 'Not provided'}\n"
        f"Skills ({len(profile.skills)}): {skills_text}\n"
        f"Experience ({len(profile.experience)} entries):\n{exp_text}\n"
        f"\n"
        f"Target Job:\n"
        f"Title: {job.get('title', '')}\n"
        f"Company: {job.get('company_name', '')}\n"
        f"Description: {(job.get('description') or '')[:4000]}\n"
        f"Requirements: {', '.join(job.get('requirements', []) or [])[:1000]}\n"
    )
    if resume_text:
        user_prompt += f"\nFull Resume Text:\n{resume_text[:3000]}\n"

    user_prompt += "\nReturn the tailored JSON now."

    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": _OPTIMIZER_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                timeout=settings.groq_request_timeout,
            )
            content = response.choices[0].message.content or ""
            from app.services.llm import _extract_json_object
            result = _extract_json_object(content)

            skills = result.get("skills", profile.skills)
            if not isinstance(skills, list):
                skills = profile.skills

            experience_raw = result.get("experience", [])
            experience = []
            for exp_item in (experience_raw if isinstance(experience_raw, list) else []):
                if not isinstance(exp_item, dict):
                    continue
                exp_company = (exp_item.get("company") or "").strip().lower()
                exp_role = (exp_item.get("role") or "").strip().lower()
                orig = None
                for oe in profile.experience:
                    if oe.company.strip().lower() == exp_company and oe.role.strip().lower() == exp_role:
                        orig = oe
                        break
                experience.append({
                    "company": exp_item.get("company", orig.company if orig else ""),
                    "role": exp_item.get("role", orig.role if orig else ""),
                    "start_date": exp_item.get("start_date") or (orig.start_date if orig else None),
                    "end_date": exp_item.get("end_date") or (orig.end_date if orig else None),
                    "description": exp_item.get("description", orig.description if orig else ""),
                    "current": exp_item.get("current", orig.current if orig else False),
                })

            return {
                "summary": result.get("summary", profile.summary),
                "skills": skills,
                "experience": experience,
                "tailored_text": result.get("tailored_text", ""),
            }

        except Exception:
            if attempt < settings.groq_max_retries:
                time.sleep(min(2 ** (attempt - 1), 10.0))
                continue
            raise


def _format_experience(profile: UserProfileOut) -> str:
    lines = []
    for exp in (profile.experience or []):
        years = f"{exp.start_date or ''} - {exp.end_date or 'Present'}"
        desc = (exp.description or "")[:300]
        lines.append(f"- {exp.role} at {exp.company} ({years}): {desc}")
    return "\n".join(lines) if lines else "No formal experience listed."
