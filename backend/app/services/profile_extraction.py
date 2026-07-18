from __future__ import annotations

from typing import Any

from groq import Groq

from app.core.config import get_settings
from app.services.llm import _extract_json_object, LLMError

_EXTRACT_PROMPT = (
    "You are a resume parser. Extract structured information from the following "
    "resume text. Return ONLY a valid JSON object, no markdown, no commentary, "
    "with this exact shape:\n"
    "{\n"
    '  "full_name": "<full name or null>",\n'
    '  "phone": "<phone or null>",\n'
    '  "location": "<city, state or null>",\n'
    '  "linkedin_url": "<full LinkedIn URL or null>",\n'
    '  "portfolio_url": "<portfolio/github URL or null>",\n'
    '  "skills": ["skill1", "skill2", ...],\n'
    '  "experience": [\n'
    '    {\n'
    '      "company": "...",\n'
    '      "role": "...",\n'
    '      "start_date": "...",\n'
    '      "end_date": "... or Present",\n'
    '      "description": "...",\n'
    '      "current": false\n'
    "    }\n"
    "  ],\n"
    '  "education": [\n'
    '    {\n'
    '      "institution": "...",\n'
    '      "degree": "...",\n'
    '      "field": "...",\n'
    '      "start_date": "...",\n'
    '      "end_date": "..."\n'
    "    }\n"
    "  ],\n"
    '  "projects": [\n'
    '    {\n'
    '      "name": "...",\n'
    '      "description": "...",\n'
    '      "technologies": ["..."]\n'
    "    }\n"
    "  ],\n"
    '  "certifications": [\n'
    '    {\n'
    '      "name": "...",\n'
    '      "issuer": "...",\n'
    '      "date": "..."\n'
    "    }\n"
    "  ],\n"
    '  "summary": "<2-3 sentence professional summary or null>"\n'
    "}\n"
    'Set unknown fields to null. Omit empty arrays — use null. Be thorough: extract as many skills as you can find.'
)


def extract_profile(resume_text: str) -> dict[str, Any]:
    """
    Extract structured profile from resume text using Groq.

    Returns a dict matching the prompt schema, or raises LLMError.
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)

    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": _EXTRACT_PROMPT},
                    {"role": "user", "content": resume_text[:8000]},
                ],
                temperature=0.1,
                timeout=settings.groq_request_timeout,
            )
            content = response.choices[0].message.content or ""
            raw = _extract_json_object(content)

            # Ensure top-level fields exist
            result: dict[str, Any] = {
                "full_name": raw.get("full_name"),
                "phone": raw.get("phone"),
                "location": raw.get("location"),
                "linkedin_url": raw.get("linkedin_url"),
                "portfolio_url": raw.get("portfolio_url"),
                "skills": raw.get("skills") or [],
                "experience": raw.get("experience") or [],
                "education": raw.get("education") or [],
                "projects": raw.get("projects") or [],
                "certifications": raw.get("certifications") or [],
                "summary": raw.get("summary"),
            }
            return result

        except Exception as exc:
            if attempt < settings.groq_max_retries:
                import time
                time.sleep(min(2 ** (attempt - 1), 10.0))
                continue
            raise LLMError(f"Profile extraction failed: {exc}") from exc
