"""
Slice-3 tests: ``step``-mode raw values are reachable through the HTTP API.

These tests exercise the cookie-bound ``/api/run``, ``/api/data/{ref_id}``,
and ``/api/data-meta/{ref_id}`` endpoints end-to-end via FastAPI's
``TestClient``.  They prove that:

  1. A ``step`` op invoked through ``/api/run`` returns a ref that the
     same client can fetch via ``/api/data`` and ``/api/data-meta``.
  2. ``data-meta`` carries the new ``kind`` discriminator (``"raw"`` for
     step outputs, ``"dataframe"`` for legacy ops).
  3. Raw values serialise into the same ``Cell[]`` shape that the
     existing grid viewer expects.
  4. Cross-session isolation still holds for raw refs.
  5. Pagination works on list-of-dict raw values.
"""
from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from SIMPLE_STEPS.decorators import simple_step
from SIMPLE_STEPS.main import app
from SIMPLE_STEPS.session import SESSION_COOKIE_NAME


# ── Test fixture ops ─────────────────────────────────────────────────────────

@simple_step(
    id="slice3_dict_op",
    name="Slice 3: Dict Output",
    category="Test",
    operation_type="step",
)
def _dict_op(user_id: int) -> dict:
    return {"id": user_id, "name": f"User-{user_id}", "score": 0.87}


@simple_step(
    id="slice3_list_dicts_op",
    name="Slice 3: List of Dicts",
    category="Test",
    operation_type="step",
)
def _list_dicts_op(channel: str) -> list:
    return [
        {"title": "v1", "views": 100},
        {"title": "v2", "views": 200},
        {"title": "v3", "views": 300},
    ]


@simple_step(
    id="slice3_scalar_op",
    name="Slice 3: Scalar Output",
    category="Test",
    operation_type="step",
)
def _scalar_op(x: int) -> int:
    return x * 7


@simple_step(
    id="slice3_legacy_source",
    name="Slice 3: Legacy Source",
    category="Test",
    operation_type="source",
)
def _legacy_source() -> list:
    return [{"a": 1}, {"a": 2}]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _new_client() -> TestClient:
    return TestClient(app)


def _bootstrap(client: TestClient) -> str:
    r = client.get("/api/session")
    assert r.status_code == 200
    return client.cookies.get(SESSION_COOKIE_NAME)


def _run(client: TestClient, op_id: str, config: dict) -> dict:
    r = client.post(
        "/api/run",
        json={
            "step_id": "step-1",
            "operation_id": op_id,
            "config": config,
            "input_ref_id": None,
            "step_map": {},
            "is_preview": False,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


# ── 1. Dict output: end-to-end ───────────────────────────────────────────────

def test_dict_step_op_round_trips_through_api():
    client = _new_client()
    _bootstrap(client)

    run = _run(client, "slice3_dict_op", {"user_id": 42})
    ref = run["output_ref_id"]
    assert run["metrics"]["kind"] == "raw"
    assert run["metrics"]["value_type"] == "dict"

    # data-meta carries the discriminator
    meta = client.get(f"/api/data-meta/{ref}").json()
    assert meta["kind"] == "raw"
    assert meta["value_type"] == "dict"
    assert meta["rows"] == 1
    assert set(meta["columns"]) == {"id", "name", "score"}

    # data view: one row, one cell per dict key
    cells = client.get(f"/api/data/{ref}").json()
    assert len(cells) == 3
    by_col = {c["column_id"]: c for c in cells}
    assert by_col["id"]["value"] == 42
    assert by_col["name"]["value"] == "User-42"
    assert by_col["score"]["value"] == 0.87
    # All cells share row_id == 0
    assert all(c["row_id"] == 0 for c in cells)


# ── 2. list[dict] output: tabular shape ──────────────────────────────────────

def test_list_of_dicts_step_op_serialises_as_table():
    client = _new_client()
    _bootstrap(client)

    run = _run(client, "slice3_list_dicts_op", {"channel": "@x"})
    ref = run["output_ref_id"]
    # Engine and meta endpoint MUST agree on the shape vocabulary.
    assert run["metrics"]["kind"] == "raw"
    assert run["metrics"]["value_type"] == "list[dict]"
    assert run["metrics"]["rows"] == 3
    assert set(run["metrics"]["columns"]) == {"title", "views"}

    meta = client.get(f"/api/data-meta/{ref}").json()
    assert meta == run["metrics"]  # same contract on both endpoints

    cells = client.get(f"/api/data/{ref}").json()
    # 3 rows × 2 columns = 6 cells
    assert len(cells) == 6
    row_ids = sorted({c["row_id"] for c in cells})
    assert row_ids == [0, 1, 2]


def test_list_of_dicts_supports_pagination():
    client = _new_client()
    _bootstrap(client)
    ref = _run(client, "slice3_list_dicts_op", {"channel": "@x"})["output_ref_id"]

    page = client.get(f"/api/data/{ref}?offset=1&limit=1").json()
    assert len(page) == 2  # 1 row × 2 cols
    assert all(c["row_id"] == 1 for c in page)
    titles = [c for c in page if c["column_id"] == "title"]
    assert titles[0]["value"] == "v2"


# ── 3. Scalar output ─────────────────────────────────────────────────────────

def test_scalar_step_op_serialises_as_single_cell():
    client = _new_client()
    _bootstrap(client)

    run = _run(client, "slice3_scalar_op", {"x": 6})
    ref = run["output_ref_id"]
    assert run["metrics"]["kind"] == "raw"

    cells = client.get(f"/api/data/{ref}").json()
    assert len(cells) == 1
    assert cells[0]["row_id"] == 0
    assert cells[0]["column_id"] == "value"
    assert cells[0]["value"] == 42


# ── 4. Legacy DataFrame ops still work and report kind="dataframe" ──────────

def test_legacy_dataframe_op_reports_kind_dataframe():
    client = _new_client()
    _bootstrap(client)

    run = _run(client, "slice3_legacy_source", {})
    ref = run["output_ref_id"]
    # Legacy ops don't populate kind in run metrics — that's fine, frontend
    # will fall back to data-meta which DOES carry the discriminator.
    meta = client.get(f"/api/data-meta/{ref}").json()
    assert meta["kind"] == "dataframe"

    cells = client.get(f"/api/data/{ref}").json()
    assert len(cells) > 0


# ── 5. Cross-session isolation for raw refs ─────────────────────────────────

def test_raw_ref_is_session_isolated():
    """Same P0 invariant as DataFrame refs: B cannot read A's raw ref."""
    a = _new_client(); _bootstrap(a)
    b = _new_client(); _bootstrap(b)

    ref = _run(a, "slice3_dict_op", {"user_id": 1})["output_ref_id"]

    # A reads its own ref
    assert a.get(f"/api/data/{ref}").status_code == 200
    assert a.get(f"/api/data-meta/{ref}").status_code == 200

    # B cannot, even with the verbatim ref
    assert b.get(f"/api/data/{ref}").status_code == 404
    assert b.get(f"/api/data-meta/{ref}").status_code == 404


# ── 6. Sanity: data viewer doesn't choke on None ─────────────────────────────

@simple_step(
    id="slice3_none_op",
    name="Slice 3: Returns None",
    category="Test",
    operation_type="step",
)
def _none_op(message: str) -> None:
    return None


def test_none_step_op_returns_empty_cells():
    client = _new_client()
    _bootstrap(client)

    ref = _run(client, "slice3_none_op", {"message": "hi"})["output_ref_id"]
    cells = client.get(f"/api/data/{ref}").json()
    assert cells == []

    meta = client.get(f"/api/data-meta/{ref}").json()
    assert meta["kind"] == "raw"
    assert meta["value_type"] == "none"
    assert meta["rows"] == 0
