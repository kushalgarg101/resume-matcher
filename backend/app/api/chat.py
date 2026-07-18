from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.auth import get_current_user
from app.core.supabase import get_user_client
from app.models.schemas import (
    ChatConversationOut,
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    profile_from_db,
)
from app.services.chat_agent import process_message

router = APIRouter(prefix="/api/chat", tags=["Chat"])


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    raise HTTPException(status_code=401, detail="Missing bearer token.")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_conversation(user_client, user_id: str) -> str:
    """Get active conversation or create a new one. Returns conversation_id."""
    existing = (
        user_client.table("chat_conversations")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if getattr(existing, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {existing.error}")
    if existing.data:
        return existing.data[0]["id"]

    conv_id = str(uuid.uuid4())
    res = (
        user_client.table("chat_conversations")
        .insert({"id": conv_id, "user_id": user_id, "context": {}, "status": "active"})
        .execute()
    )
    if getattr(res, "error", None):
        if "23505" in str(res.error):
            # Race: another request created an active conversation between our
            # select and insert. Return the existing one.
            existing = (
                user_client.table("chat_conversations")
                .select("id")
                .eq("user_id", user_id)
                .eq("status", "active")
                .limit(1)
                .execute()
            )
            if getattr(existing, "error", None) or not existing.data:
                raise HTTPException(status_code=500, detail="Failed to find existing conversation after conflict.")
            return existing.data[0]["id"]
        raise HTTPException(status_code=500, detail=f"Failed to create conversation: {res.error}")
    if not res.data:
        raise HTTPException(status_code=500, detail="Conversation creation returned no row.")
    return conv_id


@router.get("/conversation", response_model=dict)
async def get_active_conversation(
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Get the active conversation with its messages, or None."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    convs = (
        user_client.table("chat_conversations")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if getattr(convs, "error", None):
        raise HTTPException(status_code=500, detail=f"DB error: {convs.error}")
    if not convs.data:
        return {"conversation": None, "messages": []}

    conv = convs.data[0]
    msgs = (
        user_client.table("chat_messages")
        .select("*")
        .eq("conversation_id", conv["id"])
        .order("created_at", asc=True)
        .execute()
    )
    messages = []
    if not getattr(msgs, "error", None) and msgs.data:
        messages = [
            ChatMessageOut(
                id=m["id"],
                role=m["role"],
                content=m["content"],
                created_at=m.get("created_at"),
            )
            for m in msgs.data
        ]

    return {
        "conversation": ChatConversationOut(
            id=conv.get("id", ""),
            status=conv.get("status", ""),
            created_at=conv.get("created_at"),
            updated_at=conv.get("updated_at"),
        ),
        "messages": messages,
    }


@router.post("", response_model=ChatResponse)
async def send_message(
    body: ChatRequest,
    request: Request,
    user_id: str = Depends(get_current_user),
):
    """Send a message to the agent and get a response."""
    token = _token_from_request(request)
    user_client = get_user_client(token)

    conv_id = body.conversation_id or _ensure_conversation(user_client, user_id)

    # Get current profile
    profile_row = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    profile_dict = profile_row.data[0] if (not getattr(profile_row, "error", None) and profile_row.data) else {}

    # Get recent message history (BEFORE saving the current user message so
    # process_message doesn't see it duplicated — it receives the current text
    # via the `message` parameter only).
    history_rows = (
        user_client.table("chat_messages")
        .select("role,content")
        .eq("conversation_id", conv_id)
        .order("created_at", asc=True)
        .limit(20)
        .execute()
    )
    history = []
    if not getattr(history_rows, "error", None) and history_rows.data:
        history = [{"role": m["role"], "content": m["content"]} for m in history_rows.data]

    # Call agent
    agent_result = process_message(
        message=body.message,
        profile=profile_dict,
        history=history,
    )

    # Save user message — do this BEFORE any side effects so the conversation
    # history is consistent even if a subsequent write fails.
    user_msg_id = str(uuid.uuid4())
    res = (
        user_client.table("chat_messages")
        .insert({
            "id": user_msg_id,
            "conversation_id": conv_id,
            "role": "user",
            "content": body.message,
        })
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"Failed to save message: {res.error}")

    # Save assistant message immediately after user message so the conversation
    # is never left with an orphaned user or assistant turn alone.
    assistant_msg_id = str(uuid.uuid4())
    assistant_content = agent_result.get("reply", "")
    res = (
        user_client.table("chat_messages")
        .insert({
            "id": assistant_msg_id,
            "conversation_id": conv_id,
            "role": "assistant",
            "content": assistant_content,
        })
        .execute()
    )
    if getattr(res, "error", None):
        raise HTTPException(status_code=500, detail=f"Failed to save response: {res.error}")

    # Apply profile updates if any
    if agent_result.get("profile_updates"):
        update_data = agent_result["profile_updates"]
        update_data["updated_at"] = _now()
        if agent_result.get("profile_complete"):
            update_data["is_complete"] = True
        res = (
            user_client.table("user_profiles")
            .update(update_data)
            .eq("user_id", user_id)
            .execute()
        )
        if getattr(res, "error", None):
            raise HTTPException(status_code=500, detail=f"Failed to update profile: {res.error}")

    # If agent marked complete, also update conversation status
    if agent_result.get("profile_complete"):
        res = (
            user_client.table("chat_conversations")
            .update({"status": "completed", "updated_at": _now()})
            .eq("id", conv_id)
            .execute()
        )
        if getattr(res, "error", None):
            raise HTTPException(status_code=500, detail=f"Failed to update conversation: {res.error}")

    # Fetch updated profile
    updated_profile_row = (
        user_client.table("user_profiles")
        .select("*")
        .eq("user_id", user_id)
        .execute()
    )
    updated_profile = None
    if not getattr(updated_profile_row, "error", None) and updated_profile_row.data:
        updated_profile = profile_from_db(updated_profile_row.data[0])

    return ChatResponse(
        conversation_id=conv_id,
        message=ChatMessageOut(
            id=assistant_msg_id,
            role="assistant",
            content=assistant_content,
            created_at=_now(),
        ),
        profile=updated_profile,
        profile_complete=agent_result.get("profile_complete", False),
    )
