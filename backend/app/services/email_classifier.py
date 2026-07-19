from __future__ import annotations

import time
from typing import Any

from groq import Groq

from app.core.config import get_settings

_CLASSIFIER_PROMPT = (
    "You are an email classifier for a job application tracking system. "
    "Given an email subject and body, classify it into one of these categories:\n"
    "- rejection: The candidate was rejected for a role\n"
    "- interview: Interview invitation or scheduling\n"
    "- offer: Job offer extended\n"
    "- screening: Assessment, coding test, or screening call request\n"
    "- application_ack: Automated acknowledgement of application receipt\n"
    "- other: Not related to a job application (spam, newsletter, etc.)\n\n"
    "Also extract:\n"
    "- company_name: The company that sent the email (or null if unclear)\n"
    "- job_title: The role mentioned (or null if unclear)\n"
    "- sender_name: The person who sent it (or null if automated)\n\n"
    "Return ONLY a JSON object, no markdown, no commentary:\n"
    "{\n"
    '  "category": "rejection|interview|offer|screening|application_ack|other",\n'
    '  "confidence": 0.0-1.0,\n'
    '  "company_name": "string or null",\n'
    '  "job_title": "string or null",\n'
    '  "sender_name": "string or null",\n'
    '  "summary": "one-sentence summary of the email"\n'
    "}"
)


def classify_email(subject: str, body: str) -> dict[str, Any]:
    """
    Classify an email related to job applications.

    Args:
        subject: Email subject line.
        body: Email body text (first 2000 chars).

    Returns:
        dict with category, confidence, company_name, job_title, sender_name, summary.
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)

    truncated_body = body[:2000]
    user_prompt = f"Subject: {subject}\n\nBody:\n{truncated_body}\n\nClassify this email."

    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = client.chat.completions.create(
                model=settings.groq_model,
                messages=[
                    {"role": "system", "content": _CLASSIFIER_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                timeout=settings.groq_request_timeout,
            )
            content = response.choices[0].message.content or ""
            from app.services.llm import _extract_json_object
            result = _extract_json_object(content)

            return {
                "category": result.get("category", "other"),
                "confidence": float(result.get("confidence", 0)),
                "company_name": result.get("company_name"),
                "job_title": result.get("job_title"),
                "sender_name": result.get("sender_name"),
                "summary": result.get("summary", ""),
            }

        except Exception as exc:
            if attempt < settings.groq_max_retries:
                time.sleep(min(2 ** (attempt - 1), 10.0))
                continue
            return {
                "category": "other",
                "confidence": 0.0,
                "company_name": None,
                "job_title": None,
                "sender_name": None,
                "summary": f"Classification failed: {exc}",
            }
