from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.models.schemas import InterviewStageCreate, InterviewStageOut, InterviewStageUpdate

router = APIRouter(prefix="/api/applications", tags=["Interviews"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _stage_to_out(row: dict) -> InterviewStageOut:
    return InterviewStageOut(
        id=str(row.get("id", "")),
        application_id=str(row.get("application_id", "")),
        stage_name=row.get("stage_name", ""),
        scheduled_at=row.get("scheduled_at"),
        status=row.get("status", "pending"),
        notes=row.get("notes"),
        prep_materials=row.get("prep_materials"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.get("/{application_id}/stages", response_model=list[InterviewStageOut])
async def list_stages(
    application_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    client = get_user_client(token)

    res = (
        client.table("interview_stages")
        .select("*")
        .eq("application_id", application_id)
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {res.error}")
    return [_stage_to_out(r) for r in res.data]


@router.post("/{application_id}/stages", response_model=InterviewStageOut, status_code=201)
async def create_stage(
    application_id: str,
    body: InterviewStageCreate,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    client = get_user_client(token)

    app_res = (
        client.table("applications")
        .select("id")
        .eq("id", application_id)
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(app_res, "error", None) or not app_res.data:
        raise HTTPException(status_code=404, detail="Application not found.")

    now = datetime.now(timezone.utc).isoformat()
    insert_data = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "application_id": application_id,
        "stage_name": body.stage_name,
        "scheduled_at": body.scheduled_at,
        "notes": body.notes,
        "prep_materials": body.prep_materials,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }

    res = (
        client.table("interview_stages")
        .insert(insert_data)
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"Failed to create stage: {res.error}")
    if not res.data:
        raise HTTPException(status_code=500, detail="Stage creation returned no row.")
    return _stage_to_out(res.data[0])


@router.patch("/{application_id}/stages/{stage_id}", response_model=InterviewStageOut)
async def update_stage(
    application_id: str,
    stage_id: str,
    body: InterviewStageUpdate,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    client = get_user_client(token)

    update = body.model_dump(exclude_none=True, exclude_unset=True)
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update.")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()

    res = (
        client.table("interview_stages")
        .update(update)
        .eq("id", stage_id)
        .eq("application_id", application_id)
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        raise HTTPException(status_code=404, detail="Stage not found.")
    return _stage_to_out(res.data[0])


@router.delete("/{application_id}/stages/{stage_id}", status_code=204)
async def delete_stage(
    application_id: str,
    stage_id: str,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    token = _token_from_request(request)
    client = get_user_client(token)

    res = (
        client.table("interview_stages")
        .delete()
        .eq("id", stage_id)
        .eq("application_id", application_id)
        .eq("user_id", user_id)
        .execute()
    )
    if getattr(res, "error", None) or not res.data:
        raise HTTPException(status_code=404, detail="Stage not found.")
