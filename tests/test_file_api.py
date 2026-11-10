"""
The workspace file API stays inside the workspace (spec 015).

TEST-FILE-01 covers REQ-FILE-001: `/api/files`, `/api/files/read` and
`/api/files/write` refuse any path that resolves outside the workspace.
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from SIMPLE_STEPS import main


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """A workspace `ws`, a sibling `ws2` holding a secret, and a symlink out."""
    ws, sibling = tmp_path / "ws", tmp_path / "ws2"
    ws.mkdir()
    sibling.mkdir()
    (ws / "ok.txt").write_text("fine")
    (sibling / "secret.txt").write_text("secret")
    os.symlink(sibling, ws / "link")
    monkeypatch.setattr(main, "_WORKSPACE", str(ws))
    return ws, sibling


@pytest.fixture
def client():
    return TestClient(main.app)


# ── TEST-FILE-01 · REQ-FILE-001 ──────────────────────────────────────────────

def test_paths_inside_the_workspace_work(client, workspace):
    """REQ-FILE-001: a file in the workspace is listed, read and written."""
    ws, _ = workspace
    assert client.get("/api/files").status_code == 200
    assert client.get("/api/files/read", params={"path": "ok.txt"}).json()["content"] == "fine"
    assert client.post("/api/files/write", json={"path": "sub/new.txt", "content": "x"}).status_code == 200
    assert (ws / "sub" / "new.txt").read_text() == "x"


@pytest.mark.parametrize("path", [
    "../ws2/secret.txt",                 # a sibling whose name begins with the workspace's
    "../ws/../ws2/secret.txt",
    "link/secret.txt",                   # a symlink that leads out
])
def test_reading_outside_the_workspace_is_refused(client, workspace, path):
    """REQ-FILE-001: 403, and the secret isn't returned."""
    r = client.get("/api/files/read", params={"path": path})
    assert r.status_code == 403
    assert "secret" not in r.text


def test_an_absolute_path_is_refused(client, workspace):
    """REQ-FILE-001: an absolute path outside the workspace is refused."""
    _, sibling = workspace
    assert client.get("/api/files/read", params={"path": str(sibling / "secret.txt")}).status_code == 403


@pytest.mark.parametrize("path", ["../ws2", "link"])
def test_listing_outside_the_workspace_is_refused(client, workspace, path):
    """REQ-FILE-001: a sibling folder or a symlink out can't be listed."""
    assert client.get("/api/files", params={"path": path}).status_code == 403


@pytest.mark.parametrize("path", ["../ws2/planted.txt", "link/planted.txt"])
def test_writing_outside_the_workspace_is_refused(client, workspace, path):
    """REQ-FILE-001: 403, and no file is written."""
    _, sibling = workspace
    r = client.post("/api/files/write", json={"path": path, "content": "x"})
    assert r.status_code == 403
    assert not (sibling / "planted.txt").exists()
