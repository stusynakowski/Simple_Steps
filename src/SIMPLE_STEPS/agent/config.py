"""
Agent configuration — persisted as agent_config.json alongside the projects/ dir.
Users can update LLM provider, model, temperature, and system prompt overrides.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Default paths ────────────────────────────────────────────────────────────

_CONFIG_DIR = os.environ.get(
    "SIMPLE_STEPS_CONFIG_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "agent_config"),
)
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "agent_config.json")


# ── Config model ─────────────────────────────────────────────────────────────

class AgentConfig(BaseModel):
    """User-editable configuration for the step-definition agent."""

    # LLM provider
    provider: Literal["openai", "anthropic", "ollama", "azure_openai"] = "openai"
    model: str = "gpt-4o"
    api_key: Optional[str] = Field(default=None, description="API key (set via env var preferred)")
    base_url: Optional[str] = Field(default=None, description="Custom base URL (for Ollama, Azure, etc.)")

    # Generation parameters
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2048, ge=128, le=16384)

    # Agent behaviour
    system_prompt_override: Optional[str] = Field(
        default=None,
        description="If set, replaces the built-in system prompt entirely.",
    )
    max_iterations: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Max LangGraph iterations before forcing a final answer.",
    )

    # Feature flags
    auto_suggest: bool = Field(
        default=True,
        description="When a new step is added, auto-suggest a function based on context.",
    )
    show_reasoning: bool = Field(
        default=False,
        description="Show the agent's internal reasoning steps in the chat.",
    )


# ── Persistence helpers ──────────────────────────────────────────────────────

def _ensure_dir() -> None:
    os.makedirs(_CONFIG_DIR, exist_ok=True)


def get_agent_config() -> AgentConfig:
    """Load config from disk, or return defaults."""
    if os.path.isfile(_CONFIG_FILE):
        try:
            with open(_CONFIG_FILE) as f:
                data = json.load(f)
            return AgentConfig(**data)
        except Exception:
            pass
    return AgentConfig()


def update_agent_config(patch: dict) -> AgentConfig:
    """Merge `patch` into the current config, persist, and return the result."""
    current = get_agent_config()
    updated = current.model_copy(update=patch)
    _ensure_dir()
    with open(_CONFIG_FILE, "w") as f:
        json.dump(updated.model_dump(), f, indent=2)
    return updated


def save_agent_config(config: AgentConfig) -> None:
    """Full overwrite."""
    _ensure_dir()
    with open(_CONFIG_FILE, "w") as f:
        json.dump(config.model_dump(), f, indent=2)


# ── The saved setting, as the copilot's model (plan 128, M1) ─────────────────

def saved_agent():
    """The copilot's model from the saved settings, or ``None`` when nothing is
    saved. The panel's provider maps onto the model's APIs: OpenAI, Ollama and
    Azure are OpenAI-compatible, Anthropic is its own."""
    from .model import Agent, _ollama_v1
    if not os.path.isfile(_CONFIG_FILE):
        return None
    config = get_agent_config()
    if config.provider == "anthropic":
        return Agent(api="anthropic", model=config.model, base_url=config.base_url or "",
                     api_key=config.api_key or "", temperature=config.temperature,
                     max_tokens=config.max_tokens)
    base_url = config.base_url or ""
    if config.provider == "ollama":
        base_url = _ollama_v1(base_url or os.environ.get("OLLAMA_HOST", "http://localhost:11434"))
    return Agent(api="openai", model=config.model, base_url=base_url,
                 api_key=config.api_key or "", temperature=config.temperature,
                 max_tokens=config.max_tokens)
