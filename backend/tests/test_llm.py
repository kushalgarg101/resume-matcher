"""Unit tests for the LLM service (Groq mocked — no network, no API key)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.models.schemas import MatchResult
from app.services import llm as llm_mod


def _fake_response(content: str) -> MagicMock:
    """Build a fake Groq chat completion response wrapping `content`."""
    msg = MagicMock()
    msg.content = content
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def test_extract_json_object_strips_markdown():
    raw = "```json\n{\"score\": 80, \"matched_skills\": [\"Python\"]}\n```"
    parsed = llm_mod._extract_json_object(raw)
    assert parsed["score"] == 80
    assert parsed["matched_skills"] == ["Python"]


def test_extract_json_object_unwraps_array():
    # Some models wrap the object in a single-element array.
    raw = '[{"score": 80, "matched_skills": ["Python"], "missing_skills": [], "rationale": "ok"}]'
    parsed = llm_mod._extract_json_object(raw)
    assert parsed["score"] == 80
    assert parsed["matched_skills"] == ["Python"]


def test_normalise_clamps_score():
    out = llm_mod._normalise({"score": 250, "rationale": "x"})
    assert out.score == 100
    out2 = llm_mod._normalise({"score": -5, "rationale": "x"})
    assert out2.score == 0


def test_normalise_coerces_skills():
    out = llm_mod._normalise(
        {"score": 50, "matched_skills": ["Py", 1, None], "missing_skills": "Git", "rationale": "ok"}
    )
    assert out.matched_skills == ["Py", "1"]
    assert out.missing_skills == ["Git"]


def test_score_match_happy_path(override_settings):
    override_settings(groq_api_key="x", groq_model="llama-3.1-8b-instant")
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_response(
        '{"score": 72, "matched_skills": ["Python"], "missing_skills": ["Rust"], "rationale": "good"}'
    )
    with patch.object(llm_mod, "Groq", return_value=fake_client):
        result = llm_mod.score_match(resume_text="Python dev", jd_text="needs Python")
    assert isinstance(result, MatchResult)
    assert result.score == 72
    assert result.matched_skills == ["Python"]


def _status_error(status_code: int) -> "object":
    """Build a real Groq APIStatusError using an httpx.Response."""
    import httpx

    request = httpx.Request("POST", "https://api.groq.com")
    response = httpx.Response(status_code, request=request)
    return llm_mod.APIStatusError("rate", response=response, body=None)


def test_score_match_retries_on_429_then_succeeds(override_settings):
    override_settings(groq_api_key="x", groq_model="m", groq_max_retries=3)
    # First call raises 429, second succeeds.
    err = _status_error(429)
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = [
        err,
        _fake_response('{"score": 10, "matched_skills": [], "missing_skills": ["X"], "rationale": "r"}'),
    ]
    with patch.object(llm_mod, "Groq", return_value=fake_client):
        result = llm_mod.score_match(resume_text="r", jd_text="j")
    assert result.score == 10
    assert fake_client.chat.completions.create.call_count == 2


def test_score_match_gives_up_after_retries(override_settings):
    override_settings(groq_api_key="x", groq_model="m", groq_max_retries=2)
    err = _status_error(429)
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = err
    with patch.object(llm_mod, "Groq", return_value=fake_client):
        with pytest.raises(llm_mod.LLMError):
            llm_mod.score_match(resume_text="r", jd_text="j")
    assert fake_client.chat.completions.create.call_count == 2


def test_extract_json_object_handles_trailing_text():
    # Model returns JSON then commentary; scanner must grab only the object.
    content = '```json\n{"score": 55, "matched_skills": ["Go"]}\n``` thanks!'
    parsed = llm_mod._extract_json_object(content)
    assert parsed == {"score": 55, "matched_skills": ["Go"]}


def test_extract_json_object_handles_nested():
    content = '{"score": 1, "matched_skills": [{"k": "v"}], "missing_skills": []}'
    parsed = llm_mod._extract_json_object(content)
    assert parsed["matched_skills"] == [{"k": "v"}]


def test_bad_request_json_mode_falls_back_then_succeeds(override_settings):
    override_settings(groq_api_key="x", groq_model="m", groq_max_retries=2)
    fake_client = MagicMock()
    # First call (JSON mode) raises BadRequestError; fallback succeeds.
    fake_client.chat.completions.create.side_effect = [
        llm_mod.BadRequestError("no json mode", response=MagicMock(status_code=400), body=None),
        _fake_response('{"score": 42, "matched_skills": ["X"], "missing_skills": [], "rationale": "r"}'),
    ]
    with patch.object(llm_mod, "Groq", return_value=fake_client):
        result = llm_mod.score_match(resume_text="r", jd_text="j")
    assert result.score == 42
    assert fake_client.chat.completions.create.call_count == 2


def test_persistent_bad_request_becomes_llmerror(override_settings):
    override_settings(groq_api_key="x", groq_model="m", groq_max_retries=1)
    fake_client = MagicMock()
    err = llm_mod.BadRequestError("bad", response=MagicMock(status_code=400), body=None)
    fake_client.chat.completions.create.side_effect = err
    with patch.object(llm_mod, "Groq", return_value=fake_client):
        with pytest.raises(llm_mod.LLMError):
            llm_mod.score_match(resume_text="r", jd_text="j")
    # Two calls: initial JSON-mode attempt + one fallback (both raise).
    assert fake_client.chat.completions.create.call_count == 2
