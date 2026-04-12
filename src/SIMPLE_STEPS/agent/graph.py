"""
LangGraph agent graph for the Step-Definition Assistant.

The graph has three nodes:
  1. **gather_context** — pulls the operation catalogue and workflow state
  2. **reason**         — calls the LLM with the full prompt
  3. **respond**        — formats the output for the frontend

The graph supports streaming so the frontend can show tokens as they arrive.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from .config import AgentConfig, get_agent_config
from .prompts import (
    SYSTEM_PROMPT,
    CONTEXT_TEMPLATE,
    CURRENT_STEP_SECTION,
    NO_STEP_SECTION,
)

# ── Lightweight state object (plain dataclass — no LangGraph import at module level) ─

@dataclass
class AgentState:
    """Mutable state that flows through the graph."""

    # Inputs
    user_message: str = ""
    workflow_steps: List[Dict[str, Any]] = field(default_factory=list)
    current_step: Optional[Dict[str, Any]] = None
    available_operations: List[Dict[str, Any]] = field(default_factory=list)
    conversation_history: List[Dict[str, str]] = field(default_factory=list)

    # Intermediate
    system_prompt: str = ""
    context_prompt: str = ""

    # Output
    assistant_message: str = ""
    suggested_formula: Optional[str] = None
    error: Optional[str] = None


# ── Helper: build LLM client ─────────────────────────────────────────────────

def _build_llm(config: AgentConfig):
    """
    Build a LangChain-compatible chat model from the agent config.
    Falls back to a simple stub if langchain is not installed.
    """
    try:
        if config.provider == "openai":
            from langchain_openai import ChatOpenAI

            api_key = config.api_key or os.environ.get("OPENAI_API_KEY", "")
            return ChatOpenAI(
                model=config.model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                api_key=api_key,
                base_url=config.base_url or None,
            )

        elif config.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic

            api_key = config.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
            return ChatAnthropic(
                model=config.model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                api_key=api_key,
            )

        elif config.provider == "ollama":
            from langchain_ollama import ChatOllama

            return ChatOllama(
                model=config.model,
                temperature=config.temperature,
                base_url=config.base_url or "http://localhost:11434",
            )

        elif config.provider == "azure_openai":
            from langchain_openai import AzureChatOpenAI

            return AzureChatOpenAI(
                model=config.model,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
                api_key=config.api_key or os.environ.get("AZURE_OPENAI_API_KEY", ""),
                azure_endpoint=config.base_url or os.environ.get("AZURE_OPENAI_ENDPOINT", ""),
                api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
            )

        else:
            raise ValueError(f"Unsupported provider: {config.provider}")

    except ImportError as exc:
        raise ImportError(
            f"LangChain provider '{config.provider}' requires additional packages. "
            f"Install them with: pip install langchain-{config.provider}. "
            f"Original error: {exc}"
        ) from exc


# ── Graph nodes ──────────────────────────────────────────────────────────────

def gather_context(state: AgentState, config: AgentConfig) -> AgentState:
    """Build the system + context prompts from the current state."""

    state.system_prompt = config.system_prompt_override or SYSTEM_PROMPT

    # Compact JSON for operations (id, label, type, params only)
    ops_compact = []
    for op in state.available_operations:
        ops_compact.append({
            "id": op.get("id"),
            "label": op.get("label"),
            "type": op.get("type"),
            "category": op.get("category", "General"),
            "description": op.get("description", ""),
            "params": [
                {"name": p["name"], "type": p["type"], "default": p.get("default")}
                for p in op.get("params", [])
            ],
        })

    # Current step section
    if state.current_step:
        cs = state.current_step
        step_section = CURRENT_STEP_SECTION.format(
            step_id=cs.get("id", "?"),
            label=cs.get("label", "?"),
            formula=cs.get("formula", ""),
            status=cs.get("status", "pending"),
            config_json=json.dumps(cs.get("configuration", {}), indent=2),
        )
    else:
        step_section = NO_STEP_SECTION

    # Steps summary
    steps_summary = []
    for s in state.workflow_steps:
        steps_summary.append({
            "index": s.get("sequence_index"),
            "id": s.get("id"),
            "label": s.get("label"),
            "formula": s.get("formula", ""),
            "status": s.get("status", "pending"),
        })

    state.context_prompt = CONTEXT_TEMPLATE.format(
        operations_json=json.dumps(ops_compact, indent=2),
        steps_json=json.dumps(steps_summary, indent=2),
        current_step_section=step_section,
        user_message=state.user_message,
    )

    return state


def reason(state: AgentState, config: AgentConfig) -> AgentState:
    """Call the LLM with system prompt + conversation history + new context."""

    try:
        llm = _build_llm(config)
    except (ImportError, ValueError) as e:
        state.error = str(e)
        state.assistant_message = f"⚠️ Agent configuration error: {e}"
        return state

    from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

    messages = [SystemMessage(content=state.system_prompt)]

    # Add conversation history (last N turns to stay within context window)
    max_history = 20
    for msg in state.conversation_history[-max_history:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            messages.append(AIMessage(content=msg["content"]))

    # Add the new user turn with full context
    messages.append(HumanMessage(content=state.context_prompt))

    try:
        response = llm.invoke(messages)
        state.assistant_message = response.content

        # Try to extract a formula suggestion (=operation(...))
        import re
        formula_match = re.search(r'`(=[a-zA-Z_]\w*\(.*?\))`', state.assistant_message)
        if formula_match:
            state.suggested_formula = formula_match.group(1)

    except Exception as e:
        state.error = str(e)
        state.assistant_message = f"⚠️ LLM call failed: {e}"

    return state


async def reason_streaming(state: AgentState, config: AgentConfig):
    """
    Async generator that yields tokens as they arrive from the LLM.
    Used by the WebSocket endpoint for real-time streaming.
    """

    try:
        llm = _build_llm(config)
    except (ImportError, ValueError) as e:
        yield f"⚠️ Agent configuration error: {e}"
        return

    from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

    messages = [SystemMessage(content=state.system_prompt)]

    max_history = 20
    for msg in state.conversation_history[-max_history:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
        else:
            messages.append(AIMessage(content=msg["content"]))

    messages.append(HumanMessage(content=state.context_prompt))

    try:
        async for chunk in llm.astream(messages):
            if hasattr(chunk, "content") and chunk.content:
                yield chunk.content
    except Exception as e:
        yield f"\n\n⚠️ Streaming failed: {e}"


# ── Build the LangGraph graph ────────────────────────────────────────────────

def build_agent_graph():
    """
    Construct and compile the LangGraph StateGraph.
    Returns a compiled graph or None if langgraph is not installed.
    """
    try:
        from langgraph.graph import StateGraph, END
    except ImportError:
        return None

    graph = StateGraph(AgentState)

    config = get_agent_config()

    graph.add_node("gather_context", lambda s: gather_context(s, config))
    graph.add_node("reason", lambda s: reason(s, config))

    graph.set_entry_point("gather_context")
    graph.add_edge("gather_context", "reason")
    graph.add_edge("reason", END)

    return graph.compile()


# ── Convenience invoke function ──────────────────────────────────────────────

def invoke_agent(
    user_message: str,
    workflow_steps: List[Dict[str, Any]],
    available_operations: List[Dict[str, Any]],
    current_step: Optional[Dict[str, Any]] = None,
    conversation_history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Single-shot invocation: run the agent and return the response.
    Falls back to non-graph path if langgraph is not installed.
    """
    config = get_agent_config()

    state = AgentState(
        user_message=user_message,
        workflow_steps=workflow_steps,
        available_operations=available_operations,
        current_step=current_step,
        conversation_history=conversation_history or [],
    )

    # Gather context
    state = gather_context(state, config)

    # Run reasoning
    state = reason(state, config)

    return {
        "message": state.assistant_message,
        "suggested_formula": state.suggested_formula,
        "error": state.error,
    }


async def invoke_agent_streaming(
    user_message: str,
    workflow_steps: List[Dict[str, Any]],
    available_operations: List[Dict[str, Any]],
    current_step: Optional[Dict[str, Any]] = None,
    conversation_history: Optional[List[Dict[str, str]]] = None,
):
    """
    Async streaming invocation: yields tokens as they arrive.
    """
    config = get_agent_config()

    state = AgentState(
        user_message=user_message,
        workflow_steps=workflow_steps,
        available_operations=available_operations,
        current_step=current_step,
        conversation_history=conversation_history or [],
    )

    state = gather_context(state, config)

    async for token in reason_streaming(state, config):
        yield token
