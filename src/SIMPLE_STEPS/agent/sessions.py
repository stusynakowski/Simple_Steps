"""
sessions.py — a copilot session: one per workflow (plan 128 A2b; spec 018).

A session is plain JSON, saved in the workspace beside the work it is about:
``<workspace>/.simple_steps/agent_sessions/<workflow id>.json`` (or
``$SIMPLE_STEPS_AGENT_SESSIONS``). It holds everything the copilot needs to
pick the work up again after a reload, and everything the user needs to see
where it stands:

- ``goal``: what the workflow is for (the first request, unless edited);
- ``context``: the user's ``notes`` and the ``templates`` (earlier workflows)
  the copilot reads as examples;
- ``phase``: ``plan`` → ``build`` → ``done``;
- ``questions``: what the copilot asked before it could plan;
- ``plan``: the proposed ``resources`` and ``steps``, and the dev plan, its
  ``milestones``, each with a check and a status (``todo``, ``active``,
  ``done``);
- ``messages``: the conversation, proposals included, so the chat redraws;
- ``trace``: one record per turn (what the copilot did, what it read, how
  long, how many model calls, what the checks said).

Nothing here calls a model; ``copilot.py`` runs the turns.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

PHASES = ("plan", "build", "done")

#: Longest notes and template text the copilot is given (characters).
NOTES_BUDGET = 2000
TEMPLATES_BUDGET = 3000


def sessions_dir() -> Path:
    """Where sessions are saved."""
    env = os.environ.get("SIMPLE_STEPS_AGENT_SESSIONS")
    if env:
        return Path(env)
    from .. import file_manager
    return Path(file_manager.WORKSPACE_ROOT) / ".simple_steps" / "agent_sessions"


def _slug(session_id: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", session_id or "").strip("._")
    if not slug:
        raise ValueError("a session needs a workflow id")
    return slug


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def new_session(session_id: str, title: str = "") -> Dict[str, Any]:
    """An empty session for the workflow *session_id*."""
    return {
        "id": session_id, "title": title or session_id, "created": now(), "updated": now(),
        "phase": "plan", "goal": "",
        "context": {"notes": "", "templates": []},
        "questions": [], "plan": None, "messages": [], "trace": [],
    }


def load(session_id: str, title: str = "") -> Dict[str, Any]:
    """The saved session for *session_id*, or a new one (not saved yet)."""
    path = sessions_dir() / f"{_slug(session_id)}.json"
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return new_session(session_id, title)
    base = new_session(session_id, title)
    base.update(data if isinstance(data, dict) else {})
    return base


def save(session: Dict[str, Any]) -> Dict[str, Any]:
    session["updated"] = now()
    folder = sessions_dir()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{_slug(session['id'])}.json").write_text(json.dumps(session, indent=2, default=str))
    return session


def delete(session_id: str) -> bool:
    path = sessions_dir() / f"{_slug(session_id)}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def summary(session: Dict[str, Any]) -> Dict[str, Any]:
    """A session as the sessions list shows it: no messages, no trace."""
    milestones = (session.get("plan") or {}).get("milestones") or []
    return {"id": session["id"], "title": session.get("title") or session["id"],
            "goal": session.get("goal", ""), "phase": session.get("phase", "plan"),
            "done": sum(m.get("status") == "done" for m in milestones), "total": len(milestones),
            "turns": len(session.get("trace") or []), "updated": session.get("updated", "")}


def list_sessions() -> List[Dict[str, Any]]:
    """Every saved session, most recently updated first."""
    folder = sessions_dir()
    out = []
    for path in folder.glob("*.json") if folder.is_dir() else []:
        try:
            out.append(summary(json.loads(path.read_text())))
        except (OSError, ValueError, KeyError):
            continue
    return sorted(out, key=lambda s: s["updated"], reverse=True)


def update(session: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Apply what the user may edit: ``title``, ``goal``, ``notes``,
    ``templates`` ([{project, workflow}]), and ``applied`` ({message id: count},
    when the user applies a proposal)."""
    if "title" in patch:
        session["title"] = str(patch["title"] or session["id"])
    if "goal" in patch:
        session["goal"] = str(patch["goal"] or "")
    if "notes" in patch:
        session["context"]["notes"] = str(patch["notes"] or "")
    if "templates" in patch:
        refs = [t for t in patch["templates"] or []
                if isinstance(t, dict) and t.get("project") and t.get("workflow")]
        session["context"]["templates"] = [{"project": str(t["project"]), "workflow": str(t["workflow"])}
                                           for t in refs]
    for message_id, count in (patch.get("applied") or {}).items():
        for m in session["messages"]:
            if m.get("id") == message_id:
                m["applied"] = int(count)
    return session


# ─────────────────────────────────────────────────────────────────────────────
# Templates: earlier workflows, as examples the copilot reads
# ─────────────────────────────────────────────────────────────────────────────

def available_templates() -> List[Dict[str, str]]:
    """Every workflow in the workspace that can be a template."""
    from .. import file_manager
    out = []
    for project in file_manager.list_projects():
        for workflow in project.pipelines:
            out.append({"project": project.id, "workflow": workflow,
                        "label": f"{project.name} / {workflow}"})
    return out


def templates_text(refs: List[Dict[str, str]]) -> str:
    """The template workflows' steps as worked examples, within the budget."""
    from .. import file_manager
    blocks = []
    for ref in refs or []:
        pf = file_manager.load_pipeline(ref.get("project", ""), ref.get("workflow", ""))
        if pf is None:
            continue
        lines = [f"TEMPLATE {pf.name or ref['workflow']} (an earlier workflow; reuse its patterns):"]
        for step in pf.steps:
            data = step if isinstance(step, dict) else step.model_dump()
            expression = (data.get("expression") or data.get("formula") or "").lstrip("=")
            lines.append(f'- {data.get("name")} = {expression}')
        blocks.append("\n".join(lines))
    text = "\n\n".join(blocks)
    return text[:TEMPLATES_BUDGET] + ("\n…(cut)" if len(text) > TEMPLATES_BUDGET else "")


def notes_text(session: Dict[str, Any]) -> str:
    notes = (session.get("context") or {}).get("notes", "").strip()
    if not notes:
        return ""
    cut = notes[:NOTES_BUDGET] + ("…(cut)" if len(notes) > NOTES_BUDGET else "")
    return f"NOTES FROM THE USER (domain knowledge; follow them):\n{cut}"
