"""
model.py — the copilot's model: any LLM that writes text, behind one setting
(plan 128, contract 5; decisions C2, C3).

The copilot needs one thing from a model: given messages, return text. It
finds the JSON object in that text itself and checks it against the schema,
so a model without structured output works, and an answer that isn't usable
goes back once with the reason (the repair turn).

Three ways to reach a model, all with the standard library:

- **OpenAI-compatible** ``POST {base_url}/chat/completions``: OpenAI, Ollama,
  LM Studio, vLLM, llama.cpp's server, Groq, Together, OpenRouter, Mistral,
  DeepSeek, Gemini's OpenAI endpoint;
- **Anthropic** ``POST {base_url}/v1/messages``;
- **a Python function** ``generate(messages) -> str``, for anything else.

Which model, in order: ``App(agent=Agent(…))`` (``App(agent=False)`` turns the
copilot off), then the settings panel's saved setting, then a local Ollama at
``OLLAMA_HOST`` with ``OLLAMA_MODEL`` (default ``llama3.2:3b``).

**Keys (C3).** A key comes from ``api_key`` (the App or the settings panel)
or the environment variable named by ``api_key_env``. It is never in the
agent's ``repr``, never in :meth:`Agent.public`, never sent to the browser,
and never part of what the model is told: the copilot sees nothing the user
can't.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

DEFAULT_MODEL = "llama3.2:3b"
DEFAULT_OLLAMA = "http://localhost:11434"
OPENAI_URL = "https://api.openai.com/v1"
ANTHROPIC_URL = "https://api.anthropic.com"
ANTHROPIC_VERSION = "2023-06-01"

#: The APIs a setting can name.
APIS = ("openai", "anthropic")

Messages = List[Dict[str, str]]


@dataclass
class Agent:
    """The copilot's model: ``App(agent=Agent(model="qwen2.5:7b"))``.

    ``api`` is ``"openai"`` (any OpenAI-compatible server, the default) or
    ``"anthropic"``; ``generate`` replaces both with a Python function from
    messages to text.
    """
    model: str = ""
    base_url: str = ""
    api: str = "openai"
    #: The environment variable that holds the key, e.g. ``"OPENAI_API_KEY"``.
    api_key_env: str = ""
    #: A key given directly (the App, or the settings panel, in memory). Never shown.
    api_key: str = field(default="", repr=False)
    #: Any model as a function: ``generate(messages) -> str``.
    generate: Optional[Callable[[Messages], str]] = field(default=None, repr=False)
    temperature: float = 0.0
    max_tokens: int = 2048
    #: Seconds to wait for one answer; a small model on a laptop can be slow.
    timeout: float = 180.0
    #: Times the copilot may correct a proposal that fails its checks.
    retries: int = 2
    #: Older spelling of an Ollama server's address (``base_url`` without ``/v1``).
    host: str = field(default="", repr=False)

    def __post_init__(self) -> None:
        if self.api not in APIS:
            raise ValueError(f"api must be one of {', '.join(APIS)}, not {self.api!r}")
        if not self.base_url:
            if self.host:
                self.base_url = _ollama_v1(self.host)
            elif self.api == "anthropic":
                self.base_url = ANTHROPIC_URL
            elif self.api_key_env or self.api_key:
                self.base_url = OPENAI_URL
            else:
                self.base_url = _ollama_v1(os.environ.get("OLLAMA_HOST", DEFAULT_OLLAMA))
        if not self.model and self.generate is None:
            self.model = os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL) if _is_local(self.base_url) else ""
        if not self.api_key_env:
            if self.api == "anthropic":
                self.api_key_env = "ANTHROPIC_API_KEY"
            elif self.base_url.rstrip("/") == OPENAI_URL:
                self.api_key_env = "OPENAI_API_KEY"
        self._json_mode: Optional[bool] = None       # learnt: does the server take response_format?

    @property
    def provider(self) -> str:
        """What answers: ``python``, ``anthropic`` or ``openai`` (-compatible)."""
        return "python" if self.generate is not None else self.api

    def key(self) -> str:
        """The key, from ``api_key`` or the named environment variable; empty if none."""
        return self.api_key or (os.environ.get(self.api_key_env, "") if self.api_key_env else "")

    def public(self) -> Dict[str, Any]:
        """The setting as the browser may see it: no key, only whether one is set."""
        return {"api": self.api, "provider": self.provider, "model": self.model,
                "base_url": "" if self.generate else self.base_url,
                "api_key_env": self.api_key_env, "api_key_set": bool(self.key()),
                "temperature": self.temperature, "max_tokens": self.max_tokens}


class ModelError(RuntimeError):
    """The model couldn't be reached, refused, or returned nothing usable."""


# ─────────────────────────────────────────────────────────────────────────────
# Which agent, and whether it answers
# ─────────────────────────────────────────────────────────────────────────────

def current_agent() -> Optional[Agent]:
    """The setting in use: the App's, else the saved one, else a local Ollama;
    ``None`` when the App turned the copilot off."""
    from .. import application
    configured = getattr(application.CURRENT, "agent", None)
    if configured is False:
        return None
    if isinstance(configured, Agent):
        return configured
    from .config import saved_agent
    return saved_agent() or Agent()


def resolve() -> Tuple[Optional[Agent], str]:
    """The agent to use, or ``(None, why the copilot is off)``. Checks only
    that the model's server answers and takes the key; :func:`test_connection`
    tries a real request."""
    agent = current_agent()
    if agent is None:
        return None, "the application turned the copilot off (App(agent=False))"
    ok, why = reachable(agent)
    return (agent, "") if ok else (None, why)


def reachable(agent: Agent, timeout: float = 2.0) -> Tuple[bool, str]:
    """Whether the model's server answers and takes the key: ``(ok, why not)``.
    One ``GET …/models``; a Python function always answers."""
    if agent.generate is not None:
        return True, ""
    if not agent.model:
        return False, "no model is set: choose one in the copilot's settings"
    url = (_join(agent.base_url, "/v1/models") if agent.api == "anthropic"
           else _join(agent.base_url, "/models"))
    try:
        _request(agent, url, None, timeout)
    except ModelError as exc:
        text = str(exc)
        # Some OpenAI-compatible servers have no /models; reaching them is enough.
        return (True, "") if "(404)" in text or "(405)" in text else (False, text)
    return True, ""


def test_connection(agent: Agent) -> Dict[str, Any]:
    """One tiny real request, for the settings panel and ``simple-steps agent
    test``: ``{"ok", "model", "detail"}``, where *detail* names what's wrong."""
    ok, why = reachable(agent)
    if not ok:
        return {"ok": False, "model": agent.model, "detail": why}
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}
    try:
        answer = chat_json(agent, [{"role": "user", "content":
                                    'Reply with this JSON object and nothing else: {"ok": true}'}], schema)
    except ModelError as exc:
        return {"ok": False, "model": agent.model, "detail": str(exc)}
    return {"ok": bool(answer.get("ok")), "model": agent.model,
            "detail": "the model answered with usable JSON" if answer.get("ok")
            else "the model answered, but not as asked"}


# ─────────────────────────────────────────────────────────────────────────────
# Asking: text in, JSON found, one repair turn
# ─────────────────────────────────────────────────────────────────────────────

def chat_json(agent: Agent, messages: Messages, schema: Dict[str, Any]) -> Dict[str, Any]:
    """Send *messages*; return the JSON object the answer holds, checked
    against *schema*. An answer that isn't usable goes back once with the
    reason; a second one raises :class:`ModelError` with it."""
    text = complete(agent, messages)
    try:
        return checked(find_json(text), schema)
    except ValueError as first:
        repair = list(messages) + [
            {"role": "assistant", "content": text[:4000]},
            {"role": "user", "content": f"That answer couldn't be used: {first}. "
                                        "Answer again with only the JSON object."},
        ]
        text = complete(agent, repair)
        try:
            return checked(find_json(text), schema)
        except ValueError as second:
            raise ModelError(f"the model's answer couldn't be used: {second}; "
                             f"it said: {text[:200]!r}") from None


def complete(agent: Agent, messages: Messages) -> str:
    """The model's text answer to *messages*."""
    if agent.generate is not None:
        try:
            return str(agent.generate([dict(m) for m in messages]))
        except Exception as exc:  # noqa: BLE001 — the user's function, any failure
            raise ModelError(f"the model function raised {type(exc).__name__}: {exc}") from None
    if agent.api == "anthropic":
        return _anthropic(agent, messages)
    return _openai(agent, messages)


def _openai(agent: Agent, messages: Messages) -> str:
    body: Dict[str, Any] = {"model": agent.model, "messages": messages, "stream": False,
                            "temperature": agent.temperature, "max_tokens": agent.max_tokens}
    if agent._json_mode is not False:
        body["response_format"] = {"type": "json_object"}
    url = _join(agent.base_url, "/chat/completions")
    try:
        reply = _request(agent, url, body, agent.timeout)
        agent._json_mode = agent._json_mode if agent._json_mode is not None else "response_format" in body
    except ModelError as exc:
        if "response_format" not in body or "(400)" not in str(exc):
            raise
        # The server doesn't take JSON mode: ask in plain text, and remember.
        agent._json_mode = False
        body.pop("response_format")
        reply = _request(agent, url, body, agent.timeout)
    try:
        return reply["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise ModelError(f"the server's answer had no message: {json.dumps(reply)[:200]}") from None


def _anthropic(agent: Agent, messages: Messages) -> str:
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    turns = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]
    body: Dict[str, Any] = {"model": agent.model, "max_tokens": agent.max_tokens,
                            "temperature": agent.temperature, "messages": turns}
    if system:
        body["system"] = system
    reply = _request(agent, _join(agent.base_url, "/v1/messages"), body, agent.timeout)
    blocks = reply.get("content") if isinstance(reply, dict) else None
    if not isinstance(blocks, list):
        raise ModelError(f"the server's answer had no content: {json.dumps(reply)[:200]}")
    return "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")


def _request(agent: Agent, url: str, body: Optional[Dict[str, Any]], timeout: float) -> Any:
    """One HTTP call; errors as :class:`ModelError` naming what went wrong (never the key)."""
    headers = {"Content-Type": "application/json"}
    key = agent.key()
    if agent.api == "anthropic":
        headers["anthropic-version"] = ANTHROPIC_VERSION
        if key:
            headers["x-api-key"] = key
    elif key:
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:300]
        if exc.code in (401, 403):
            env = f" (from {agent.api_key_env})" if agent.api_key_env and not agent.api_key else ""
            why = "no key is set" if not key else f"the key{env} was refused"
            raise ModelError(f"{url} refused the request ({exc.code}): {why}") from None
        if exc.code == 404 and body is not None:
            raise ModelError(f"{url} answered 404 (404): check the base URL, and that the model "
                             f"{agent.model!r} exists there. {detail}") from None
        raise ModelError(f"{url} refused the request ({exc.code}): {detail}") from None
    except (urllib.error.URLError, OSError) as exc:
        raise ModelError(f"nothing answers at {agent.base_url} "
                         f"({getattr(exc, 'reason', exc)}). Is the model's server running?") from None
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        raise ModelError(f"{url} didn't answer with JSON: {raw[:200]!r}") from None


# ─────────────────────────────────────────────────────────────────────────────
# Finding and checking the JSON
# ─────────────────────────────────────────────────────────────────────────────

_FENCE = re.compile(r"```(?:json|JSON)?\s*(\{.*?\})\s*```", re.S)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def find_json(text: str) -> Dict[str, Any]:
    """The JSON object in a model's answer: the whole text, a fenced block, or
    the first balanced ``{…}`` after any prose; trailing commas forgiven.
    Raises ``ValueError`` saying why there is none."""
    text = (text or "").strip()
    if not text:
        raise ValueError("the answer was empty")
    candidates = [text] + _FENCE.findall(text)
    start = text.find("{")
    if start >= 0:
        candidates.append(_balanced(text, start))
    for candidate in candidates:
        for attempt in (candidate, _TRAILING_COMMA.sub(r"\1", candidate)):
            try:
                value = json.loads(attempt)
            except ValueError:
                continue
            if isinstance(value, dict):
                return value
    if start < 0:
        raise ValueError("it held no JSON object")
    raise ValueError("its JSON object didn't parse (cut off, or not JSON)")


def _balanced(text: str, start: int) -> str:
    """``text[start:]`` up to the ``}`` that closes the ``{`` at *start*."""
    depth, in_string, escaped = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return text[start:]


def checked(value: Any, schema: Dict[str, Any], path: str = "the answer") -> Any:
    """*value*, if it fits *schema* (``type``, ``properties``, ``required``,
    ``items``: what the copilot's schemas use); else ``ValueError`` naming the
    first mismatch."""
    kind = schema.get("type")
    types = {"object": dict, "array": list, "string": str, "boolean": bool,
             "integer": int, "number": (int, float)}
    if kind in types and (not isinstance(value, types[kind])
                          or (kind in ("integer", "number") and isinstance(value, bool))):
        raise ValueError(f"{path} should be {'an' if kind in ('object', 'array', 'integer') else 'a'} {kind}")
    if kind == "object":
        for name in schema.get("required", []):
            if name not in value:
                raise ValueError(f"{path} is missing {name!r}")
        for name, sub in (schema.get("properties") or {}).items():
            if name in value:
                checked(value[name], sub, f"{name!r}")
    if kind == "array" and "items" in schema:
        for i, item in enumerate(value):
            checked(item, schema["items"], f"{path}[{i}]")
    return value


# ─────────────────────────────────────────────────────────────────────────────

def _join(base: str, path: str) -> str:
    base = base if base.startswith("http") else f"http://{base}"
    return base.rstrip("/") + path


def _ollama_v1(host: str) -> str:
    """An Ollama address as its OpenAI-compatible base: ``…:11434/v1``."""
    host = host if host.startswith("http") else f"http://{host}"
    host = host.rstrip("/")
    return host if host.endswith("/v1") else host + "/v1"


def _is_local(base_url: str) -> bool:
    return any(h in base_url for h in ("localhost", "127.0.0.1", "0.0.0.0"))
