"""
Slice-2 tests for ``step``-mode end-to-end through ``run_operation``.

What this slice proves
----------------------
1.  A ``step``-mode op's return value is preserved as-is in ``RAW_STORE``
    — no DataFrame coercion.
2.  Reference resolution understands ``step1.field`` for dict outputs of
    upstream ``step``-mode ops.
3.  Bare ``step1`` references resolve to the raw value.
4.  Pydantic models / dataclasses also work with attribute-style access.
5.  Cross-session isolation still holds for raw values (the P0 invariant).
6.  Returned metrics carry a ``kind`` discriminator so the frontend can
    pick a renderer without hitting ``/api/data``.

What is intentionally NOT in this slice
---------------------------------------
- ``/api/data/{ref_id}`` does not yet know how to serialize raw values.
  That's slice 3.
- The frontend has no awareness of ``kind`` yet.  Slice 3.
- The agent prompt still recommends tabular ops.  Slice 4.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import pytest

from SIMPLE_STEPS.decorators import simple_step
from SIMPLE_STEPS.engine import (
    DATA_STORE,
    RAW_STORE,
    get_value,
    run_operation,
    save_raw_value,
)


# ── Test fixture ops ─────────────────────────────────────────────────────────

@simple_step(
    id="slice2_fetch_user",
    name="Slice 2: Fetch User",
    category="Test",
    operation_type="step",
)
def _fetch_user(user_id: int) -> dict:
    return {"id": user_id, "name": f"User-{user_id}", "score": 0.87}


@simple_step(
    id="slice2_extract_name",
    name="Slice 2: Extract Name",
    category="Test",
    operation_type="step",
)
def _extract_name(name: str) -> str:
    return name.upper()


@simple_step(
    id="slice2_count_videos",
    name="Slice 2: Count Videos",
    category="Test",
    operation_type="step",
)
def _count_videos(videos: list) -> int:
    return len(videos)


@simple_step(
    id="slice2_list_videos",
    name="Slice 2: List Videos",
    category="Test",
    operation_type="step",
)
def _list_videos(channel: str) -> list:
    return [
        {"title": "v1", "views": 100},
        {"title": "v2", "views": 200},
    ]


@dataclass
class _UserModel:
    id: int
    name: str


@simple_step(
    id="slice2_fetch_user_model",
    name="Slice 2: Fetch User (dataclass)",
    category="Test",
    operation_type="step",
)
def _fetch_user_model(user_id: int) -> _UserModel:
    return _UserModel(id=user_id, name=f"User-{user_id}")


# ── 1. Dict output is preserved as a dict ────────────────────────────────────

def test_step_op_dict_output_lands_in_raw_store():
    out_ref, metrics = run_operation(
        op_id="slice2_fetch_user",
        config={"user_id": 42},
        input_ref_id=None,
    )
    value = get_value(out_ref)
    assert isinstance(value, dict), f"expected dict, got {type(value).__name__}"
    assert value == {"id": 42, "name": "User-42", "score": 0.87}
    assert metrics["kind"] == "raw"
    assert metrics["value_type"] == "dict"
    assert metrics["rows"] == 1
    assert set(metrics["columns"]) == {"id", "name", "score"}


# ── 2. step1.field reference resolution (dict access) ────────────────────────

def test_step_field_reference_pulls_dict_value():
    """
    Two-step pipeline:
        step1: fetch_user(user_id=42)            → {"id": 42, "name": "User-42", ...}
        step2: extract_name(name=step1.name)     → "USER-42"

    The raw store and dict-key resolution must cooperate.
    """
    ref1, _ = run_operation(
        op_id="slice2_fetch_user",
        config={"user_id": 42},
        input_ref_id=None,
    )
    step_map = {"step1": ref1}

    ref2, metrics2 = run_operation(
        op_id="slice2_extract_name",
        config={"name": "step1.name"},
        input_ref_id=ref1,
        step_label_map=step_map,
    )
    value = get_value(ref2)
    assert value == "USER-42"
    assert metrics2["kind"] == "raw"


# ── 3. Bare step reference returns the whole raw value ──────────────────────

def test_bare_step_reference_returns_raw_value():
    """
    step1: list_videos(channel="@x")   → [{...}, {...}]
    step2: count_videos(videos=step1)  → 2
    """
    ref1, _ = run_operation(
        op_id="slice2_list_videos",
        config={"channel": "@x"},
        input_ref_id=None,
    )
    step_map = {"step1": ref1}

    ref2, _ = run_operation(
        op_id="slice2_count_videos",
        config={"videos": "step1"},
        input_ref_id=ref1,
        step_label_map=step_map,
    )
    assert get_value(ref2) == 2


# ── 4. Attribute access on Pydantic-like objects ─────────────────────────────

def test_step_field_reference_pulls_dataclass_attribute():
    """``step1.name`` on a dataclass output uses ``getattr``."""
    ref1, _ = run_operation(
        op_id="slice2_fetch_user_model",
        config={"user_id": 7},
        input_ref_id=None,
    )
    step_map = {"step1": ref1}

    ref2, _ = run_operation(
        op_id="slice2_extract_name",
        config={"name": "step1.name"},
        input_ref_id=ref1,
        step_label_map=step_map,
    )
    assert get_value(ref2) == "USER-7"


# ── 5. Session isolation for raw values ──────────────────────────────────────

def test_raw_value_session_isolation():
    """A ref minted in session A must not be readable from session B."""
    ref_a, _ = run_operation(
        op_id="slice2_fetch_user",
        config={"user_id": 1},
        input_ref_id=None,
        session_id="alice",
    )
    # Alice can read her own ref
    assert get_value(ref_a, session_id="alice") == {"id": 1, "name": "User-1", "score": 0.87}
    # Bob cannot, even with the verbatim ref_id
    assert get_value(ref_a, session_id="bob") is None


# ── 6. Missing field returns the unresolved string (graceful) ────────────────

def test_missing_field_falls_through_unchanged():
    """
    If ``step1.does_not_exist`` cannot be resolved, the literal string is
    passed to the function (legacy behaviour for unresolvable refs).  The
    function will then either accept the string or raise — but the engine
    itself does not blow up.
    """
    ref1, _ = run_operation(
        op_id="slice2_fetch_user",
        config={"user_id": 1},
        input_ref_id=None,
    )
    step_map = {"step1": ref1}

    ref2, _ = run_operation(
        op_id="slice2_extract_name",
        config={"name": "step1.does_not_exist"},
        input_ref_id=ref1,
        step_label_map=step_map,
    )
    # The literal "step1.does_not_exist" got upper()'d
    assert get_value(ref2) == "STEP1.DOES_NOT_EXIST"


# ── 7. Step ops do NOT pollute DATA_STORE ────────────────────────────────────

def test_step_op_does_not_write_to_data_store():
    """Step outputs go to RAW_STORE, leaving DATA_STORE untouched for that ref."""
    ref, _ = run_operation(
        op_id="slice2_fetch_user",
        config={"user_id": 99},
        input_ref_id=None,
        session_id="iso-test",
    )
    token = ref.split("__", 1)[0]
    assert ref in RAW_STORE.get(token, {}), "ref missing from RAW_STORE"
    assert ref not in DATA_STORE.get(token, {}), "step ref leaked into DATA_STORE"


# ── 8. Tabular ops still write to DATA_STORE (not RAW_STORE) ─────────────────

@simple_step(
    id="slice2_legacy_source",
    name="Slice 2: Legacy Source",
    category="Test",
    operation_type="source",
)
def _legacy_source() -> list:
    return [{"a": 1}, {"a": 2}]


def test_legacy_op_still_writes_to_data_store():
    """Existing op types must keep their DataFrame-store behaviour."""
    ref, metrics = run_operation(
        op_id="slice2_legacy_source",
        config={},
        input_ref_id=None,
        session_id="iso-legacy",
    )
    token = ref.split("__", 1)[0]
    assert ref in DATA_STORE.get(token, {}), "legacy ref missing from DATA_STORE"
    assert ref not in RAW_STORE.get(token, {}), "legacy ref leaked into RAW_STORE"
    # Legacy ops do not set the 'kind' discriminator (slice 3 may add it).
    assert "kind" not in metrics or metrics.get("kind") == "dataframe"
