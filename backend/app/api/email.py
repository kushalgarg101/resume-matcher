from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.models.schemas import EmailConfig, EmailConfigUpdate, EmailSyncResult
from app.services.email_monitor import sync_and_classify

router = APIRouter(prefix="/api/email", tags=["Email"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/config", response_model=EmailConfig | None)
async def get_email_config(
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Get the user's email monitoring configuration."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("user_profiles")
        .select("email_config")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        return None

    config = res.data[0].get("email_config")
    if not config:
        return None

    return EmailConfig(**config)


@router.put("/config", response_model=EmailConfig)
async def update_email_config(
    body: EmailConfigUpdate,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Update email monitoring configuration. Only provided fields are changed."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    # Get existing config
    res = (
        user_client.table("user_profiles")
        .select("email_config")
        .eq("user_id", user_id)
        .execute()
    )
    existing = {}
    if not getattr(res, "error", None) and res.data:
        existing = res.data[0].get("email_config") or {}

    update = body.model_dump(exclude_none=True, exclude_unset=True)
    existing.update(update)

    upsert_res = (
        user_client.table("user_profiles")
        .update({"email_config": existing})
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(upsert_res, "error", None):
        raise HTTPException(status_code=500, detail=f"Failed to update email config: {upsert_res.error}")

    return EmailConfig(**existing)


@router.post("/sync", response_model=EmailSyncResult)
async def sync_emails(
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Fetch recent emails, classify them, and update matching applications."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    # Get email config
    profile_res = (
        user_client.table("user_profiles")
        .select("email_config")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(profile_res, "error", None) or not profile_res.data:
        raise HTTPException(status_code=404, detail="Profile not found.")

    config = profile_res.data[0].get("email_config")
    if not config or not config.get("enabled"):
        raise HTTPException(status_code=400, detail="Email monitoring is not configured or enabled.")

    # Get user's applications with job info
    apps_res = (
        user_client.table("applications")
        .select("id, jobs(title, company_name)")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(apps_res, "error", None):
        raise HTTPException(status_code=500, detail=f"Failed to fetch applications: {apps_res.error}")

    applications = apps_res.data if apps_res.data else []

    # Run sync
    sync_result = sync_and_classify(config, applications)

    # Apply status updates to matched applications
    updated_count = 0
    for update in sync_result.get("updated_applications", []):
        app_id = update["application_id"]
        new_status = update["new_status"]
        email_thread_id = update["email_thread_id"]

        client = get_user_client(token)
        upsert = (
            client.table("applications")
            .update({
                "status": new_status,
                "email_thread_id": email_thread_id,
                "updated_at": _now(),
            })
            .eq("id", app_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not getattr(upsert, "error", None):
            updated_count += 1

    # Update last sync timestamp
    get_user_client(token).table("user_profiles").update({
        "email_config": {**config, "last_sync_at": _now()},
    }).eq("user_id", user_id).execute()

    return EmailSyncResult(
        processed=sync_result["processed"],
        matched=sync_result["matched"],
        updated_applications=updated_count,
        errors=sync_result.get("errors", []),
    )


@router.get("/recent", response_model=list[dict])
async def recent_classified(
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Get the most recent classified emails (from the last sync result stored on profile)."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    res = (
        user_client.table("user_profiles")
        .select("email_config")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        return []

    config = res.data[0].get("email_config") or {}
    return config.get("last_classified", [])
