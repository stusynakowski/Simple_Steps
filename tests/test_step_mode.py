"""
Slice-1 tests for the new ``step`` operation type.

This slice is intentionally narrow: it only verifies that
``ORCHESTRATORS["step"]`` exists, that ``@simple_step(operation_type="step")``
registers correctly without DataFrame coercion, and that the wrapper
returns the function's raw value unchanged.

The engine integration (``RAW_STORE``, dict-field reference resolution,
frontend rendering) lands in subsequent slices.
"""
from __future__ import annotations

import pandas as pd
import pytest

from SIMPLE_STEPS.decorators import simple_step, OPERATION_REGISTRY
from SIMPLE_STEPS.orchestrators import ORCHESTRATORS, step_wrapper


# ── Wrapper-level behaviour ──────────────────────────────────────────────────

def test_step_wrapper_is_registered():
    """The new mode must be in the wrapper registry alongside the legacy modes."""
    assert "step" in ORCHESTRATORS
    assert ORCHESTRATORS["step"] is step_wrapper


def test_step_wrapper_returns_dict_unchanged():
    """A function returning a dict must come back as the same dict — no DataFrame coercion."""
    def fetch_user(user_id: int) -> dict:
        return {"id": user_id, "name": "Alice", "score": 0.87}

    wrapped = step_wrapper(fetch_user)
    out = wrapped(user_id=42)

    assert isinstance(out, dict), f"expected dict, got {type(out).__name__}"
    assert out == {"id": 42, "name": "Alice", "score": 0.87}


def test_step_wrapper_returns_scalar_unchanged():
    """A function returning a scalar must come back as that scalar."""
    def double(x: int) -> int:
        return x * 2

    out = step_wrapper(double)(x=21)
    assert out == 42
    assert isinstance(out, int)


def test_step_wrapper_returns_list_unchanged():
    """A function returning a list must come back as that list — not as a DataFrame of one row."""
    def list_videos(channel: str) -> list:
        return [{"title": "a"}, {"title": "b"}, {"title": "c"}]

    out = step_wrapper(list_videos)(channel="@mkbhd")
    assert isinstance(out, list)
    assert len(out) == 3
    assert out[0] == {"title": "a"}


def test_step_wrapper_returns_none_unchanged():
    """A function returning None (a side-effecting tool) must come back as None."""
    def log_event(message: str) -> None:
        return None

    assert step_wrapper(log_event)(message="hello") is None


def test_step_wrapper_strips_underscore_prefixed_kwargs():
    """
    Engine-injected plumbing keys (``_input_df``, ``_orchestrator``, etc.)
    must NOT reach the user's function — they're internal contract between
    the engine and the wrapper.
    """
    seen_kwargs: dict = {}

    def my_tool(real_arg: str) -> str:
        # If _input_df leaked through, this would TypeError.
        seen_kwargs["real_arg"] = real_arg
        return real_arg.upper()

    out = step_wrapper(my_tool)(
        real_arg="hello",
        _input_df=pd.DataFrame({"junk": [1]}),
        _orchestrator="step",
    )
    assert out == "HELLO"
    assert seen_kwargs == {"real_arg": "hello"}


# ── Decorator-level registration ─────────────────────────────────────────────

def test_simple_step_registers_step_type():
    """
    @simple_step(operation_type="step") must register without Pydantic
    rejecting the new literal value.
    """
    @simple_step(
        id="slice1_step_test_op",
        name="Slice 1 Step Test",
        category="Test",
        operation_type="step",
    )
    def my_op(name: str, count: int = 1) -> dict:
        return {"name": name, "count": count}

    entry = OPERATION_REGISTRY.get("slice1_step_test_op")
    assert entry is not None, "decorator did not register the op"
    assert entry["type"] == "step"
    assert entry["definition"].type == "step"
    # Param inference should still work
    param_names = [p.name for p in entry["definition"].params]
    assert "name" in param_names
    assert "count" in param_names


def test_existing_op_types_still_work():
    """
    Adding 'step' to the type literal must NOT break registrations for
    the legacy modes.  Smoke-test by registering one of each.
    """
    for op_type in ("source", "map", "filter", "expand", "dataframe", "raw_output"):
        op_id = f"slice1_legacy_{op_type}"

        @simple_step(
            id=op_id,
            name=f"Legacy {op_type}",
            category="Test",
            operation_type=op_type,
        )
        def _f(x: int = 0) -> int:
            return x

        entry = OPERATION_REGISTRY.get(op_id)
        assert entry is not None
        assert entry["type"] == op_type
