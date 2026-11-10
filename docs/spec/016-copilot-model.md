# Specification: The copilot's model

Plan 128, contract 5, decisions C2–C3: one setting, and any model that writes
text works (`src/SIMPLE_STEPS/agent/model.py`).

- **REQ-AGENT-001:** an OpenAI-compatible server is asked at
  `{base_url}/chat/completions`, with the key as a Bearer token when one is
  set; the answer's text is the first choice's message.
- **REQ-AGENT-002:** an Anthropic server is asked at `{base_url}/v1/messages`,
  the system messages sent as `system`, the key as `x-api-key`, with the
  `anthropic-version` header; the answer's text is its text blocks.
- **REQ-AGENT-003:** a Python function `generate(messages) -> str` is a model.
- **REQ-AGENT-004:** the JSON object is found in the answer's text (the whole
  text, a fenced block, or after prose; trailing commas forgiven) and checked
  against the schema. An unusable answer goes back once with the reason; a
  second unusable answer is an error that names the reason.
- **REQ-AGENT-005:** JSON mode is asked for where a server takes it; a server
  that refuses it (400) is asked again in plain text, and remembered.
- **REQ-AGENT-006:** a key is never shown: not in the agent's `repr`, not in
  its public setting or the status route, and never in the messages the model
  is sent. The copilot sees nothing the user can't (C3).
- **REQ-AGENT-007:** a failure names its cause: nothing answering at the URL,
  no key, a refused key, an unusable answer.
- **REQ-AGENT-008:** the setting is saved per user, outside every workspace
  (`~/.simple_steps/agent.json`, or `$SIMPLE_STEPS_AGENT_FILE`), readable only
  by the user (mode 600). `GET /api/agent/config` returns it with where it
  comes from (`app`, `saved`, `default`) and whether a key is set, never the
  key. A key is write-only: a value replaces it, `""` clears it, leaving it
  out keeps it. A setting the App gives in code wins over the saved one.
- **REQ-AGENT-009:** Test connection (`POST /api/agent/test`, and
  `simple-steps agent test`) sends one tiny real request, with the panel's
  unsaved fields or the setting in use, and says what's wrong if anything.
