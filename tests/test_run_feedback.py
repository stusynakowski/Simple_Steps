"""
What ``/api/run`` reports about a run beyond its output (spec 009).

TEST-RUN-01 covers REQ-RUN-001 (core's warnings in the metrics), and
TEST-RUN-03 covers REQ-RUN-003 (rows that failed and weren't caught).
"""
from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from SIMPLE_STEPS.decorators import simple_step_tool
from SIMPLE_STEPS.main import app


@simple_step_tool(id="rf_cities", operation_type="source")
def rf_cities() -> pd.DataFrame:
    return pd.DataFrame({"city": ["SF", "NYC", "LA"], "n": [1, 2, 3]})


@simple_step_tool(id="rf_greet")
def rf_greet(city: str) -> str:
    return f"hi {city}"


@simple_step_tool(id="rf_boom")
def rf_boom(n: int) -> int:
    if n == 2:
        raise ValueError("twos are not allowed")
    return n


@pytest.fixture
def client():
    return TestClient(app)


def _run(client, formula, step_map, operation_id="rf", config=None):
    r = client.post("/api/run", json={
        "step_id": "s", "operation_id": operation_id, "config": config or {},
        "step_map": step_map, "formula": formula,
    })
    assert r.status_code == 200, r.json()
    return r.json()["metrics"]


@pytest.fixture
def cities(client):
    r = client.post("/api/run", json={
        "step_id": "c", "operation_id": "rf_cities", "config": {}, "step_map": {},
        "formula": "=rf_cities[mod.source()]()",
    })
    return {"cities": r.json()["output_ref_id"], "step1": r.json()["output_ref_id"]}


# ── TEST-RUN-01 · REQ-RUN-001 ────────────────────────────────────────────────

def test_metrics_carry_core_warnings(client, cities):
    """REQ-RUN-001: an explicit argument overriding a same-named column warns."""
    metrics = _run(client, '=rf_greet[mod.map()](wf["cities"], city="Paris")', cities)
    assert len(metrics["warnings"]) == 1
    assert "overrides the 'city' column" in metrics["warnings"][0]


def test_metrics_warnings_empty_when_none(client, cities):
    """REQ-RUN-001: the list is present and empty for a step without warnings."""
    metrics = _run(client, '=rf_greet[mod.map()](wf["cities"])', cities)
    assert metrics["warnings"] == []


# ── TEST-RUN-03 · REQ-RUN-003 ────────────────────────────────────────────────

def test_uncaught_failed_counts_own_failures(client, cities):
    """REQ-RUN-003: a row that failed and nothing caught counts."""
    metrics = _run(client, '=rf_boom[mod.map()](wf["cities"])', cities)
    assert metrics["failed"] == 1
    assert metrics["uncaught_failed"] == 1


def test_try_except_without_default_is_caught(client, cities):
    """REQ-RUN-003: try_except() lets the failure through: failed, but caught."""
    metrics = _run(client, '=rf_boom[mod.map(), mod.try_except()](wf["cities"])', cities)
    assert metrics["failed"] == 1
    assert metrics["uncaught_failed"] == 0


def test_try_except_with_default_completes(client, cities):
    """REQ-RUN-003: try_except(default=…) completes the row with the default."""
    metrics = _run(client, '=rf_boom[mod.map(), mod.try_except(default=0)](wf["cities"])', cities)
    assert metrics["failed"] == 0
    assert metrics["uncaught_failed"] == 0
