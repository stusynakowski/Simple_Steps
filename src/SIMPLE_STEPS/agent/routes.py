"""
FastAPI router for the agent (docs/dev_plan/weekend_developments/128).

  - GET   /api/agent/status   — whether the agent can run, with which model
  - POST  /api/agent/propose  — one turn: checked changes, nothing applied
  - GET   /api/agent/config   — the agent's settings
  - PATCH /api/agent/config   — change them
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from .config import AgentConfig, get_agent_config, update_agent_config
from ..session import get_session_id

router = APIRouter(prefix="/api/agent", tags=["agent"])


class ProposeRequest(BaseModel):
    """A user's request, with the workflow as the UI holds it."""
    message: str
    #: [{name, formula, status, error, output_ref}] in order.
    steps: List[Dict[str, Any]] = Field(default_factory=list)
    #: The workflow's `resources` section.
    resources: Dict[str, Any] = Field(default_factory=dict)
    #: Earlier turns: [{role: user|assistant, content}].
    history: List[Dict[str, str]] = Field(default_factory=list)


@router.get("/status")
async def agent_status():
    """Whether the agent can run, with which model — or why it can't."""
    from .model import resolve
    agent, why = resolve()
    if agent is None:
        return {"available": False, "reason": why}
    return {"available": True, "provider": agent.provider, "model": agent.model,
            "host": agent.host}


@router.post("/propose")
def agent_propose(req: ProposeRequest, session_id: str = Depends(get_session_id)):
    """One agent turn: steps to add, change or remove, each checked; nothing applied."""
    from .model import ModelError, resolve
    from .proposals import propose
    agent, why = resolve()
    if agent is None:
        raise HTTPException(status_code=503, detail=f"The agent is off: {why}")
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Ask the agent something first.")
    try:
        return propose(agent, req.message, req.steps, req.resources, req.history, session_id)
    except ModelError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/config", response_model=AgentConfig)
async def read_config():
    """Return the current agent configuration."""
    return get_agent_config()


@router.patch("/config", response_model=AgentConfig)
async def patch_config(patch: dict = Body(...)):
    """Partially update the agent configuration: send only the fields to change."""
    return update_agent_config(patch)
