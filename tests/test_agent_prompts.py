"""
Slice-4 tests: agent-prompt content & catalogue assembly.

These tests don't call any LLM — they assert that:

  1. The system prompt contains the explicit guidance that makes ``step``
     the default operation type, frames the agent as the workflow author,
     and explains the cross-step reference syntax.
  2. ``gather_context`` faithfully serialises every operation's ``type``
     so the LLM can apply that guidance.
  3. The current-step section surfaces the existing formula and status,
     enabling the "error recovery → replacement formula" flow.

The point isn't to test prose — it's to lock the *contract* between the
Phase-A engine work (slices 1–3) and what the agent is told about it.
Without this, a refactor of the prompt could silently regress the
"prefer step" bias we just instituted.
"""
from __future__ import annotations

import json

from SIMPLE_STEPS.agent.config import AgentConfig
from SIMPLE_STEPS.agent.graph import AgentState, gather_context
from SIMPLE_STEPS.agent.prompts import (
    CONTEXT_TEMPLATE,
    CURRENT_STEP_SECTION,
    SYSTEM_PROMPT,
)


# ── Prompt-content invariants ────────────────────────────────────────────────

def test_system_prompt_frames_agent_as_workflow_author():
    """The agent must understand its own role: it authors, the user runs."""
    p = SYSTEM_PROMPT.lower()
    assert "workflow author" in p
    assert "user" in p and "run" in p  # user runs the steps
    # Cannot execute / cannot create new ops — invariants from the start.
    assert "cannot" in p
    assert "execute" in p


def test_system_prompt_prefers_step_type():
    """The single most important slice-4 invariant."""
    # The literal phrase that makes 'step' the default.
    assert "Prefer this whenever possible" in SYSTEM_PROMPT
    # The tie-breaker rule.
    assert "pick `step`" in SYSTEM_PROMPT
    # All five legacy modes are explicitly named so the agent recognises
    # them as legacy (and won't accidentally treat them as preferred).
    for legacy in ("`map`", "`filter`", "`expand`", "`dataframe`", "`raw_output`"):
        assert legacy in SYSTEM_PROMPT
    # Orchestrators are explicitly tagged 'Advanced'.
    assert "Advanced" in SYSTEM_PROMPT
    assert "ss_map" in SYSTEM_PROMPT


def test_system_prompt_explains_reference_syntax():
    """Phase-A wires step1.field refs through resolve_reference."""
    assert "step1" in SYSTEM_PROMPT or "stepN" in SYSTEM_PROMPT
    assert "step3.title" in SYSTEM_PROMPT  # dict key access example
    assert "step3.items[0]" in SYSTEM_PROMPT  # list index example
    # The 'no implicit plumbing' contract from engine slice 2.
    assert "no implicit" in SYSTEM_PROMPT.lower() or "There is no implicit" in SYSTEM_PROMPT


def test_system_prompt_describes_error_recovery_flow():
    """User said: 'on errors the agent helps fix the formula' (replace, not append)."""
    p = SYSTEM_PROMPT.lower()
    assert "error" in p
    assert "replacement formula" in p
    # And: do NOT append a new step on error.
    assert "do not append" in p


def test_response_format_demands_type_alongside_formula():
    """So the user sees whether the agent picked a step or legacy op."""
    assert "**Type**" in SYSTEM_PROMPT
    assert "**Formula**" in SYSTEM_PROMPT
    assert "**Operation ID**" in SYSTEM_PROMPT


# ── gather_context assembly ──────────────────────────────────────────────────

def _ops_catalogue() -> list[dict]:
    """A mixed catalogue covering every op type the prompt mentions."""
    return [
        {
            "id": "fetch_videos",
            "label": "Fetch YouTube Videos",
            "type": "step",
            "category": "YouTube",
            "description": "Fetch a list of recent videos from a channel.",
            "params": [
                {"name": "channel", "type": "string"},
                {"name": "limit", "type": "number", "default": 20},
            ],
        },
        {
            "id": "filter_rows",
            "label": "Filter Rows",
            "type": "filter",
            "category": "Tabular",
            "description": "Keep rows matching a predicate.",
            "params": [{"name": "column", "type": "string"}],
        },
        {
            "id": "ss_map",
            "label": "Map (per row)",
            "type": "orchestrator",
            "category": "Orchestration",
            "description": "Apply another op per row.",
            "params": [{"name": "fn", "type": "string"}],
        },
    ]


def _config() -> AgentConfig:
    return AgentConfig()


def test_gather_context_preserves_type_for_every_op():
    state = AgentState(
        user_message="hi",
        available_operations=_ops_catalogue(),
        workflow_steps=[],
    )
    state = gather_context(state, _config())

    # The context prompt must contain every op id AND its type — the prompt
    # rules only fire if the LLM can read both.
    ctx = state.context_prompt
    for op in _ops_catalogue():
        assert f'"id": "{op["id"]}"' in ctx
        assert f'"type": "{op["type"]}"' in ctx


def test_gather_context_uses_overridden_system_prompt():
    cfg = AgentConfig(system_prompt_override="OVERRIDE_PROMPT_XYZ")
    state = gather_context(
        AgentState(user_message="hi", available_operations=[], workflow_steps=[]),
        cfg,
    )
    assert state.system_prompt == "OVERRIDE_PROMPT_XYZ"


def test_gather_context_default_system_prompt_is_slice4_prompt():
    state = gather_context(
        AgentState(user_message="hi", available_operations=[], workflow_steps=[]),
        _config(),
    )
    assert state.system_prompt == SYSTEM_PROMPT


def test_gather_context_surfaces_current_step_for_error_recovery():
    """When the user is debugging, the prompt MUST carry the failing formula."""
    cs = {
        "id": "step-2",
        "label": "Filter videos",
        "formula": "=filter_rows(column=\"views\", value=1000, mode=\"gte\")",
        "status": "failed",
        "configuration": {"column": "views", "value": 1000, "mode": "gte"},
    }
    state = AgentState(
        user_message="this failed",
        available_operations=_ops_catalogue(),
        workflow_steps=[],
        current_step=cs,
    )
    state = gather_context(state, _config())

    ctx = state.context_prompt
    assert "step-2" in ctx
    assert "Filter videos" in ctx
    assert "filter_rows" in ctx
    assert "failed" in ctx


def test_gather_context_omits_current_step_when_none():
    state = AgentState(
        user_message="general question",
        available_operations=[],
        workflow_steps=[],
        current_step=None,
    )
    state = gather_context(state, _config())
    assert "Currently Selected Step" not in state.context_prompt
    assert "No specific step is selected" in state.context_prompt


def test_context_template_is_well_formed():
    """The template must accept the keys gather_context plugs in."""
    rendered = CONTEXT_TEMPLATE.format(
        operations_json="[]",
        steps_json="[]",
        current_step_section="(none)",
        user_message="hello",
    )
    assert "hello" in rendered
    assert "## Available Operations" in rendered
    assert "## Current Workflow Steps" in rendered


def test_current_step_section_template_is_well_formed():
    rendered = CURRENT_STEP_SECTION.format(
        step_id="s1",
        label="My step",
        formula="=foo()",
        status="pending",
        config_json="{}",
    )
    assert "s1" in rendered and "=foo()" in rendered and "pending" in rendered
