# 128 — An agent that builds workflows

> Status: **proposed**, 2026-10-30, app at `bb181ab`. Owner's goal: an agent,
> ideally on a **local model**, that helps construct workflows. Its graph is
> very simple; it can only **propose, load and invoke the tools and
> resources available** to a workflow, nothing else; its **context** (the
> workflow's goal, the tools' domain, the syntax, template workflows, the
> session's data) is managed deliberately; it works within a **budget** of
> steps and tries; and when the user lets it **develop** the workflow, the
> user sees what it is doing. Builds on 122 §3 (the agent proposes, the user
> disposes) and 125's decision 6 (agent permissions live in the `App`).

## Today (read and checked 2026-10-30)

| | Found |
|---|---|
| The working path | `agent/proposals.py` behind `POST /api/agent/propose`, the only one the chat pane calls (`ChatSidebar` → `agentApi.proposeChanges`). One turn: build the scope, ask the model for `{"summary", "steps": [{"name", "formula"}], "remove": […]}` (Ollama's structured output, a JSON schema), **check every formula** (it compiles, reads only earlier steps, uses only real tools and usable resources), send problems back up to `Agent.retries` (2) times, return the changes |
| The model | a local Ollama model (`llama3.2:3b` by default), called over HTTP with the standard library; `App(agent=Agent(model=…))`, `agent_config.json`, or `OLLAMA_MODEL` choose it |
| The scope (`agent/scope.py`) | plain text: tools (signature and first docstring line), resource types and their tools, the workflow's resources, each step's name, formula, status, error and a few sample rows. **No size budget** |
| What it may do | propose only: it never applies a change or runs a step |
| A second, unused path | `agent/graph.py` (LangGraph: `gather_context → reason → respond`), `agent/prompts.py`, `POST /api/agent/chat` and `WS /api/agent/chat/stream`, `agentApi.sendAgentMessage` and its WebSocket. **Nothing in the UI calls them**; their prompt teaches the retired syntax (`=filter_rows(column=…)`); LangGraph is an optional extra (`simple-steps[agent]`). ADR 006 describes this path |
| The harness | `examples/agent_demo/ask.py`: a set of requests, then checks what the agent built against a reference workflow ("5/5 tasks done right") |

## The rule: a closed action space

The agent acts only through the workflow's own commands, the same ones the
GUI and the console use (`types/commands.ts`), and only with what the
workflow has:

| It may | As |
|---|---|
| propose a step: add, change, remove, rename, move | `set` / `add` / `remove` / `rename` / `move` commands with formulas in core's syntax, using only the catalog's tools and the workflow's resources |
| load a resource | `define_resource` with a **ready-made** resource the app provides (`Use`), never a new type |
| invoke | stage a step (Enter), or run one (`run`), **only in develop mode** and only within its budget and its permissions |

It may not: write code, evaluate anything, read files except through a
resource's tools, create resource types, touch another workflow, or act
outside its budget. Every action is checked before it happens: formulas by
`k.check` (one checker for the UI, the console and the agent), resources
against the app's ready-made list, runs against the permissions.

## The graph: five states, one loop

```
            ┌──────────────────────────────────────────────┐
  goal ──▶ CONTEXT ──▶ PROPOSE ──▶ CHECK ──fail──▶ (retry while budget) ──┘
                                     │ pass
                     propose mode ◀──┴──▶ develop mode
                          │                    │
                      PRESENT              ACT (apply, stage, run)
                     (user applies)            │
                                            OBSERVE (states, rows, errors)
                                               │
                              done / budget spent / user stops ──▶ REPORT
                                               │ otherwise
                                               └──▶ CONTEXT (next step)
```

- **Context**: assemble the prompt from the layers below, within the token
  budget.
- **Propose**: one model call, structured output (the schema it has today).
- **Check**: `k.check` on every formula, the resource and permission rules;
  problems go back to Propose (one retry each, counted against the budget).
- **Present** (propose mode): the user sees the changes, as today.
- **Act / Observe** (develop mode): apply as commands, stage, run what it may;
  read back core's view of each step it touched (state, rows, types, errors)
  and decide whether the goal is met.
- **Report**: what it did, what it spent, what's left.

A plain Python loop with these five functions, no framework: a small local
model needs few, short calls, and the loop is easier to read, test and budget
than a graph library (D1).

## Context: six layers, each with a budget

A small local model has a few thousand tokens of room. The context is built
in layers, in priority order; each has a share of the budget and a rule for
trimming. The UI shows what went in (the "context meter", below).

| # | Layer | What | Source | Trimmed by |
|---|---|---|---|---|
| 1 | **Goal** | what the workflow is for, and when it's done ("monthly revenue per city, highest first") | a new **workflow goal** the user writes, saved with the workflow (D2) | never: it's short |
| 2 | **Syntax** | a compact card of core's formula syntax and the verbs, with 6–8 example formulas | generated from core (`cat.describe()`), each example checked by the parser, so it can't teach a retired form | fixed size |
| 3 | **Tools and resources** (domain) | each tool's signature, first docstring line, and what it reads (column names); the resources it can use; per-category notes the app author writes | the catalog; `App(agent=Agent(notes=…))` for domain knowledge | ranked by relevance to the goal and the current step (name and docstring overlap); the rest as names only |
| 4 | **Templates** | one or two worked workflows close to the goal, as few-shot examples | the app's example and template workflows, chosen by the tools they share with the goal | at most two, whole |
| 5 | **Session data** | each step: name, formula, core's state, row count, column names and types, problems, 2–3 sample rows (rich cells as their summaries) | core's view and plan (`/api/view`, the same as the grid) | the steps near the one being built in full; the others as name and columns |
| 6 | **History** | the last few turns, and a summary of what the agent already did this task | the activity log | the oldest first |

## Budget

Each task (one request in develop mode) has a budget, set by the app and
adjustable in the chat pane:

| Limit | Default (D3) | When spent |
|---|---|---|
| steps it may add or change | 5 | stops and reports |
| model calls | 12 | stops and reports |
| check retries per step | 2 | the step is reported with its problem |
| runs | 5 | stops before the next run |
| rows a run may touch | the app's choice | asks before a bigger run |
| wall time | 2 minutes | stops and reports |

The chat pane shows the budget as it is spent. Propose mode uses the model
calls and retries only.

## Modes, and what the user sees

| Mode | It | The user |
|---|---|---|
| **Off** | nothing | — |
| **Propose** (today) | proposes changes | reviews and applies each one |
| **Develop** (new, opt-in per workflow) | applies, stages and runs, within its budget and permissions | sees every action live, can pause or stop, and can undo the agent's whole turn |

In develop mode:

- **Every action is a command in the activity feed** (the chat pane), and in
  the console's transcript tagged `agent`, exactly as the console would write
  it (`wf["totals"] = '…'`, `wf.run("totals")`): one vocabulary for the GUI,
  the console and the agent.
- **Steps the agent changed carry a mark** in their header until the user
  accepts them.
- **Pause and Stop** are always visible while it works; the budget meter beside
  them.
- **Undo the turn**: before a turn the workflow's formulas are checkpointed;
  undo restores them in one action.
- **Permissions** (in the `App`, 125 decision 6): which tools it may run (an
  export, say, may need the user's yes: 127), and whether develop mode is
  offered at all.

## Local models

- One provider today (Ollama); its structured output keeps a small model's
  answers well-formed. Keep it, and keep the model choice in the `App` and the
  settings panel.
- **Measure it**: grow `ask.py` into a task suite per example app; report
  tasks solved, model calls, retries and tokens per task, so models (3B, 7B,
  …) and context choices can be compared on the same tasks.

## Cleanup first

The unused LangGraph path goes, once the owner confirms (inventory above):
`agent/graph.py`, `agent/prompts.py`, `/api/agent/chat`, `/api/agent/chat/stream`,
`agentApi.sendAgentMessage` and its WebSocket, the `agent*` optional extras,
and ADR 006 marked superseded by this plan. The checked-proposal path is the
one agent.

## Decisions to make

| | Question | Recommended |
|---|---|---|
| D1 | The loop: a plain Python state machine, or LangGraph | Plain Python: five functions, no dependency, easy to budget and test |
| D2 | Where the workflow's goal lives | Saved with the workflow (`meta.goal`), editable in the chat pane and the workflow's overview; empty means ask |
| D3 | Budget defaults | as in the table; per app (`Agent(budget=…)`), adjustable per request |
| D4 | What develop mode may run without asking | any step it added, within the row limit; tools the app marks as side-effecting (exports) only with the user's yes |
| D5 | Domain notes | a short `notes=` per tool category in `Agent(…)`, written by the app author |
| D6 | Templates | the app's own example workflows, plus any workflow the user marks as a template |

## Order of work

| # | Work |
|---|---|
| A0 | Remove the unused LangGraph path (owner's go-ahead first) |
| A1 | Context layers with budgets; the syntax card generated from core; relevance ranking for tools; the context meter |
| A2 | The workflow goal (D2) in the file and the chat pane |
| A3 | The loop (D1) behind `/api/agent/propose`; the budget, propose mode only |
| A4 | Develop mode: commands applied, stage, run, observe; the activity feed; marks on agent-changed steps; pause, stop, undo; permissions |
| A5 | Templates (D6) as few-shot context |
| A6 | The task-suite harness: per-model results, compared |

## Tests to add

| ID | Checks |
|---|---|
| TEST-AGENT-001 | an action outside the closed space (a new resource type, a tool not in the catalog, a read of a later step) is refused before it happens |
| TEST-AGENT-002 | each context layer stays within its share of the token budget; trimming keeps the goal and the syntax card whole |
| TEST-AGENT-003 | every example formula in the syntax card parses and checks |
| TEST-AGENT-004 | a task stops when any budget limit is spent, and the report says which |
| TEST-AGENT-005 | in develop mode every action appears in the activity feed and the console transcript as a command; undo restores the formulas from before the turn |
| TEST-AGENT-006 | a side-effecting tool is not run without the user's yes |
