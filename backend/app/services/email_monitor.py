from __future__ import annotations

import email
import imaplib
import traceback
from datetime import datetime, timezone, timedelta
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Any

from app.services.email_classifier import classify_email


def _decode_header_value(value: str | None) -> str:
    """Decode an email header that may be MIME-encoded."""
    if not value:
        return ""
    decoded_parts = decode_header(value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            try:
                result.append(part.decode(charset or "utf-8", errors="replace"))
            except (LookupError, UnicodeDecodeError):
                result.append(part.decode("utf-8", errors="replace"))
        else:
            result.append(part)
    return " ".join(result)


def _get_email_body(msg: email.message.Message) -> str:
    """Extract plain text body from an email message."""
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    try:
                        return payload.decode("utf-8", errors="replace")
                    except (UnicodeDecodeError, LookupError):
                        return payload.decode("latin-1", errors="replace")
        return ""
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            try:
                return payload.decode("utf-8", errors="replace")
            except (UnicodeDecodeError, LookupError):
                return payload.decode("latin-1", errors="replace")
        return ""


def fetch_recent_emails(
    config: dict[str, Any],
    hours_back: int = 24,
) -> list[dict[str, Any]]:
    """
    Fetch recent emails from an IMAP inbox.

    Args:
        config: Email config dict with imap_host, imap_port, email_address, app_password, use_ssl.
        hours_back: How many hours back to scan.

    Returns:
        List of dicts with subject, body, from_address, received_at, message_id.
    """
    host = config.get("imap_host")
    port = config.get("imap_port", 993)
    username = config.get("email_address")
    password = config.get("app_password")
    use_ssl = config.get("use_ssl", True)

    if not all([host, username, password]):
        raise ValueError("IMAP configuration is incomplete.")

    emails_list: list[dict[str, Any]] = []

    if use_ssl:
        conn = imaplib.IMAP4_SSL(host, port)
    else:
        conn = imaplib.IMAP4(host, port)

    try:
        conn.login(username, password)
        conn.select("INBOX")

        since_date = (datetime.now(timezone.utc) - timedelta(hours=hours_back)).strftime("%d-%b-%Y")
        status, message_ids = conn.search(None, f'SINCE {since_date}')
        if status != "OK":
            return emails_list

        ids = message_ids[0].split() if message_ids[0] else []
        for mid in ids[-50:]:  # Process max 50 most recent emails
            status, msg_data = conn.fetch(mid, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue

            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email)

            subject = _decode_header_value(msg.get("Subject", ""))
            from_addr = _decode_header_value(msg.get("From", ""))
            date_str = msg.get("Date", "")

            received_at = None
            try:
                parsed = parsedate_to_datetime(date_str)
                if parsed:
                    received_at = parsed.isoformat()
            except Exception:
                received_at = datetime.now(timezone.utc).isoformat()

            body = _get_email_body(msg)
            raw_message_id = msg.get("Message-ID")
            message_id = _decode_header_value(raw_message_id) if raw_message_id else str(mid.decode("ascii", errors="replace"))

            emails_list.append({
                "message_id": message_id,
                "subject": subject[:500],
                "from_address": from_addr[:200],
                "body": body[:5000],
                "received_at": received_at or datetime.now(timezone.utc).isoformat(),
            })
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    return emails_list


def sync_and_classify(
    config: dict[str, Any],
    applications: list[dict[str, Any]],
    hours_back: int = 24,
) -> dict[str, Any]:
    """
    Fetch recent emails, classify them, and match against user's applications.

    Args:
        config: Email configuration dict.
        applications: User's application list (each with job info).
        hours_back: How far back to scan.

    Returns:
        dict with processed count, matched count, updated application IDs, errors.
    """
    result: dict[str, Any] = {
        "processed": 0,
        "matched": 0,
        "updated_applications": [],
        "errors": [],
        "classified_emails": [],
    }

    try:
        emails = fetch_recent_emails(config, hours_back)
    except Exception as exc:
        result["errors"].append(str(exc))
        return result

    # Build a lookup: company names → application ids
    company_to_app: dict[str, str] = {}
    for app in applications:
        job = app.get("jobs") or {}
        company = (job.get("company_name") or "").strip().lower()
        if company:
            company_to_app[company] = app.get("id", "")

    for email_data in emails:
        result["processed"] += 1
        try:
            classification = classify_email(
                email_data["subject"],
                email_data["body"],
            )
        except Exception as exc:
            result["errors"].append(f"Classification failed for {email_data['subject'][:50]}: {exc}")
            continue

        classified = {
            "message_id": email_data["message_id"],
            "subject": email_data["subject"],
            "from_address": email_data["from_address"],
            "received_at": email_data["received_at"],
            "category": classification["category"],
            "confidence": classification["confidence"],
            "company_name": classification["company_name"],
            "job_title": classification["job_title"],
            "summary": classification["summary"],
        }
        result["classified_emails"].append(classified)

        # Skip low-confidence and non-application emails
        if classification["category"] == "other" or classification["confidence"] < 0.5:
            continue

        # Try to match by company name
        matched_company = (classification.get("company_name") or "").strip().lower()
        if matched_company and matched_company in company_to_app:
            app_id = company_to_app[matched_company]

            status_map = {
                "rejection": "rejected",
                "interview": "interviewing",
                "offer": "offer",
                "screening": "interviewing",
                "application_ack": "applied",
            }
            new_status = status_map.get(classification["category"])
            if new_status:
                result["matched"] += 1
                result["updated_applications"].append({
                    "application_id": app_id,
                    "new_status": new_status,
                    "email_thread_id": email_data["message_id"],
                    "summary": classification.get("summary", ""),
                })

    return result
