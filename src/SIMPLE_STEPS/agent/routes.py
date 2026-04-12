"""
FastAPI router for the agent chat and configuration endpoints.

Provides:
  - POST /api/agent/chat         — single-shot chat (JSON request/response)
  - WS   /api/agent/chat/stream  — streaming chat via WebSocket
  - GET  /api/agent/config       — read current agent configuration
  - PATCH /api/agent/config      — update agent configuration
  - GET  /api/agent/health       — check if the agent dependencies are installed
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Body
from pydantic import BaseModel, Field

from .config import AgentConfig, get_agent_config, update_agent_config
from .graph import invoke_agent, invoke_agent_streaming

router = APIRouter(prefix="/api/agent", tags=["agent"])


# ── Request / Response models ────────────────────────────────────────────────

class ChatRequest(BaseModel):
    """Payload sent by the frontend for a single-shot agent chat turn."""

    message: str
    workflow_steps: List[Dict[str, Any]] = Field(default_factory=list)
    available_operations: List[Dict[str, Any]] = Field(default_factory=list)
    current_step: Optional[Dict[str, Any]] = None
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    message: str
    suggested_formula: Optional[str] = None
    error: Optional[str] = None


# ── REST endpoints ───────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def agent_chat(req: ChatRequest):
    """Single-shot agent invocation — send a message, get a response."""
    result = invoke_agent(
        user_message=req.message,
        workflow_steps=req.workflow_steps,
        available_operations=req.available_operations,
        current_step=req.current_step,
        conversation_history=req.conversation_history,
    )
    return ChatResponse(**result)


@router.get("/config", response_model=AgentConfig)
async def read_config():
    """Return the current agent configuration."""
    return get_agent_config()


@router.patch("/config", response_model=AgentConfig)
async def patch_config(patch: dict = Body(...)):
    """
    Partially update the agent configuration.
    Send only the fields you want to change.
    """
    return update_agent_config(patch)


@router.get("/health")
async def agent_health():
    """
    Check whether the agent's required dependencies are installed
    and the LLM is reachable.
    """
    config = get_agent_config()
    checks: Dict[str, Any] = {
        "provider": config.provider,
        "model": config.model,
    }

    # Check LangChain core
    try:
        import langchain_core  # noqa: F401
        checks["langchain_core"] = True
    except ImportError:
        checks["langchain_core"] = False

    # Check LangGraph
    try:
        import langgraph  # noqa: F401
        checks["langgraph"] = True
    except ImportError:
        checks["langgraph"] = False

    # Check provider package
    provider_pkg = f"langchain_{config.provider}"
    try:
        __import__(provider_pkg)
        checks["provider_package"] = True
    except ImportError:
        checks["provider_package"] = False
        checks["install_hint"] = f"pip install {provider_pkg}"

    # Check API key availability
    import os
    key_env_map = {
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "azure_openai": "AZURE_OPENAI_API_KEY",
        "ollama": None,  # no key needed
    }
    env_var = key_env_map.get(config.provider)
    if env_var:
        has_key = bool(config.api_key or os.environ.get(env_var))
        checks["api_key_set"] = has_key
    else:
        checks["api_key_set"] = True  # Ollama doesn't need one

    checks["ready"] = all([
        checks.get("langchain_core"),
        checks.get("provider_package"),
        checks.get("api_key_set"),
    ])

    return checks


# ── WebSocket streaming endpoint ─────────────────────────────────────────────

@router.websocket("/chat/stream")
async def agent_chat_stream(websocket: WebSocket):
    """
    WebSocket endpoint for streaming agent responses.

    Client sends JSON messages with the same shape as ChatRequest.
    Server streams back text tokens, then a final JSON message with metadata.
    """
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "content": "Invalid JSON"})
                continue

            # Parse the incoming chat request
            msg = payload.get("message", "")
            if not msg.strip():
                await websocket.send_json({"type": "error", "content": "Empty message"})
                continue

            full_response = ""

            # Stream tokens
            async for token in invoke_agent_streaming(
                user_message=msg,
                workflow_steps=payload.get("workflow_steps", []),
                available_operations=payload.get("available_operations", []),
                current_step=payload.get("current_step"),
                conversation_history=payload.get("conversation_history", []),
            ):
                full_response += token
                await websocket.send_json({
                    "type": "token",
                    "content": token,
                })

            # Extract formula suggestion from full response
            import re
            formula_match = re.search(r'`(=[a-zA-Z_]\w*\(.*?\))`', full_response)
            suggested_formula = formula_match.group(1) if formula_match else None

            # Send completion signal
            await websocket.send_json({
                "type": "done",
                "content": full_response,
                "suggested_formula": suggested_formula,
            })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass
