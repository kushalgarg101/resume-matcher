"""
LLM scoring service (Groq).

This module is the "ML" core: it sends the resume text + job description to a
Groq-hosted open-weight model and asks for a strict JSON match report.

Design notes (important for interviews):
- Groq free tier is rate-limited (30 RPM / ~6K TPM / 1K-14.4K RPD). We therefore
  (a) request a single compact JSON object to minimise tokens, and
  (b) retry with exponential backoff when we hit 429 / 5xx.
- We never trust the model to return clean JSON, so we robustly extract the
  first JSON object from the response and validate it against our schema.
- The model id is configurable via GROQ_MODEL (see .env.example) so you can swap
  8B (high quota) vs 70B (stronger reasoning) without code changes.
"""

from __future__ import annotations

import json
import time
from typing import Any

from groq import APIConnectionError, APIStatusError, BadRequestError, Groq

from app.core.config import Settings, get_settings
from app.models.schemas import MatchResult

# System prompt: frames the model as a rigorous technical recruiter and pins
# the exact JSON shape we expect back.
_SYSTEM_PROMPT = (
    "You are a rigorous technical recruiter. Given a candidate's resume and a "
    "job description, assess how well the candidate matches the role. "
    "Respond with ONLY a single JSON object, no markdown, no commentary, with "
    "this exact shape:\n"
    "{\n"
    '  "score": <integer 0-100, overall match>,\n'
    '  "matched_skills": [<string>, ...],\n'
    '  "missing_skills": [<string>, ...],\n'
    '  "rationale": "<short explanation of the score>"\n'
    "}\n"
    "Be objective. Only list skills explicitly present in the resume under "
    "matched_skills, and skills required by the job but absent under "
    "missing_skills."
)

# We no longer use a greedy regex; see `_extract_json_object` which scans for
# the first balanced {...} block (handles nested objects and trailing text).

_OPEN = {"{", "["}
_CLOSE = {"}", "]"}


class LLMError(RuntimeError):
    """Raised when the LLM call ultimately fails after retries."""


def _build_user_prompt(resume_text: str, jd_text: str) -> str:
    """Compose the user message from resume + JD, with length guards."""
    # Truncate to keep within typical context windows and token budgets.
    resume = resume_text[:6000]
    jd = jd_text[:4000]
    return (
        f"# Job Description\n{jd}\n\n"
        f"# Resume\n{resume}\n\n"
        "Return the JSON match report now."
    )


def _extract_json_object(content: str) -> dict[str, Any]:
    """
    Extract and parse the first balanced JSON object from an LLM response.

    Models sometimes wrap JSON in markdown fences (```json ... ```) or add
    trailing commentary. We scan for the first `{` and track nesting depth so we
    capture exactly one complete object, then parse it. Raises ValueError if no
    complete object is found.
    """
    start = content.find("{")
    if start == -1:
        raise ValueError(f"No JSON object found in LLM response: {content[:200]!r}")

    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(content)):
        ch = content[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in _OPEN:  # opening { or [
            depth += 1
        elif ch in _CLOSE:  # closing } or ]
            depth -= 1
        if depth == 0:
            candidate = content[start : i + 1]
            parsed = json.loads(candidate)
            # Some models wrap the object in a single-element array; unwrap it.
            if isinstance(parsed, list):
                objects = [item for item in parsed if isinstance(item, dict)]
                if not objects:
                    raise ValueError("LLM response array contained no JSON object.")
                return objects[0]
            return parsed
    raise ValueError(f"No balanced JSON object found in LLM response: {content[:200]!r}")


def _create_completion(client: Groq, settings: Settings, user_prompt: str, *, use_json_mode: bool):
    """
    Call the chat completion endpoint once.

    `use_json_mode` requests structured JSON output. Some models/proxies reject
    `response_format`; the caller retries once with it disabled. JSON extraction
    on our side still succeeds because we scan for the first balanced object.
    """
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]
    kwargs: dict = dict(
        model=settings.groq_model,
        messages=messages,
        temperature=0.2,
        timeout=settings.groq_request_timeout,
    )
    if use_json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    return client.chat.completions.create(**kwargs)


def _normalise(raw: dict[str, Any]) -> MatchResult:
    """Coerce a loosely-shaped dict into our validated MatchResult."""
    score = raw.get("score", 0)
    try:
        score = int(round(float(score)))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    def _as_str_list(value: Any) -> list[str]:
        if isinstance(value, str):
            # Tolerate a single string where a list was expected.
            text = value.strip()
            return [text] if text else []
        if not isinstance(value, list):
            return []
        result = []
        for v in value:
            if v is None:
                continue
            text = str(v).strip()
            if text:
                result.append(text)
        return result

    return MatchResult(
        score=score,
        matched_skills=_as_str_list(raw.get("matched_skills")),
        missing_skills=_as_str_list(raw.get("missing_skills")),
        rationale=str(raw.get("rationale", "")).strip(),
    )


def _backoff_seconds(exc: Exception, attempt: int) -> float:
    """
    Compute how long to wait before the next retry.

    Honours the ``Retry-After`` header on ``APIStatusError`` (Groq returns this
    on 429s), capped at 30s, falling back to exponential backoff
    (1s, 2s, 4s, ...) otherwise.
    """
    retry_after = None
    response = getattr(exc, "response", None)
    if response is not None:
        raw = response.headers.get("retry-after") if hasattr(response, "headers") else None
        if raw:
            try:
                retry_after = float(raw)
            except (TypeError, ValueError):
                retry_after = None
    if retry_after is not None:
        return min(retry_after, 30.0)
    return min(2 ** (attempt - 1), 30.0)


def score_match(*, resume_text: str, jd_text: str) -> MatchResult:
    """
    Call Groq and return a validated MatchResult.

    Retries on transient/rate-limit errors with exponential backoff. A
    `BadRequestError` (e.g. unsupported `response_format`) triggers exactly one
    fallback attempt without JSON mode; if it persists, it is surfaced as
    `LLMError`. Raises `LLMError` if it cannot succeed within `groq_max_retries`.
    """
    settings = get_settings()
    client = Groq(api_key=settings.groq_api_key)
    user_prompt = _build_user_prompt(resume_text, jd_text)

    # Outer attempts: API/network/JSON retries. Inner: one JSON-mode fallback.
    # `BadRequestError` is intentionally NOT retried here: `_try_with_json_fallback`
    # already performs the single JSON->non-JSON fallback, so retrying it would
    # only repeat the same doomed call (wasting quota). It surfaces as LLMError
    # immediately. Every branch either returns a result or raises, so there is no
    # fall-through after the loop.
    for attempt in range(1, settings.groq_max_retries + 1):
        try:
            response = _try_with_json_fallback(client, settings, user_prompt)
            content = response.choices[0].message.content or ""
            return _normalise(_extract_json_object(content))
        except APIStatusError as exc:
            # 429 (rate limit) and 5xx are retryable.
            if exc.status_code in (429, 500, 502, 503, 504):
                if attempt < settings.groq_max_retries:
                    # Prefer the server's Retry-After hint; otherwise exponential
                    # backoff (1s, 2s, 4s, ...), capped at 30s.
                    time.sleep(_backoff_seconds(exc, attempt))
                    continue
            raise LLMError(f"Groq request failed: {exc}") from exc
        except (APIConnectionError, json.JSONDecodeError, ValueError) as exc:
            if attempt < settings.groq_max_retries:
                time.sleep(_backoff_seconds(exc, attempt))
                continue
            raise LLMError(f"Could not obtain valid match result: {exc}") from exc
        except BadRequestError as exc:
            # Already had its one fallback inside _try_with_json_fallback.
            raise LLMError(f"Groq rejected the request: {exc}") from exc


def _try_with_json_fallback(client: Groq, settings: Settings, user_prompt: str):
    """
    Call the completion requesting JSON mode; on `BadRequestError` retry once
    without it. Any other error propagates to the caller's retry loop.
    """
    try:
        return _create_completion(client, settings, user_prompt, use_json_mode=True)
    except BadRequestError:
        return _create_completion(client, settings, user_prompt, use_json_mode=False)
