"""
The copilot's model: any LLM that writes text, behind one setting (spec 016).

TEST-AGENT-01 covers REQ-AGENT-001 (OpenAI-compatible), TEST-AGENT-02
REQ-AGENT-002 (Anthropic), TEST-AGENT-03 REQ-AGENT-003 (a Python function),
TEST-AGENT-04 REQ-AGENT-004 (JSON found and checked; one repair turn),
TEST-AGENT-05 REQ-AGENT-005 (JSON mode refused), TEST-AGENT-06 REQ-AGENT-006
(keys never shown), TEST-AGENT-07 REQ-AGENT-007 (failures name their cause),
TEST-AGENT-08 REQ-AGENT-008 (the saved setting), TEST-AGENT-09 REQ-AGENT-009
(Test connection). Each server is a local stand-in speaking its wire format:
no network.
"""
from __future__ import annotations

import json
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from SIMPLE_STEPS.agent.model import Agent, ModelError, chat_json, find_json, reachable

SCHEMA = {"type": "object", "properties": {"summary": {"type": "string"},
                                           "steps": {"type": "array", "items": {"type": "object"}}},
          "required": ["summary", "steps"]}


class StubServer:
    """A server that records each request and answers from a list:
    ``(status, body)``, body a dict (sent as JSON) or text."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def _answer(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                stub.requests.append({"path": self.path, "method": self.command,
                                      "headers": {k.lower(): v for k, v in self.headers.items()},
                                      "body": body})
                status, payload = stub.replies.pop(0) if stub.replies else (200, {})
                data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = _answer

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


@pytest.fixture
def stub():
    servers = []

    def make(replies):
        servers.append(StubServer(replies))
        return servers[-1]
    yield make
    for s in servers:
        s.close()


def _openai_reply(text):
    return (200, {"choices": [{"message": {"role": "assistant", "content": text}}]})


MESSAGES = [{"role": "system", "content": "You build workflows."},
            {"role": "user", "content": "add a step"}]
GOOD = '{"summary": "ok", "steps": []}'


# ── TEST-AGENT-01 · REQ-AGENT-001 ────────────────────────────────────────────

def test_an_openai_compatible_server_is_asked_and_answers(stub, monkeypatch):
    """REQ-AGENT-001: chat/completions, the key as a Bearer token, the first choice's text."""
    server = stub([_openai_reply(GOOD)])
    monkeypatch.setenv("TEST_LLM_KEY", "sk-test-123")
    agent = Agent(model="m", base_url=server.url + "/v1", api_key_env="TEST_LLM_KEY")
    assert chat_json(agent, MESSAGES, SCHEMA) == {"summary": "ok", "steps": []}
    request = server.requests[0]
    assert request["path"] == "/v1/chat/completions"
    assert request["headers"]["authorization"] == "Bearer sk-test-123"
    assert request["body"]["model"] == "m" and request["body"]["messages"] == MESSAGES


# ── TEST-AGENT-02 · REQ-AGENT-002 ────────────────────────────────────────────

def test_an_anthropic_server_is_asked_in_its_own_format(stub):
    """REQ-AGENT-002: /v1/messages, system apart, x-api-key and the version header."""
    server = stub([(200, {"content": [{"type": "text", "text": GOOD}]})])
    agent = Agent(api="anthropic", model="claude-sonnet-5-5", base_url=server.url, api_key="k-1")
    assert chat_json(agent, MESSAGES, SCHEMA)["summary"] == "ok"
    request = server.requests[0]
    assert request["path"] == "/v1/messages"
    assert request["headers"]["x-api-key"] == "k-1"
    assert request["headers"]["anthropic-version"]
    assert request["body"]["system"] == "You build workflows."
    assert request["body"]["messages"] == [{"role": "user", "content": "add a step"}]


# ── TEST-AGENT-03 · REQ-AGENT-003 ────────────────────────────────────────────

def test_a_python_function_is_a_model():
    """REQ-AGENT-003: generate(messages) -> str, nothing else needed."""
    seen = []

    def generate(messages):
        seen.append(messages)
        return "Here it is: " + GOOD

    agent = Agent(generate=generate)
    assert chat_json(agent, MESSAGES, SCHEMA)["steps"] == []
    assert seen[0] == MESSAGES and agent.provider == "python"
    assert reachable(agent) == (True, "")


# ── TEST-AGENT-04 · REQ-AGENT-004 ────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    GOOD,
    "Sure! " + GOOD + " Let me know if you need more.",
    "```json\n" + GOOD + "\n```",
    '{"summary": "ok", "steps": [],}',
    '{"summary": "a } inside text", "steps": []}',
])
def test_the_json_is_found_in_the_answer(text):
    """REQ-AGENT-004: whole, after prose, fenced, a trailing comma, a brace in a string."""
    assert set(find_json(text)) == {"summary", "steps"}


def test_an_unusable_answer_gets_one_repair_turn():
    """REQ-AGENT-004: the reason goes back once; the second answer is used."""
    answers = iter(['{"summary": "missing steps"}', GOOD])
    calls = []

    def generate(messages):
        calls.append(messages)
        return next(answers)

    assert chat_json(Agent(generate=generate), MESSAGES, SCHEMA)["summary"] == "ok"
    assert len(calls) == 2
    assert "missing 'steps'" in calls[1][-1]["content"]


def test_a_second_unusable_answer_names_the_reason():
    """REQ-AGENT-004: no third try; the error says what was wrong."""
    with pytest.raises(ModelError, match="no JSON object"):
        chat_json(Agent(generate=lambda m: "I can't help with that."), MESSAGES, SCHEMA)


# ── TEST-AGENT-05 · REQ-AGENT-005 ────────────────────────────────────────────

def test_a_server_that_refuses_json_mode_is_asked_in_plain_text(stub):
    """REQ-AGENT-005: a 400 for response_format, then the same request without it, remembered."""
    server = stub([(400, {"error": "response_format not supported"}), _openai_reply(GOOD), _openai_reply(GOOD)])
    agent = Agent(model="m", base_url=server.url + "/v1")
    chat_json(agent, MESSAGES, SCHEMA)
    chat_json(agent, MESSAGES, SCHEMA)
    bodies = [r["body"] for r in server.requests]
    assert "response_format" in bodies[0]
    assert "response_format" not in bodies[1] and "response_format" not in bodies[2]


# ── TEST-AGENT-06 · REQ-AGENT-006 ────────────────────────────────────────────

def test_a_key_is_never_shown(stub, monkeypatch):
    """REQ-AGENT-006: not in repr, the public setting, the status route, or the messages."""
    from fastapi.testclient import TestClient
    from SIMPLE_STEPS import application
    from SIMPLE_STEPS.main import app

    server = stub([(200, {"data": []}), _openai_reply(GOOD)])
    agent = Agent(model="m", base_url=server.url + "/v1", api_key="sk-very-secret")
    assert "sk-very-secret" not in repr(agent)
    assert "sk-very-secret" not in json.dumps(agent.public())
    assert agent.public()["api_key_set"] is True
    monkeypatch.setattr(application, "CURRENT", types.SimpleNamespace(agent=agent))
    status = TestClient(app).get("/api/agent/status").json()
    assert status["available"] is True and "sk-very-secret" not in json.dumps(status)
    chat_json(agent, MESSAGES, SCHEMA)
    assert "sk-very-secret" not in json.dumps(server.requests[-1]["body"])


# ── TEST-AGENT-07 · REQ-AGENT-007 ────────────────────────────────────────────

def test_nothing_answering_is_named():
    """REQ-AGENT-007: an address with no server says so."""
    agent = Agent(model="m", base_url="http://127.0.0.1:9/v1")
    ok, why = reachable(agent)
    assert not ok and "nothing answers at" in why


def test_a_refused_key_is_named(stub):
    """REQ-AGENT-007: 401 with a key set: the key was refused; without one: no key."""
    server = stub([(401, {"error": "bad key"}), (401, {"error": "no key"})])
    ok, why = reachable(Agent(model="m", base_url=server.url + "/v1", api_key="wrong"))
    assert not ok and "the key was refused" in why
    ok, why = reachable(Agent(model="m", base_url=server.url + "/v1"))
    assert not ok and "no key is set" in why


# ── TEST-AGENT-08 · REQ-AGENT-008 ────────────────────────────────────────────

@pytest.fixture
def saved_file(tmp_path, monkeypatch):
    """A settings file of its own, and no App-given setting."""
    from SIMPLE_STEPS import application
    path = tmp_path / "home" / "agent.json"
    monkeypatch.setenv("SIMPLE_STEPS_AGENT_FILE", str(path))
    monkeypatch.setattr(application, "CURRENT", types.SimpleNamespace(agent=None))
    return path


def test_the_setting_is_saved_for_the_user_and_the_key_never_returned(saved_file):
    """REQ-AGENT-008: mode 600; the API says a key is set, never what it is."""
    import os
    import stat
    from fastapi.testclient import TestClient
    from SIMPLE_STEPS.main import app

    client = TestClient(app)
    assert client.get("/api/agent/config").json()["source"] == "default"
    saved = client.put("/api/agent/config", json={"api": "anthropic", "model": "claude-sonnet-5-5",
                                                  "api_key": "sk-panel-secret"}).json()
    assert saved["source"] == "saved" and saved["api_key_set"] is True
    assert "sk-panel-secret" not in json.dumps(saved)
    assert "sk-panel-secret" not in json.dumps(client.get("/api/agent/config").json())
    assert stat.S_IMODE(os.stat(saved_file).st_mode) == 0o600


def test_a_key_is_write_only(saved_file):
    """REQ-AGENT-008: left out keeps it; an empty value clears it."""
    from SIMPLE_STEPS.agent.config import save_settings, saved_agent
    save_settings({"model": "m", "base_url": "http://127.0.0.1:1/v1", "api_key": "k-1"})
    save_settings({"temperature": 0.5})
    assert saved_agent().key() == "k-1"
    save_settings({"api_key": ""})
    assert saved_agent().key() == ""


def test_the_apps_setting_wins_and_is_read_only(saved_file, monkeypatch):
    """REQ-AGENT-008: an App-given model is reported as source app."""
    from SIMPLE_STEPS import application
    from SIMPLE_STEPS.agent.config import public_settings, save_settings
    save_settings({"model": "saved-model", "base_url": "http://127.0.0.1:1/v1"})
    monkeypatch.setattr(application, "CURRENT", types.SimpleNamespace(agent=Agent(model="app-model")))
    shown = public_settings()
    assert shown["source"] == "app" and shown["model"] == "app-model"


def test_an_unusable_setting_is_refused(saved_file):
    """REQ-AGENT-008: an unknown api is a 400, and nothing is saved."""
    from fastapi.testclient import TestClient
    from SIMPLE_STEPS.main import app
    r = TestClient(app).put("/api/agent/config", json={"api": "carrier-pigeon"})
    assert r.status_code == 400 and not saved_file.exists()


# ── TEST-AGENT-09 · REQ-AGENT-009 ────────────────────────────────────────────

def test_test_connection_tries_the_unsaved_form(saved_file, stub):
    """REQ-AGENT-009: the panel's fields, before saving: ok, or what's wrong."""
    from fastapi.testclient import TestClient
    from SIMPLE_STEPS.main import app
    server = stub([(200, {"data": []}), _openai_reply('{"ok": true}')])
    client = TestClient(app)
    good = client.post("/api/agent/test", json={"model": "m", "base_url": server.url + "/v1"}).json()
    assert good["ok"] is True
    bad = client.post("/api/agent/test", json={"model": "m", "base_url": "http://127.0.0.1:9/v1"}).json()
    assert bad["ok"] is False and "nothing answers at" in bad["detail"]
    assert not saved_file.exists()


def test_the_cli_test_says_what_is_wrong(saved_file, capsys):
    """REQ-AGENT-009: simple-steps agent test: non-zero, naming the problem."""
    from SIMPLE_STEPS.agent.config import save_settings
    from SIMPLE_STEPS.cli import agent_main
    save_settings({"model": "m", "base_url": "http://127.0.0.1:9/v1"})
    assert agent_main(["test"]) == 1
    assert "nothing answers at" in capsys.readouterr().out
