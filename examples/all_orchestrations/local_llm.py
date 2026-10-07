"""
local_llm.py — a real language model as a resource: a local Ollama model.

``OllamaLLM`` talks to Ollama's HTTP API (https://ollama.com) with the standard
library, so it needs no extra package. ``app.py`` offers it as the ready-made
resource ``res["local_llm"]`` **only when it can be loaded**: Ollama is running
and has the model. Otherwise the app starts without it and says why.

A small model is plenty for trying it out — the default, ``llama3.2:3b``
(about 2 GB), runs comfortably on an M-series Mac with 16–24 GB of memory::

    ollama pull llama3.2:3b
    ollama serve                 # if the Ollama app isn't already running

Override the model or the server with ``OLLAMA_MODEL`` / ``OLLAMA_HOST``.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from SIMPLE_STEPS import simple_step_resource, simple_step_tool

from tools import LLM

#: The model and server app.py uses, unless the environment says otherwise.
DEFAULT_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")
DEFAULT_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")


def _url(host: str, path: str) -> str:
    host = host if host.startswith("http") else f"http://{host}"
    return host.rstrip("/") + path


def ollama_available(model: str = DEFAULT_MODEL, host: str = DEFAULT_HOST,
                     timeout: float = 1.5) -> tuple[bool, str]:
    """Whether Ollama answers at *host* and has *model*: ``(ok, why not)``."""
    try:
        with urllib.request.urlopen(_url(host, "/api/tags"), timeout=timeout) as response:
            tags = json.loads(response.read())
    except (urllib.error.URLError, OSError, ValueError) as exc:
        reason = getattr(exc, "reason", exc)
        return False, f"Ollama isn't answering at {host} ({reason})"
    names = {m.get("name", "") for m in tags.get("models", [])}
    wanted = {model, f"{model}:latest"} if ":" not in model else {model}
    if not names & wanted:
        have = ", ".join(sorted(names)) or "none"
        return False, f"Ollama doesn't have {model} (it has: {have}); run: ollama pull {model}"
    return True, ""


@simple_step_resource
class OllamaLLM(LLM):
    """A local language model served by Ollama.

    Fits any tool that takes an ``LLM`` (``summarize``), and offers
    ``complete`` as a bound tool: ``res["local_llm"].complete(prompt="…")``.
    """

    def __init__(self, model: str = DEFAULT_MODEL, host: str = DEFAULT_HOST,
                 temperature: float = 0.0, timeout: float = 120.0):
        self.model = model
        self.host = host
        self.temperature = temperature
        self.timeout = timeout

    @simple_step_tool
    def complete(self, prompt: str) -> str:
        """One completion from the local model.

        Args:
            prompt: the text to send to the model.
        """
        body = json.dumps({
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            # temperature 0 and a fixed seed keep a re-run's answer stable.
            "options": {"temperature": self.temperature, "seed": 0},
        }).encode()
        request = urllib.request.Request(
            _url(self.host, "/api/generate"), data=body,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read()).get("response", "").strip()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:200]
            raise RuntimeError(f"Ollama refused the request ({exc.code}): {detail}") from None
        except (urllib.error.URLError, OSError) as exc:
            raise RuntimeError(
                f"Ollama isn't answering at {self.host}: {getattr(exc, 'reason', exc)}"
            ) from None
