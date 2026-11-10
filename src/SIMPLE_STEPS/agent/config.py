"""
config.py — the copilot's saved setting (plan 128, M2; decision C3).

One setting, the same fields as :class:`~.model.Agent`, saved per user in
``~/.simple_steps/agent.json`` (or ``$SIMPLE_STEPS_AGENT_FILE``): outside every
workspace and the repo, readable only by the user (mode 600). A key typed into
the settings panel is kept there and nowhere else: :func:`public_settings`,
the only view the browser gets, says whether one is set, never what it is,
and the copilot is never told it.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict

#: The fields a saved setting may hold.
FIELDS = ("api", "model", "base_url", "api_key_env", "api_key", "temperature", "max_tokens")


def settings_file() -> Path:
    """Where the setting is saved."""
    env = os.environ.get("SIMPLE_STEPS_AGENT_FILE")
    return Path(env) if env else Path.home() / ".simple_steps" / "agent.json"


def _read() -> Dict[str, Any]:
    try:
        data = json.loads(settings_file().read_text())
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if k in FIELDS} if isinstance(data, dict) else {}


def _agent(data: Dict[str, Any]):
    from .model import Agent
    return Agent(**{k: v for k, v in data.items() if v not in (None, "")})


def saved_agent():
    """The copilot's model from the saved setting, or ``None`` when none is saved."""
    data = _read()
    return _agent(data) if data else None


def save_settings(patch: Dict[str, Any]) -> Dict[str, Any]:
    """Merge *patch* into the saved setting and return its public view.

    ``api_key`` is write-only: a value replaces the saved key, ``""`` or
    ``None`` clears it, and leaving it out keeps it. Raises ``ValueError`` for
    a setting the model can't use (an unknown api, say).
    """
    data = _read()
    for key, value in patch.items():
        if key not in FIELDS:
            continue
        if key == "api_key" and not value:
            data.pop("api_key", None)
        else:
            data[key] = value
    _agent(data)                       # refuse what can't work, before writing
    path = settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(path, 0o600)              # an existing file keeps its old mode otherwise
    return public_settings()


def public_settings() -> Dict[str, Any]:
    """The setting in use, as the browser may see it: never the key.
    ``source`` says where it comes from: ``app`` (the App's code, which the
    panel can't change), ``saved``, ``default`` (a local Ollama) or ``off``."""
    from .. import application
    from .model import Agent
    configured = getattr(application.CURRENT, "agent", None)
    if configured is False:
        return {"source": "off", "reason": "the application turned the copilot off (App(agent=False))"}
    if isinstance(configured, Agent):
        return {"source": "app", **configured.public()}
    saved = saved_agent()
    if saved is not None:
        return {"source": "saved", **saved.public()}
    return {"source": "default", **Agent().public()}


def agent_from(settings: Dict[str, Any]):
    """An :class:`~.model.Agent` from the panel's unsaved fields, for Test
    connection; a key left out falls back to the saved one."""
    data = {k: v for k, v in settings.items() if k in FIELDS and v not in (None, "")}
    saved_key = _read().get("api_key")
    if "api_key" not in data and saved_key:
        data["api_key"] = saved_key
    return _agent(data)
