"""Tests for the RQ worker task (externals mocked)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.models.schemas import MatchResult
from app.worker import process_analysis


def _admin_with_status_select(admin, status_rows):
    """Wire the `select status` pre-check chain on a MagicMock admin client."""
    admin.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=status_rows
    )
    # Default: status updates (claim + final writes) succeed. The claim uses an
    # `.in_("status", ...)` filter, while final writes use `.eq("status", ...)`,
    # so wire both chains to a successful update representation.
    ok_update = MagicMock(data=[{"status": "ok"}], error=None)
    admin.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = ok_update
    admin.table.return_value.update.return_value.eq.return_value.in_.return_value.execute.return_value = ok_update


def test_process_analysis_happy_path(override_settings):
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])  # existing queued row
    fake_result = MatchResult(
        score=80, matched_skills=["Python"], missing_skills=["Rust"], rationale="good"
    )
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume", return_value=b"%PDF-1.4"
    ) as dl, patch("app.worker.run_match", return_value=fake_result) as rm:
        out = process_analysis(
            analysis_id="aid", storage_path="u/aid.pdf", jd_text="need python"
        )
    assert out["score"] == 80
    dl.assert_called_once_with(storage_path="u/aid.pdf")
    rm.assert_called_once()
    # Status transitions: processing then completed.
    statuses = [c.args[0]["status"] for c in admin.table.return_value.update.call_args_list]
    assert "processing" in statuses
    assert "completed" in statuses
    # The completed write must clear any prior error_message.
    completed_write = [
        c.args[0] for c in admin.table.return_value.update.call_args_list
        if c.args[0].get("status") == "completed"
    ]
    assert completed_write, "expected a completed write"
    assert completed_write[0].get("error_message") is None


def test_process_analysis_skips_already_completed(override_settings):
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "completed"}])
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume"
    ) as dl, patch("app.worker.run_match") as rm:
        out = process_analysis(
            analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
        )
    # No re-download / re-processing; returns the skip marker.
    assert out.get("skipped") is True
    dl.assert_not_called()
    rm.assert_not_called()


def test_process_analysis_recovers_stuck_processing_row(override_settings):
    # A row left in `processing` by a crashed worker must be re-claimed and
    # processed, not skipped.
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "processing"}])
    fake_result = MatchResult(
        score=50, matched_skills=[], missing_skills=["x"], rationale="r"
    )
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume", return_value=b"%PDF-1.4"
    ) as dl, patch("app.worker.run_match", return_value=fake_result):
        out = process_analysis(
            analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
        )
    assert out.get("score") == 50
    dl.assert_called_once()


def test_process_analysis_records_failure_on_final_attempt(override_settings):
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])  # existing queued row
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume", side_effect=RuntimeError("boom")
    ):
        with pytest.raises(RuntimeError):
            process_analysis(
                analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
            )
    # Final status should be 'failed' with an error message (guarded write).
    last_update = admin.table.return_value.update.call_args_list[-1].args[0]
    assert last_update["status"] == "failed"
    assert "boom" in last_update["error_message"]


def test_transient_failure_does_not_delete_pdf(override_settings):
    # On a non-final/every test attempt the PDF must be kept so RQ can retry.
    override_settings(supabase_service_key="svc", delete_resume_after_processing=True)
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])
    deleted = []
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume", side_effect=RuntimeError("storage blip")
    ), patch("app.worker.delete_resume", side_effect=lambda **kw: deleted.append(kw)):
        with pytest.raises(RuntimeError):
            process_analysis(
                analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
            )
    # The failed row is recorded, but the PDF is NOT deleted.
    assert any(
        c.args[0].get("status") == "failed"
        for c in admin.table.return_value.update.call_args_list
    )
    assert deleted == [], "PDF must be retained after a transient failure"


class _FakeJob:
    def __init__(self, retries_left):
        self.retries_left = retries_left


def test_non_final_attempt_does_not_write_failed(override_settings):
    # With retries remaining, a transient failure must NOT finalise the row, so
    # RQ can redeliver and re-process it.
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])  # queued -> will be claimed
    fake_job = _FakeJob(retries_left=2)  # not the last attempt
    with patch("app.worker.get_current_job", return_value=fake_job), patch(
        "app.worker.get_admin_client", return_value=admin
    ), patch("app.worker.download_resume", side_effect=RuntimeError("blip")):
        with pytest.raises(RuntimeError):
            process_analysis(
                analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
            )
    # No 'failed' write on a non-final attempt.
    assert not any(
        c.args[0].get("status") == "failed"
        for c in admin.table.return_value.update.call_args_list
    )


def test_penultimate_attempt_does_not_write_failed(override_settings):
    # With one retry still remaining (retries_left == 1 during this execution),
    # a failure must NOT finalise the row, so RQ can run the final attempt.
    # Regression test: the old `retries_left <= 1` threshold dropped this retry.
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])  # existing queued row
    fake_job = _FakeJob(retries_left=1)  # NOT the final execution
    with patch("app.worker.get_current_job", return_value=fake_job), patch(
        "app.worker.get_admin_client", return_value=admin
    ), patch("app.worker.download_resume", side_effect=RuntimeError("blip")):
        with pytest.raises(RuntimeError):
            process_analysis(
                analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
            )
    assert not any(
        c.args[0].get("status") == "failed"
        for c in admin.table.return_value.update.call_args_list
    )


def test_final_attempt_writes_failed(override_settings):
    # The genuinely final execution is the one with retries_left == 0 (rq has
    # already decremented it after the prior failed attempts and will not
    # re-enqueue again). That attempt must finalise the row as failed.
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])  # existing queued row
    fake_job = _FakeJob(retries_left=0)  # final attempt
    with patch("app.worker.get_current_job", return_value=fake_job), patch(
        "app.worker.get_admin_client", return_value=admin
    ), patch("app.worker.download_resume", side_effect=RuntimeError("blip")):
        with pytest.raises(RuntimeError):
            process_analysis(
                analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
            )
    assert any(
        c.args[0].get("status") == "failed"
        for c in admin.table.return_value.update.call_args_list
    )
    assert any(
        c.args[0].get("status") == "failed"
        for c in admin.table.return_value.update.call_args_list
    )


def test_process_analysis_skips_missing_row(override_settings):
    # If the analysis row vanished between enqueue and processing (e.g. deleted),
    # the worker must skip gracefully and NOT crash with an IndexError.
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    # select returns no rows
    admin.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[], error=None
    )
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume"
    ) as dl, patch("app.worker.run_match") as rm:
        out = process_analysis(
            analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
        )
    assert out.get("skipped") is True
    dl.assert_not_called()
    rm.assert_not_called()


def test_process_analysis_reraises_on_claim_error(override_settings):
    # If the claim UPDATE itself fails (transient DB error), the worker must not
    # blindly proceed to download/process. It should raise so RQ retries (or the
    # reaper eventually reclaims the row).
    override_settings(supabase_service_key="svc")
    admin = MagicMock()
    _admin_with_status_select(admin, [{"status": "queued"}])
    # Claim update returns an error (and no data, to be safe).
    admin.table.return_value.update.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(
        data=None, error="connection reset"
    )
    with patch("app.worker.get_admin_client", return_value=admin), patch(
        "app.worker.download_resume"
    ) as dl, patch("app.worker.run_match") as rm:
        with pytest.raises(RuntimeError):
            process_analysis(
                analysis_id="aid", storage_path="u/aid.pdf", jd_text="jd"
            )
    dl.assert_not_called()
    rm.assert_not_called()
