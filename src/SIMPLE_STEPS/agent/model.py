"""
model.py — which language model the agent uses, and how it is called.

The agent (docs/dev_plan/122 §3) needs one thing from a model: given messages,
return JSON matching a schema. For the MVP that's a local **Ollama** model,
called over its HTTP API with the standard library (no extra package), using
Ollama's structured-output mode (``format`` = a JSON schema) so even a small
model returns well-formed proposals.

Which model, in order:

1. ``App(agent=Agent(…))`` — the application says; ``App(agent=False)`` turns
   the agent off;
2. ``agent_config.json`` with ``"provider": "ollama"`` (the agent settings
   panel): its ``model``, ``base_url`` and ``temperature``;
3. a local Ollama, if it is running and has ``OLLAMA_MODEL`` (default
   ``llama3.2:3b``) — at ``OLLAMA_HOST`` (default ``http://localhost:11434``).

If none can be used, :func:`resolve` says why and the agent is off; nothing
else in the app depends on it.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_MODEL = "llama3.2:3b"
DEFAULT_HOST = "http://localhost:11434"


@dataclass
class Agent:
    """The agent's model, for ``App(agent=Agent(model="qwen2.5:7b"))``."""
    model: str = ""
    host: str = ""
    provider: str = "ollama"
    temperature: float = 0.0
    #: Seconds to wait for one answer; a small model on a laptop can be slow.
    timeout: float = 180.0
    #: Times the agent may correct a proposal that fails its checks.
    retries: int = 2

    def __post_init__(self) -> None:
        self.model = self.model or os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL)
        self.host = self.host or os.environ.get("OLLAMA_HOST", DEFAULT_HOST)


class ModelError(RuntimeError):
    """The model couldn't be reached or returned something unusable."""


def _url(host: str, path: str) -> str:
    host = host if host.startswith("http") else f"http://{host}"
    return host.rstrip("/") + path


def ollama_has(model: str, host: str, timeout: float = 1.5) -> Tuple[bool, str]:
    """Whether Ollama answers at *host* and has *model*: ``(ok, why not)``."""
    try:
        with urllib.request.urlopen(_url(host, "/api/tags"), timeout=timeout) as r:
            tags = json.loads(r.read())
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return False, f"Ollama isn't answering at {host} ({getattr(exc, 'reason', exc)})"
    names = {m.get("name", "") for m in tags.get("models", [])}
    wanted = {model} if ":" in model else {model, f"{model}:latest"}
    if not names & wanted:
        return False, (f"Ollama doesn't have {model} (it has: {', '.join(sorted(names)) or 'none'}); "
                       f"run: ollama pull {model}")
    return True, ""


def resolve() -> Tuple[Optional[Agent], str]:
    """The agent to use, or ``(None, why the agent is off)``."""
    from .. import application
    configured = getattr(application.CURRENT, "agent", None)
    if configured is False:
        return None, "the application turned the agent off (App(agent=False))"
    agent: Optional[Agent] = configured if isinstance(configured, Agent) else None
    if agent is None:
        agent = _from_config_file() or Agent()
    if agent.provider != "ollama":
        return None, (f"the agent supports Ollama so far; {agent.provider!r} is configured. "
                      "Set provider to ollama in the agent settings")
    ok, why = ollama_has(agent.model, agent.host)
    return (agent, "") if ok else (None, why)


def _from_config_file() -> Optional[Agent]:
    """An Agent from ``agent_config.json``, when it names Ollama explicitly."""
    from .config import _CONFIG_FILE
    if not os.path.isfile(_CONFIG_FILE):
        return None
    try:
        with open(_CONFIG_FILE) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if data.get("provider") != "ollama":
        return None
    return Agent(model=data.get("model") or "", host=data.get("base_url") or "",
                 temperature=float(data.get("temperature") or 0.0))


def chat_json(agent: Agent, messages: List[Dict[str, str]], schema: Dict[str, Any]) -> Dict[str, Any]:
    """Send *messages*; return the model's answer parsed as JSON matching *schema*."""
    body = json.dumps({
        "model": agent.model,
        "messages": messages,
        "stream": False,
        "format": schema,
        "options": {"temperature": agent.temperature, "seed": 0},
    }).encode()
    request = urllib.request.Request(_url(agent.host, "/api/chat"), data=body,
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=agent.timeout) as r:
            reply = json.loads(r.read())
    except urllib.error.HTTPError as exc:
        raise ModelError(f"Ollama refused the request ({exc.code}): "
                         f"{exc.read().decode(errors='replace')[:200]}") from None
    except (urllib.error.URLError, OSError) as exc:
        raise ModelError(f"Ollama isn't answering at {agent.host}: {getattr(exc, 'reason', exc)}") from None
    content = (reply.get("message") or {}).get("content", "")
    try:
        parsed = json.loads(content)
    except ValueError:
        raise ModelError(f"the model's answer wasn't JSON: {content[:200]!r}") from None
    if not isinstance(parsed, dict):
        raise ModelError(f"the model's answer wasn't a JSON object: {content[:200]!r}")
    return parsed
