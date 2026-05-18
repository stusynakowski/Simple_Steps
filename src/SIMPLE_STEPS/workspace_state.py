"""
workspace_state.py
==================

Persistent, cross-launch state for the "current workspace" + recent list.

This is the M0 (local single-user) equivalent of VS Code's
``~/.config/Code/User/globalStorage/storage.json``:

* What folder did the user last open?
* What folders have they opened recently?

The file lives at ``~/.simple_steps/state.json``.  It is *not* committed to
any repo, and is the only piece of state that lives outside the workspace
itself.  Everything else (projects, pipelines, packs) is workspace-relative.

Schema (v1)
-----------

    {
      "version": 1,
      "last_workspace": "/Users/me/code/youtube-analyzer",
      "recent_workspaces": [
        {"path": "/Users/me/code/youtube-analyzer", "opened_at": "2026-05-17T18:34:12Z"},
        {"path": "/Users/me/code/sandbox",          "opened_at": "2026-05-16T09:11:02Z"}
      ]
    }

Forward-compat for M1 (hosted, multi-user): the *same* file shape will live
under ``~/.simple_steps/users/<user_id>/state.json`` server-side.  No call
site reads the path directly — they all go through this module.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import List, Optional, TypedDict

__all__ = [
    "StateFile",
    "RecentEntry",
    "load_state",
    "save_state",
    "record_workspace_opened",
    "get_last_workspace",
    "get_recent_workspaces",
    "STATE_DIR",
    "STATE_FILE",
]


# ── Paths ──────────────────────────────────────────────────────────────────

# Allow override for tests.  Defaults to ``~/.simple_steps/state.json``.
STATE_DIR = os.environ.get(
    "SIMPLE_STEPS_STATE_DIR",
    os.path.join(os.path.expanduser("~"), ".simple_steps"),
)
STATE_FILE = os.path.join(STATE_DIR, "state.json")

MAX_RECENT = 10
SCHEMA_VERSION = 1


# ── Types ──────────────────────────────────────────────────────────────────


class RecentEntry(TypedDict):
    path: str
    opened_at: str  # ISO-8601 UTC


class StateFile(TypedDict, total=False):
    version: int
    last_workspace: Optional[str]
    recent_workspaces: List[RecentEntry]


def _empty_state() -> StateFile:
    return {
        "version": SCHEMA_VERSION,
        "last_workspace": None,
        "recent_workspaces": [],
    }


# ── Core read / write ──────────────────────────────────────────────────────


def load_state() -> StateFile:
    """Return the on-disk state, or an empty skeleton if the file is missing
    or malformed.  Never raises — corrupt state is treated as no state."""
    if not os.path.isfile(STATE_FILE):
        return _empty_state()
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return _empty_state()

    if not isinstance(data, dict):
        return _empty_state()

    # Cheap forward-compat: drop anything we don't understand, fill defaults.
    state: StateFile = _empty_state()
    state["version"] = int(data.get("version") or SCHEMA_VERSION)
    last = data.get("last_workspace")
    state["last_workspace"] = last if isinstance(last, str) else None
    recents = data.get("recent_workspaces") or []
    cleaned: List[RecentEntry] = []
    if isinstance(recents, list):
        for r in recents:
            if not isinstance(r, dict):
                continue
            p = r.get("path")
            t = r.get("opened_at")
            if isinstance(p, str) and isinstance(t, str):
                cleaned.append({"path": p, "opened_at": t})
    state["recent_workspaces"] = cleaned[:MAX_RECENT]
    return state


def save_state(state: StateFile) -> None:
    """Persist ``state`` to disk, creating ``~/.simple_steps/`` if needed.
    Atomic-ish: writes to a sibling temp file then renames."""
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


# ── High-level helpers ─────────────────────────────────────────────────────


def record_workspace_opened(path: str) -> StateFile:
    """Mark ``path`` as the current workspace and push it to the front of
    the recent list (deduplicated).  Returns the new state."""
    abs_path = os.path.abspath(os.path.expanduser(path))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    state = load_state()
    state["last_workspace"] = abs_path

    # Dedupe: drop any existing entry for the same path, prepend the new one,
    # clamp to MAX_RECENT.
    existing = [r for r in state.get("recent_workspaces", []) if r["path"] != abs_path]
    entry: RecentEntry = {"path": abs_path, "opened_at": now}
    state["recent_workspaces"] = ([entry] + existing)[:MAX_RECENT]

    save_state(state)
    return state


def get_last_workspace() -> Optional[str]:
    """Return the path of the most recently opened workspace, or ``None``."""
    return load_state().get("last_workspace")


def get_recent_workspaces() -> List[RecentEntry]:
    """Return the recent-workspace list, newest first."""
    return load_state().get("recent_workspaces", [])
