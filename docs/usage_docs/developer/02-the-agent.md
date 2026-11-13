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

## Plug in any LLM

The copilot needs one thing from a model: messages in, text out. It finds the
JSON in the answer itself (in a code fence, after prose, with trailing
commas) and checks it, so a model without structured output works. Anything
the two wire formats don't cover is a function:

```python
def my_model(messages: list[dict]) -> str:
    """messages: [{"role": "system" | "user" | "assistant", "content": str}]"""
    return my_client.complete(messages)          # a transformers model, a gateway, …

app = App(tools=[my_tools], agent=Agent(generate=my_model))
```

Small models do better with `temperature=0` (the default) and a few
`retries` (default 2): each answer that fails the checks goes back with the
reason.

## How a session works

One **session per workflow**, saved as JSON in
`<workspace>/.simple_steps/agent_sessions/<workflow id>.json`. It moves
through three phases, and each turn does one thing
([spec 018](../../spec/018-copilot-sessions.md)):

![A copilot session: Plan (questions or a checked plan), Accept, then Build one milestone at a time (propose, wait or validate, with you applying and running in between), then Done](img/copilot-session.svg)

Every arrow out of a plain box is one turn. The dashed boxes are what you
do. If no model is set, or a model call fails, the turn replies with an
error and the state doesn't change.

- **Plan** asks the model for questions (at most three) or a plan. The plan
  is checked: real tools, usable resources, unique names, milestones that
  name planned steps. Problems go back to the model; a plan that still has
  them can't be accepted.
- **Propose** is the same checked proposal the chat has always made
  (`proposals.propose`), given the goal, the plan, the notes and the
  templates as extra context, and asked for the active milestone's steps.
- **Validate** first checks each step ran and has rows (no model needed),
  then asks the model whether the output (columns, size, sample rows) meets
  the milestone's check.
- The copilot **never applies or runs anything**. The user applies a
  proposal (the same commands the console sends) and runs the steps.

### One turn, end to end

![One turn: the copilot pane posts the steps; the server loads the session, builds the context, asks the model, checks the answer (up to 2 retries), replies and saves; you apply the proposal, the kernel runs the steps, and you press Continue](img/copilot-turn.svg)

The pane sends `POST /api/agent/sessions/{workflow id}/turn` with the action
(`continue`, `accept` or `replan`), your message, and the workflow's steps
with their states. The check is `check_plan` while planning and
`check_proposal` while building. Everything below the dashed line happens
on your side.

### What it reads every turn

| Layer | From | Budget |
|---|---|---|
| session | the goal, the plan, each milestone's status | — |
| tools | each tool's signature and first docstring line; resource types and their tools | — |
| resources | the workflow's resources and the app's ready-made ones | — |
| notes | what the user typed in **Context** | 2000 chars |
| templates | earlier workflows the user ticked, as `name = formula` lines | 3000 chars |
| workflow | each step's formula, status, error, columns, rows and 3 sample rows | 3 rows, 40 chars a cell |

It sees nothing the user can't: never a key, a setting, or a resource's
live object.

### The trace

Each turn appends one record to the session's `trace`: phase, action
(`ask`, `plan`, `accept`, `propose`, `wait`, `validate`, `validate+fix`,
`answer`, …), model, model calls, seconds, the active milestone, the size of
each context layer, the outcome, and any problems the checks left. The chat
pane's **Trace** tab shows it; it's plain JSON for your own tooling too.

## Drive it from Python

The loop is a plain function; the HTTP routes and the chat pane are thin
clients of it:

```python
from SIMPLE_STEPS.agent import copilot, sessions
from SIMPLE_STEPS.agent.model import Agent

agent = Agent(generate=my_model)
session = sessions.new_session("my-workflow", "Revenue per city")
copilot.turn(agent, session, message="Total revenue for each city.", steps=steps)
copilot.turn(agent, session, message="Yes, highest first.", steps=steps)   # answers its question
copilot.turn(agent, session, action="accept", steps=steps)
copilot.turn(agent, session, steps=steps)       # Continue: proposes milestone 1's steps
# … apply session["messages"][-1]["proposal"]["changes"], run the steps, Continue again
sessions.save(session)
```

`steps` is the workflow as the UI sends it: `[{name, formula, status, error,
output_ref}]`.

### Try it: `copilot.py`

[`examples/agent_demo/copilot.py`](../../../src/SIMPLE_STEPS/examples/agent_demo/copilot.py)
plays one whole session, from goal to a validated workflow, applying and
running each proposal the way the UI does, then prints the trace:

```bash
python src/SIMPLE_STEPS/examples/agent_demo/copilot.py           # a scripted model: no LLM needed
python src/SIMPLE_STEPS/examples/agent_demo/copilot.py --live    # your configured model
python src/SIMPLE_STEPS/examples/agent_demo/copilot.py --save    # then open copilot-built in the UI
```

The scripted model is a plain `generate` function. Read it to see exactly
what a good answer to each kind of turn looks like.

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
agent reads your tools' names, signatures and docstrings; a session per
workflow, with plan, build and validate turns; `Agent(generate=…)` for any
model.

**Expect to change:** the default model; the context budgets (plan 128 A1);
develop mode, where the copilot applies and runs within a budget (plan 128
A4).
