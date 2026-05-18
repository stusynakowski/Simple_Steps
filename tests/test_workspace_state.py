"""Tests for `SIMPLE_STEPS.workspace_state` — the cross-launch state file."""
from __future__ import annotations

import json
import os

import pytest

from SIMPLE_STEPS import workspace_state as ws


@pytest.fixture
def isolated_state(tmp_path, monkeypatch):
    """Redirect STATE_DIR / STATE_FILE into a tmp dir for the test."""
    state_dir = tmp_path / ".simple_steps"
    state_file = state_dir / "state.json"
    monkeypatch.setattr(ws, "STATE_DIR", str(state_dir))
    monkeypatch.setattr(ws, "STATE_FILE", str(state_file))
    return state_dir, state_file


def test_load_state_missing_returns_empty(isolated_state):
    state = ws.load_state()
    assert state["version"] == ws.SCHEMA_VERSION
    assert state["last_workspace"] is None
    assert state["recent_workspaces"] == []


def test_load_state_corrupt_returns_empty(isolated_state):
    state_dir, state_file = isolated_state
    state_dir.mkdir(parents=True, exist_ok=True)
    state_file.write_text("{ this is not json")
    state = ws.load_state()
    assert state["last_workspace"] is None
    assert state["recent_workspaces"] == []


def test_save_then_load_roundtrip(isolated_state, tmp_path):
    p = str(tmp_path / "proj-a")
    os.makedirs(p)
    ws.record_workspace_opened(p)

    state = ws.load_state()
    assert state["last_workspace"] == os.path.abspath(p)
    assert state["recent_workspaces"][0]["path"] == os.path.abspath(p)
    assert "opened_at" in state["recent_workspaces"][0]


def test_record_dedupes_path(isolated_state, tmp_path):
    a = str(tmp_path / "a")
    b = str(tmp_path / "b")
    os.makedirs(a); os.makedirs(b)

    ws.record_workspace_opened(a)
    ws.record_workspace_opened(b)
    ws.record_workspace_opened(a)  # re-open A → should move to front, no dupe

    recents = ws.get_recent_workspaces()
    paths = [r["path"] for r in recents]
    assert paths == [os.path.abspath(a), os.path.abspath(b)]
    assert ws.get_last_workspace() == os.path.abspath(a)


def test_record_clamps_to_max_recent(isolated_state, tmp_path):
    for i in range(ws.MAX_RECENT + 5):
        p = tmp_path / f"w{i}"
        p.mkdir()
        ws.record_workspace_opened(str(p))

    recents = ws.get_recent_workspaces()
    assert len(recents) == ws.MAX_RECENT
    # newest first → the last one written is at the head
    expected_head = os.path.abspath(str(tmp_path / f"w{ws.MAX_RECENT + 4}"))
    assert recents[0]["path"] == expected_head


def test_save_state_is_valid_json(isolated_state, tmp_path):
    ws.record_workspace_opened(str(tmp_path))
    raw = json.loads(open(ws.STATE_FILE).read())
    assert raw["version"] == ws.SCHEMA_VERSION
    assert isinstance(raw["recent_workspaces"], list)


def test_resolve_workspace_root_prefers_env(monkeypatch, isolated_state, tmp_path):
    from SIMPLE_STEPS import file_manager as fm

    env_dir = str(tmp_path / "from-env")
    os.makedirs(env_dir)
    state_dir = str(tmp_path / "from-state")
    os.makedirs(state_dir)
    ws.record_workspace_opened(state_dir)

    monkeypatch.setenv("SIMPLE_STEPS_WORKSPACE", env_dir)
    assert fm._resolve_workspace_root() == env_dir


def test_resolve_workspace_root_falls_back_to_state(monkeypatch, isolated_state, tmp_path):
    from SIMPLE_STEPS import file_manager as fm

    monkeypatch.delenv("SIMPLE_STEPS_WORKSPACE", raising=False)
    state_dir = str(tmp_path / "from-state")
    os.makedirs(state_dir)
    ws.record_workspace_opened(state_dir)

    assert fm._resolve_workspace_root() == os.path.abspath(state_dir)


def test_resolve_workspace_root_falls_back_to_cwd(monkeypatch, isolated_state, tmp_path):
    from SIMPLE_STEPS import file_manager as fm

    monkeypatch.delenv("SIMPLE_STEPS_WORKSPACE", raising=False)
    monkeypatch.chdir(tmp_path)
    # state file exists but last_workspace is None
    assert fm._resolve_workspace_root() == str(tmp_path)
