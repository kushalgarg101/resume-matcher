from __future__ import annotations


from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.models.schemas import (
    UserProfileOut,
    UserProfileUpdate,
    profile_from_db,
)

router = APIRouter(prefix="/api/profile", tags=["Profile"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _upsert_profile(user_client, user_id: str, data: dict) -> dict:
    """Upsert a profile row using the user-scoped client (RLS enforced)."""
    from datetime import datetime, timezone
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    existing = (
        user_client.table("user_profiles")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(existing, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {existing.error}")

    if existing.data:
        res = (
            user_client.table("user_profiles")
            .update(data)
            .eq("user_id", user_id)
            .execute()
        )
    else:
        data["user_id"] = user_id
        data.setdefault("skills", [])
        data.setdefault("experience", [])
        data.setdefault("education", [])
        data.setdefault("projects", [])
        data.setdefault("certifications", [])
        data.setdefault("preferred_roles", [])
        data.setdefault("preferred_locations", [])
        res = (
            user_client.table("user_profiles")
            .insert(data)
            .execute()
        )
        if getattr(res, "error", None) and "23505" in str(res.error):
            # Race: another request inserted a profile between our select and
            # insert. Switch to update.
            res = (
                user_client.table("user_profiles")
                .update(data)
                .eq("user_id", user_id)
                .execute()
            )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB upsert failed: {res.error}")
    if not res.data:
        raise HTTPException(status_code=500, detail="DB upsert returned no row.")
    return res.data[0]


@router.get("", response_model=UserProfileOut)
async def get_profile(request: Request, user_id: str = Depends(get_current_user)):
    """Get the current user's profile. Creates an empty one if none exists."""
    token = _token_from_request(request)
    user_client = get_user_client(token)
    res = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB query failed: {res.error}")
    if res.data:
        return profile_from_db(res.data[0])
    # Create an empty profile on first access
    row = _upsert_profile(user_client, user_id, {})
    return profile_from_db(row)


@router.put("", response_model=UserProfileOut)
async def update_profile(
    body: UserProfileUpdate,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Update profile fields. Only provided fields are changed."""
    token = _token_from_request(request)
    user_client = get_user_client(token)
    data = body.model_dump(exclude_none=True, exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update.")
    row = _upsert_profile(user_client, user_id, data)
    return profile_from_db(row)
