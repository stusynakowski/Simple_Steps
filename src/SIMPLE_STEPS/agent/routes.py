"""
FastAPI router for the agent (docs/dev_plan/weekend_developments/128).

  - GET   /api/agent/status   — whether the agent can run, with which model
  - POST  /api/agent/propose  — one turn: checked changes, nothing applied
  - GET   /api/agent/config   — the setting in use, never the key
  - PUT   /api/agent/config   — save the setting (a key is write-only)
  - POST  /api/agent/test     — one tiny real request: does the model answer?

Copilot sessions, one per workflow (spec 018, ``copilot.py``):

  - GET    /api/agent/sessions                 — every session: title, phase, progress
  - GET    /api/agent/sessions/{id}            — one session (new and empty if none)
  - PUT    /api/agent/sessions/{id}            — edit goal, notes, templates; mark applied
  - DELETE /api/agent/sessions/{id}            — forget it
  - POST   /api/agent/sessions/{id}/turn       — one turn: plan/ask, accept, propose, validate
  - GET    /api/agent/templates                — workflows that can be templates
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

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
    # Never the key (C3): only whether one is set.
    return {"available": True, **agent.public()}


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


# ── Copilot sessions: one per workflow (spec 018) ────────────────────────────

class TurnRequest(BaseModel):
    """One copilot turn, with the workflow as the UI holds it."""
    #: continue | accept | replan
    action: str = "continue"
    message: str = ""
    title: str = ""
    steps: List[Dict[str, Any]] = Field(default_factory=list)
    resources: Dict[str, Any] = Field(default_factory=dict)


@router.get("/sessions")
def list_sessions():
    """Every saved session, newest first: title, goal, phase, progress."""
    from .sessions import list_sessions as listed
    return listed()


@router.get("/sessions/{workflow_id}")
def read_session(workflow_id: str, title: str = ""):
    """The workflow's session, or a new empty one (not saved until a turn)."""
    from .sessions import load
    return load(workflow_id, title)


@router.put("/sessions/{workflow_id}")
def edit_session(workflow_id: str, patch: Dict[str, Any] = Body(...)):
    """Edit title, goal, notes, templates, or mark a proposal applied."""
    from .sessions import load, save, update
    return save(update(load(workflow_id), patch))


@router.delete("/sessions/{workflow_id}")
def reset_session(workflow_id: str):
    """Forget the workflow's session (the workflow itself is untouched)."""
    from .sessions import delete
    return {"deleted": delete(workflow_id)}


@router.post("/sessions/{workflow_id}/turn")
def session_turn(workflow_id: str, req: TurnRequest, session_id: str = Depends(get_session_id)):
    """One turn: plan or ask, accept, propose, or validate. Nothing is applied."""
    from .copilot import turn
    from .model import resolve
    from .sessions import load, save
    if req.action not in ("continue", "accept", "replan"):
        raise HTTPException(status_code=400, detail=f"unknown action {req.action!r}")
    agent, why = resolve()
    session = load(workflow_id, req.title)
    turn(agent, session, message=req.message, action=req.action, steps=req.steps,
         resources=req.resources, session_id=session_id, off_reason=why)
    return save(session)


@router.get("/templates")
def list_templates():
    """Workflows in the workspace a session can read as templates."""
    from .sessions import available_templates
    return available_templates()


@router.get("/config")
async def read_config():
    """The setting in use and where it comes from; whether a key is set, never the key."""
    from .config import public_settings
    return public_settings()


@router.put("/config")
async def save_config(patch: Dict[str, Any] = Body(...)):
    """Save the setting (``~/.simple_steps/agent.json``, mode 600). ``api_key``
    is write-only: a value replaces it, ``""`` clears it, leaving it out keeps it."""
    from .config import save_settings
    try:
        return save_settings(patch)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/test")
def test_model(settings: Dict[str, Any] = Body(default_factory=dict)):
    """One tiny real request: ``{"ok", "model", "detail"}``, detail naming what's
    wrong. With fields, tests them unsaved (the panel's form); without, the
    setting in use."""
    from .config import agent_from
    from .model import current_agent, test_connection
    try:
        agent = agent_from(settings) if settings else current_agent()
    except (TypeError, ValueError) as exc:
        return {"ok": False, "model": settings.get("model", ""), "detail": str(exc)}
    if agent is None:
        return {"ok": False, "model": "", "detail": "the application turned the copilot off"}
    return test_connection(agent)
