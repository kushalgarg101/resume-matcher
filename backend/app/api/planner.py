from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.models.schemas import PlannerRequest, PlannerResponse, SearchPlan
from app.services.planner import plan_search

router = APIRouter(prefix="/api/planner", tags=["Planner"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


@router.post("/plan", response_model=PlannerResponse)
async def create_plan(
    body: PlannerRequest,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Parse a natural language job search query into a structured search plan."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    profile = None
    profile_res = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    if not getattr(profile_res, "error", None) and profile_res.data:
        profile = profile_res.data[0]

    try:
        result = plan_search(body.query, profile=profile)
        return PlannerResponse(
            search_plan=SearchPlan(**result["search_plan"]),
            suggestions=result.get("suggestions", []),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Planner agent failed: {exc}",
        ) from exc
