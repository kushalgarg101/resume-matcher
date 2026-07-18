from __future__ import annotations

import json
import time
from typing import Any

from groq import Groq

from app.core.config import get_settings

_SYSTEM_PROMPT = (
    "You are a career assistant helping a job seeker build their profile.\n\n"
    "Available tools:\n"
    "- update_profile(data: object): Update profile fields with a JSON object.\n"
    "  Supported fields: full_name, phone, location, linkedin_url, portfolio_url, "
    "skills (string array), experience (array of {company, role, start_date, end_date, description, current}), "
    "education (array of {institution, degree, field, start_date, end_date}), "
    "projects (array of {name, description, technologies}), "
    "certifications (array of {name, issuer, date}), "
    "summary, preferred_roles, preferred_locations, is_open_to_work.\n"
    "- get_missing_fields(): Returns fields that are empty or incomplete.\n"
    "- mark_profile_complete(): Call when the core fields are filled.\n\n"
    "Guidelines:\n"
    "- Be natural and conversational. Ask 1-2 questions per turn.\n"
    "- After the user provides info, call update_profile immediately.\n"
    "- Focus on skills, experience, and summary first.\n"
    "- If the user's answer is vague, ask for specifics.\n"
    "- Once core fields are done, offer to mark the profile complete."
)

_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "update_profile",
            "description": "Update one or more fields in the user's profile. Only include fields that changed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "data": {
                        "type": "object",
                        "description": "Profile fields to update. Include only fields that changed.",
                        "properties": {
                            "full_name": {"type": "string"},
                            "phone": {"type": "string"},
                            "location": {"type": "string"},
                            "linkedin_url": {"type": "string"},
                            "portfolio_url": {"type": "string"},
                            "skills": {"type": "array", "items": {"type": "string"}},
                            "experience": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "company": {"type": "string"},
                                        "role": {"type": "string"},
                                        "start_date": {"type": "string"},
                                        "end_date": {"type": "string"},
                                        "description": {"type": "string"},
                                        "current": {"type": "boolean"},
                                    },
                                    "required": ["company", "role"],
                                },
                            },
                            "education": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "institution": {"type": "string"},
                                        "degree": {"type": "string"},
                                        "field": {"type": "string"},
                                        "start_date": {"type": "string"},
                                        "end_date": {"type": "string"},
                                    },
                                    "required": ["institution"],
                                },
                            },
                            "projects": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "description": {"type": "string"},
                                        "technologies": {"type": "array", "items": {"type": "string"}},
                                    },
                                    "required": ["name"],
                                },
                            },
                            "certifications": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                        "issuer": {"type": "string"},
                                        "date": {"type": "string"},
                                    },
                                    "required": ["name"],
                                },
                            },
                            "summary": {"type": "string"},
                            "preferred_roles": {"type": "array", "items": {"type": "string"}},
                            "preferred_locations": {"type": "array", "items": {"type": "string"}},
                            "is_open_to_work": {"type": "boolean"},
                        },
                    }
                },
                "required": ["data"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_missing_fields",
            "description": "Get a list of important profile fields that are empty or incomplete.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_profile_complete",
            "description": "Mark the profile as complete and ready for job matching.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]


def process_message(
    *,
    message: str,
    profile: dict[str, Any],
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """
    Process a user message and return the agent response.

    Args:
        message: The user's message text.
        profile: Current profile dict.
        history: Previous messages [{role, content}, ...] for context.

    Returns:
        {
            "reply": str,                          # The agent's text response
            "profile_updates": dict | None,         # Profile fields to update
            "profile_complete": bool,                # True if agent marked complete
            "missing_fields": list[str] | None,      # Result of get_missing_fields
        }
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)

    result: dict[str, Any] = {
        "reply": "",
        "profile_updates": None,
        "profile_complete": False,
        "missing_fields": None,
    }

    # Build messages array
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
    ]
    # Add recent history (last 6 messages for context)
    if history:
        for msg in history[-6:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
    # Add profile context + new user message
    profile_context = _profile_to_context(profile)
    messages.append({"role": "user", "content": f"Current profile:\n{profile_context}\n\nUser: {message}"})

    # Send to LLM
    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=messages,
                tools=_TOOLS,
                tool_choice="auto",
                temperature=0.3,
                timeout=settings.groq_request_timeout,
            )
            break
        except Exception as exc:
            if attempt < settings.groq_max_retries:
                time.sleep(min(2 ** (attempt - 1), 10.0))
                continue
            result["reply"] = f"Sorry, I'm having trouble connecting. Please try again. ({exc})"
            return result

    if not response.choices:
        result["reply"] = "Sorry, I received an empty response. Please try again."
        return result
    choice = response.choices[0]
    reply = choice.message.content or ""

    # Start with the current profile, then apply any updates so tool results
    # (e.g. get_missing_fields) reflect the new state even when called alongside
    # update_profile in the same turn.
    working_profile = dict(profile)
    update_data: dict[str, Any] = {}

    if choice.message.tool_calls:
        for tc in choice.message.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments)
            except json.JSONDecodeError:
                fn_args = {}

            if fn_name == "update_profile":
                data = fn_args.get("data", fn_args)
                update_data.update(data)
                result["profile_updates"] = update_data
                working_profile.update(data)

            elif fn_name == "get_missing_fields":
                result["missing_fields"] = _find_missing(working_profile)

            elif fn_name == "mark_profile_complete":
                result["profile_complete"] = True

        # If LLM provided only tool calls with no text, generate follow-up
        if not reply.strip():
            messages.append(choice.message.model_dump())
            for tc in choice.message.tool_calls:
                tool_result_content = ""
                fn_name = tc.function.name
                if fn_name == "update_profile":
                    tool_result_content = "Profile updated."
                elif fn_name == "get_missing_fields":
                    mf = result['missing_fields']
                    tool_result_content = f"Missing fields: {json.dumps(mf) if mf is not None else '[]'}"
                elif fn_name == "mark_profile_complete":
                    tool_result_content = "Profile marked as complete."
                if tool_result_content:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result_content,
                    })

            for attempt2 in range(1, settings.groq_max_retries + 1):
                try:
                    follow_up = client.chat.completions.create(
                        model=settings.groq_model,
                        messages=messages,
                        tools=_TOOLS,
                        tool_choice="none",
                        temperature=0.3,
                        timeout=settings.groq_request_timeout,
                    )
                    reply = follow_up.choices[0].message.content or "" if follow_up.choices else ""
                    break
                except Exception:
                    if attempt2 < settings.groq_max_retries:
                        time.sleep(min(2 ** (attempt2 - 1), 5.0))
                        continue
                    reply = "I've updated your profile. What else would you like to add?"

    result["reply"] = reply
    return result


def _find_missing(profile: dict[str, Any]) -> list[str]:
    """Find important fields that are empty."""
    missing = []
    if not profile.get("skills"):
        missing.append("skills")
    if not profile.get("experience"):
        missing.append("experience")
    if not profile.get("summary"):
        missing.append("summary")
    if not profile.get("full_name"):
        missing.append("full_name")
    if not profile.get("location"):
        missing.append("location")
    return missing


def _profile_to_context(profile: dict[str, Any]) -> str:
    """Format profile as a readable string for the LLM context."""
    lines = []
    if profile.get("full_name"):
        lines.append(f"Name: {profile['full_name']}")
    if profile.get("location"):
        lines.append(f"Location: {profile['location']}")
    skills = profile.get("skills") or []
    if skills:
        lines.append(f"Skills ({len(skills)}): {', '.join(skills)}")
    else:
        lines.append("Skills: (none yet)")
    exp = profile.get("experience") or []
    if exp:
        lines.append(f"Experience ({len(exp)} entries):")
        for e in exp:
            lines.append(f"  - {e.get('role', '?')} at {e.get('company', '?')}")
    else:
        lines.append("Experience: (none yet)")
    if profile.get("summary"):
        lines.append(f"Summary: {profile['summary'][:100]}...")
    if profile.get("preferred_roles"):
        lines.append(f"Preferred roles: {', '.join(profile['preferred_roles'])}")
    return "\n".join(lines)
