"""
Tests for cookie-based session isolation (P0).

These tests use FastAPI's TestClient to drive the live API surface and
verify that:

  1. ``GET /api/session`` mints a session cookie on first contact.
  2. The cookie is reused across subsequent requests by the same client.
  3. Two independent clients receive distinct session IDs and CANNOT
     read each other's data references — the engine rejects cross-session
     ref lookups with 404 (no information leak).
  4. ``StepRunRequest`` no longer accepts a ``session_id`` field
     from the body — clients cannot spoof identity.
"""
from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from SIMPLE_STEPS.main import app
from SIMPLE_STEPS.decorators import simple_step
from SIMPLE_STEPS.session import SESSION_COOKIE_NAME


# ── Test fixtures: register a trivial source op once ────────────────────────

@simple_step(
    id="session_test_source",
    name="Session Test Source",
    operation_type="source",
)
def _session_test_source() -> pd.DataFrame:
    return pd.DataFrame({"value": [1, 2, 3]})


# ── Helpers ──────────────────────────────────────────────────────────────────

def _new_client() -> TestClient:
    """A fresh TestClient with its own cookie jar — i.e. a fresh 'browser'."""
    return TestClient(app)


def _bootstrap_session(client: TestClient) -> str:
    """Hit /api/session and return the minted cookie value."""
    r = client.get("/api/session")
    assert r.status_code == 200
    sid = client.cookies.get(SESSION_COOKIE_NAME)
    assert sid, "session cookie not set by /api/session"
    return sid


def _run_test_source(client: TestClient) -> str:
    """Execute the test source op via /api/run and return its output_ref_id."""
    r = client.post(
        "/api/run",
        json={
            "step_id": "step-1",
            "operation_id": "session_test_source",
            "config": {},
            "input_ref_id": None,
            "step_map": {},
            "is_preview": False,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["output_ref_id"]


# ── Tests ────────────────────────────────────────────────────────────────────

def test_session_cookie_is_minted_and_persists():
    """First /api/session sets the cookie; subsequent calls reuse it."""
    client = _new_client()
    sid_1 = _bootstrap_session(client)

    # Same client → same cookie reused, NOT regenerated.
    r2 = client.get("/api/session")
    assert r2.status_code == 200
    assert client.cookies.get(SESSION_COOKIE_NAME) == sid_1


def test_two_clients_get_distinct_sessions():
    """Two independent clients (browsers) → two distinct session IDs."""
    a = _new_client()
    b = _new_client()
    sid_a = _bootstrap_session(a)
    sid_b = _bootstrap_session(b)
    assert sid_a != sid_b


def test_data_endpoint_isolates_across_sessions():
    """
    Client A creates a data ref, Client B (different cookie) cannot
    read it back even though it knows the ref_id verbatim.
    """
    a = _new_client()
    b = _new_client()
    _bootstrap_session(a)
    _bootstrap_session(b)

    ref_id = _run_test_source(a)

    # A can read its own ref ✅
    r_a = a.get(f"/api/data/{ref_id}")
    assert r_a.status_code == 200
    assert len(r_a.json()) > 0

    # B cannot, even with the exact same ref_id ❌
    r_b = b.get(f"/api/data/{ref_id}")
    assert r_b.status_code == 404, (
        f"cross-session data leak: client B saw client A's ref "
        f"(status={r_b.status_code}, body={r_b.text!r})"
    )

    # data-meta has the same enforcement
    m_a = a.get(f"/api/data-meta/{ref_id}")
    m_b = b.get(f"/api/data-meta/{ref_id}")
    assert m_a.status_code == 200
    assert m_b.status_code == 404


def test_step_run_request_rejects_session_id_in_body_silently():
    """
    StepRunRequest no longer carries session_id. Older clients that send
    one in the body get the field ignored — the cookie is the only source
    of truth. We verify the run still succeeds and the resulting ref_id
    is bound to the COOKIE session, not whatever the body claimed.
    """
    a = _new_client()
    _bootstrap_session(a)
    cookie_sid = a.cookies.get(SESSION_COOKIE_NAME)

    # Send a fake session_id in the body — should be ignored.
    r = a.post(
        "/api/run",
        json={
            "step_id": "step-1",
            "operation_id": "session_test_source",
            "config": {},
            "input_ref_id": None,
            "step_map": {},
            "is_preview": False,
            "session_id": "attacker-controlled-id-xxx",
        },
    )
    assert r.status_code == 200, r.text
    ref_id = r.json()["output_ref_id"]

    # The ref's embedded session token is derived from the COOKIE, not
    # the body. Client A can fetch it; a fresh client cannot.
    assert a.get(f"/api/data/{ref_id}").status_code == 200

    b = _new_client()
    _bootstrap_session(b)
    assert b.get(f"/api/data/{ref_id}").status_code == 404

    # Sanity: ref token is non-empty and is NOT the attacker-supplied one.
    token = ref_id.split("__", 1)[0]
    assert token
    assert "attacker" not in token


def test_progress_stream_is_session_scoped():
    """
    Without a registered tracker (the common path now), the SSE stream
    immediately emits done. This still works under the session dependency
    — i.e. the dep does not break the streaming response.
    """
    a = _new_client()
    _bootstrap_session(a)
    with a.stream("GET", "/api/progress/nonexistent-step") as r:
        assert r.status_code == 200
        body = b"".join(r.iter_bytes())
    assert b'"done": true' in body
