from __future__ import annotations

import json
import time

from groq import Groq

from app.core.config import get_settings
from app.models.schemas import SearchPlan

_PLANNER_PROMPT = (
    "You are a job search planner. Parse the user's natural language request into a structured search plan. "
    "Return ONLY a valid JSON object, no markdown, no commentary, with this exact shape:\n"
    "{\n"
    '  "roles": ["role1", "role2", ...],\n'
    '  "location": "city or null",\n'
    '  "salary_min": number or null,\n'
    '  "salary_max": number or null,\n'
    '  "remote": true/false/null,\n'
    '  "employment_type": "full-time|part-time|contract|null",\n'
    '  "experience_level": "entry|mid|senior|lead|null",\n'
    '  "max_applications": 10,\n'
    '  "suggestions": ["clarifying question 1", "clarifying question 2"]\n'
    "}\n"
    "Rules:\n"
    "- Extract roles/titles from the query as a list.\n"
    "- If location is mentioned, extract it. If not, set null.\n"
    "- Convert salary ranges to yearly numbers. '15 LPA' = 1500000, '10k/month' = 120000.\n"
    "- If remote work is implied (remote, wfh, hybrid), set remote accordingly.\n"
    "- If no specific max is mentioned, default to 10.\n"
    "- If the query is vague or has multiple interpretations, add suggestions for clarification.\n"
    "- Set fields to null if not mentioned rather than guessing."
)


def plan_search(query: str, profile: dict | None = None) -> dict:
    """
    Parse a natural language job search query into a structured search plan.

    Args:
        query: User's natural language request (e.g. "backend engineer jobs in Bangalore over 15 LPA")
        profile: Optional user profile dict for context (skills, preferred roles, locations)

    Returns:
        dict with "search_plan" (SearchPlan) and "suggestions" (list[str])
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)

    profile_context = ""
    if profile:
        profile_context = (
            f"\nUser profile context:\n"
            f"Skills: {', '.join(profile.get('skills', []) or [])}\n"
            f"Preferred roles: {', '.join(profile.get('preferred_roles', []) or [])}\n"
            f"Preferred locations: {', '.join(profile.get('preferred_locations', []) or [])}\n"
            f"Experience entries: {len(profile.get('experience', []) or [])}\n"
        )

    user_prompt = f"User request: {query}{profile_context}\nReturn the JSON plan now."

    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": _PLANNER_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                timeout=settings.groq_request_timeout,
            )
            content = response.choices[0].message.content or ""
            from app.services.llm import _extract_json_object
            raw = _extract_json_object(content)

            suggestions = raw.get("suggestions", [])
            plan_data = {k: raw.get(k) for k in [
                "roles", "location", "salary_min", "salary_max",
                "remote", "employment_type", "experience_level", "max_applications",
            ]}

            return {
                "search_plan": SearchPlan(**plan_data).model_dump(),
                "suggestions": suggestions,
            }

        except Exception as exc:
            if attempt < settings.groq_max_retries:
                time.sleep(min(2 ** (attempt - 1), 10.0))
                continue
            raise
