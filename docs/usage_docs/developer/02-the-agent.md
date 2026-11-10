# 02 — Set up the agent

The agent is a chat pane that writes steps for your users: they describe what
they want, it proposes checked formulas, they apply them. How they use it is
in the User guide, [05 — The agent](../user/05-the-agent.md). This page is
the app side: turning it on, choosing the model, and writing tools it can use
well.

The worked example, with requests to try and a test harness, is
[`examples/agent_demo/`](../../../src/SIMPLE_STEPS/examples/agent_demo/README.md).

## Turn it on

The agent works with any model that writes text. Out of the box it looks for
a local model served by [Ollama](https://ollama.com):

```bash
ollama pull llama3.2:3b                      # the default model, about 2 GB
simple-steps run examples/agent_demo/app.py
```

An app picks the model, or turns the agent off, with `agent=`:

```python
from SIMPLE_STEPS import App
from SIMPLE_STEPS.agent.model import Agent

app = App(tools=[my_tools], agent=Agent(model="qwen2.5:7b"))      # a local Ollama model
app = App(tools=[my_tools], agent=Agent(                          # any OpenAI-compatible server
    model="gpt-4o-mini", api_key_env="OPENAI_API_KEY"))
app = App(tools=[my_tools], agent=Agent(                          # Anthropic
    api="anthropic", model="claude-haiku-5-5", api_key_env="ANTHROPIC_API_KEY"))
app = App(tools=[my_tools], agent=Agent(generate=my_fn))          # any function: messages -> text
app = App(tools=[my_tools])                                       # the settings panel, else a local Ollama
app = App(tools=[my_tools], agent=False)                          # off
```

`api="openai"` (the default) covers OpenAI, Ollama, LM Studio, vLLM,
llama.cpp's server, Groq, OpenRouter and others; set `base_url` for anything
but OpenAI itself.

Without an `agent=` in code, each user picks the model in the agent's
**settings panel** (API, model, base URL, key, temperature), with **Test
connection** to check it. The setting is saved per user in
`~/.simple_steps/agent.json`; a key is write-only and never sent back to the
browser. A model the app sets in code is shown there read-only. From a
terminal, `simple-steps agent test` runs the same check.

`OLLAMA_MODEL` and `OLLAMA_HOST` set the local default. Without a model the
app runs as usual; the chat pane says the agent is off, and why.

## Make your tools easy for it

The agent sees each tool's **name, signature and first docstring line** — not
its code. So:

- name tools for what they do: `line_total`, not `calc`;
- name parameters after the columns they read: `price`, `quantity`;
- make the first docstring line a sentence a user might say;
- use return types and parameter names: `-> list` says expand, `(acc, x)`
  says reducer, `-> bool` says it's a test the agent can filter with.

## Test it against your model

```bash
python examples/agent_demo/ask.py              # five requests, then checks what it built
python examples/agent_demo/ask.py "keep only tea orders"
```

Small models vary; `ask.py` tells you how yours does (`5/5 tasks done right`),
and saves what it built as a workflow you can open.

## Stable, and not yet

**Expect to stay:** proposals are checked before the user sees them; the
agent reads your tools' names, signatures and docstrings.

**Expect to change:** the default model; how much context the agent is given
(plan 128 A1).
