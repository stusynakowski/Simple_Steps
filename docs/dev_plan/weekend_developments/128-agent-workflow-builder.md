# 128 — An agent that builds workflows

> Status: **in progress** (A0, M1, M2 done 2026-11-09); proposed 2026-10-30, app at `bb181ab`; the six contracts and
> the prerequisites (P1–P4) added 2026-11-09. Owner's goal: an agent,
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

## Built to last: the agent touches six contracts, nothing else

Added 2026-11-09 (owner: a design that weathers any later change). The old
LangGraph path broke silently when the syntax changed: its prompt was
hand-written and still teaches `=filter_rows(column=…)`. So the agent never
reaches into core, the kernel, the parser or the UI's state. It uses six
interfaces, each owned by one module and each used the same way by the UI
and the console. A change anywhere else reaches the agent through one of
them, or not at all.

| # | Contract | What it is | Owned by | Why it lasts |
|---|---|---|---|---|
| 1 | **Commands**: what it can do | the workflow command protocol (`set`, `add`, `remove`, `rename`, `move`, `run`, `define_resource`, …), the one already in `types/commands.ts`, **moved to the backend** so any client can apply it to a session's workflow. The agent's output is a list of commands, never code or prose formulas | `commands.py` (new), the UI and console as clients | a new UI feature is a new command; the agent sees it in the schema |
| 2 | **Check**: what's allowed | `check(commands) → problems`: the commands applied to a copy of the session's kernel, core's `k.check` on each step, plus the App's permissions. The same call the formula bar makes on Enter (L1 D2) | the L1 adapter | one checker: a rule that changes in core changes for the UI and the agent at once |
| 3 | **Knowledge**: what it's told | generated at startup, never hand-written: tool cards from `catalog().describe()`; a syntax card of example formulas **built by core's constructors and printed by core** (`Operation.to_source()`), each one read back with `formula()` in a test; the App author's notes | `agent/context.py` | the card is regenerated when core's syntax changes, and its test fails if it ever teaches a form core refuses |
| 4 | **Observation**: what it sees | the UI's own reads: the sync summary (state, why stale, problems, the formula core runs) and `/api/view` pages, trimmed by the context budget | `kernels.py`, as for the grid | no agent-only access to drift |
| 5 | **Model**: who thinks | `Model.complete(messages, schema) → dict`, one small protocol; Ollama is one adapter, a hosted model another. The loop imports no provider SDK and no agent framework | `agent/model.py` | a new model or provider is a new adapter |
| 6 | **Transcript**: what happened | every turn as data: context sizes, the model's output, the commands, the check results, what ran, the budget spent. The activity feed renders it; undo replays it backwards; the task suite scores it | `agent/loop.py` | debugging, undo and evaluation read one record |

**The guard on all six:** the task suite (`agent_demo/ask.py`, A6) runs on
every core pin move with a fixed model. If a change in core or the app makes
the agent worse, the suite says so before a user does.

## Copilot functionality (owner, 2026-11-09)

Owner's ask: familiar copilot functionality, for creating and modifying
workflows, documented and drawn clearly. The illustrated version of this plan
is the artifact *Simple Steps Copilot* (https://claude.ai/artifact/WNw6KzyQ5u6RM1F2YvNZBW).

**Modes, named as code copilots name them** (proposed; they rename this
plan's Off / Propose / Develop):

| Mode | It | You |
|---|---|---|
| **Ask** | answers questions about the workflow, its steps and data; changes nothing | read |
| **Edit** (was Propose) | proposes changes as a review list, each step's formula before → after | Keep or Undo each, or all |
| **Agent** (was Develop) | applies, runs, observes and repeats toward the goal, within its budget | watch the feed; Pause, Stop, Undo turn |

| In a code copilot | In Simple Steps | When |
|---|---|---|
| Chat panel | the chat pane | today |
| Review a diff | the review list, Keep / Undo per step and for all | A3 |
| #-mentions | `@step` attaches a step; the grid selection and a failing step attach themselves | A1 |
| Slash commands | `/new`, `/fix`, `/explain`, `/add` | A3 |
| Quick fix | Fix on an invalid or failed step's popover (the popover rule: no new grid buttons) | A3 |
| Agent tool calls | each action as a chat line written as the console writes it | A4 |
| Checkpoints | before each agent turn; Undo turn | A4 |
| Inline completion | ghost text in the formula bar, Tab accepts | later |

### Decided (owner, 2026-11-09)

| # | Question | Decided |
|---|---|---|
| C1 | Mode names | **Ask / Edit / Agent**, replacing Off / Propose / Develop |
| C2 | The model's APIs | **OpenAI-compatible, Anthropic, a Python function** |
| C3 | Keys | **The user can define keys** (the settings panel or the App). **The agent never sees them**, and as a rule **the agent sees nothing the user can't**: its context is built only from what the UI shows (contract 4), never from settings, keys, secret resource settings or server internals. A key is never sent back to the browser either: the panel shows only whether one is set |
| C4 | A0 | **go**: the LangGraph path removed as inventoried; the old settings replaced by the one setting |

## Owner's first test (2026-11-10, Qwen 30B)

The owner configured a Qwen 30B model through the settings panel (the
OpenAI-compatible path, M1–M2) and asked the copilot to build and change
workflows. **It works, but poorly.** What was seen, why (read in the code on
2026-11-10), and what fixes it:

| # | Seen | Why, in the code today | Fix, and where |
|---|---|---|---|
| T1 | **No chat sessions** | The conversation lives only in the chat pane's state (`ChatSidebar.tsx`): closing the pane or reloading loses it; there's no New chat and no list of earlier chats; the model sees only the last 6 turns | **New step A2b:** chat sessions saved with the workflow (beside its goal), New chat, earlier chats listed; each session is the transcript (contract 6), so it survives a reload |
| T2 | **Can't make corrections** | A proposal shows each formula as read-only text with a checkbox (`ProposalCard`): apply or skip, nothing else. No way to edit a proposed formula, to say what's wrong, or to undo after applying | **A3, the review list:** edit a proposed formula in place (checked as you'd check the formula bar); *Revise* sends your comment back as feedback for another try; Undo after Keep |
| T3 | **Unclear what changed, or what the model used** | The card shows the model's summary and the new formulas; nothing shows what the model was told, or why it chose each change | **A1:** "What the model saw", the context layers with their sizes, expandable in the chat. **A3:** each change carries a one-line *why* (the schema asks for it) and its formula before → after, the difference highlighted |
| T4 | **Some changes can't be made** | Its action space is add, change and remove step formulas, and ready-made resources: no rename, move or run. Its syntax is a hand-written prompt that doesn't cover every form core reads | **P4:** rename, move and run as commands. **A1:** the syntax card generated from core. The owner to list the requests that failed, so each becomes a task in the suite (A6) |

The order of work gains A2b; A1 and A3 take the T2–T4 items above.

## The model: any text LLM, one setting (contract 5)

Owner's goal (2026-11-09): **configure one LLM, and any model that generates
text works out of the box, without issues.**

**Today** (read 2026-11-09): only Ollama works. `agent/model.py` calls
Ollama's own `/api/chat` with its structured-output `format`, which most
servers don't have, and `resolve()` turns the agent off for any other
provider. A second settings model, `agent/config.py`'s `AgentConfig` (from
the LangGraph path), lists OpenAI, Anthropic and Azure, but nothing uses its
provider except to refuse it.

**Design.** The loop asks a model for text and nothing else, so anything that
generates text can be the model:

| Part | What | Why it makes any model work |
|---|---|---|
| **One setting** | `Agent(model=…, base_url=…, api_key_env=…)`, given by the App, or the settings panel (`agent_config.json`), or env vars, in that order. One class; `AgentConfig` goes | one place to configure, one thing to test |
| **Three transports**, standard library only, no SDKs | **OpenAI-compatible** `/v1/chat/completions`: OpenAI, Ollama, LM Studio, vLLM, llama.cpp's server, Groq, Together, OpenRouter, Mistral, DeepSeek, Gemini's OpenAI endpoint. **Anthropic** `/v1/messages`. **A Python callable** `generate(messages) -> str`, for anything else (a transformers model, a company gateway) | two wire formats cover nearly every hosted and local server; the callable covers the rest |
| **Text in, JSON found** | the prompt asks for one JSON object; the answer is read leniently (inside code fences, after prose) and checked against the schema by the app. A provider's JSON mode is used where it's known to work, never relied on | a model without structured output still works |
| **One repair turn** | an answer that isn't the JSON asked for goes back once with the reason ("missing `steps`"), counted against the budget | small or chatty models recover instead of failing |
| **Test connection** | the settings panel, and `simple-steps agent test`, send one tiny request and say exactly what's wrong: unreachable at the URL, the key refused, no such model, an answer that isn't JSON | "without issues" means a problem is named before a task is tried |
| **Secrets** | a key is read from an environment variable named in the setting (`api_key_env="OPENAI_API_KEY"`); typed into the panel, it's kept in memory, never written to a workflow or the repo | a saved file never carries a key |

**Tested without a network:** each transport against a local stub server
speaking its wire format; the lenient reader and the repair turn on a set of
real-world answer shapes (prose before JSON, fenced, trailing commas,
truncated); the task suite with a scripted fake model. Real models are the
task suite's per-model table (A6).

### A0: what goes (inventory, for the owner's go-ahead per piece)

| Piece | What it does | Used by |
|---|---|---|
| `agent/graph.py` (329 lines) | the LangGraph loop: gather context, reason, respond | `/api/agent/chat`, `/chat/stream` only |
| `agent/prompts.py` (141) | its prompt, which teaches the retired syntax (`=filter_rows(column=…)`) | `graph.py`; `tests/test_agent_prompts.py` |
| `POST /api/agent/chat`, `WS /api/agent/chat/stream` | the graph over REST and a WebSocket | `agentApi.sendAgentMessage`, `createAgentWebSocket`: **nothing in the UI calls them** |
| `GET /api/agent/health` | checks that the `langchain_*` packages are installed | `agentApi.getAgentHealth` |
| `agent/config.py`'s `AgentConfig` and `GET/PATCH /api/agent/config` | LangGraph-era settings (provider, `max_iterations`, `system_prompt_override`, …) | `AgentConfigPanel.tsx`; `model.py` reads only its file path. **Replaced, not just removed**: the panel moves to the one setting above |
| `pyproject` extras `agent`, `agent-anthropic`, `agent-ollama` | install LangGraph and LangChain providers | nothing once the above go |
| ADR 006 (agent chatbot) | describes the LangGraph path | marked superseded by this plan |

Stays: `agent/proposals.py` (the checked proposal), `model.py` (rewritten
as above), `scope.py`, `POST /api/agent/propose` and `GET /api/agent/status`,
the chat pane.

## Before the agent

Each item is small and checked by the existing gates:

| # | What | Why first |
|---|---|---|
| P1 | **Done 2026-11-09**: core 1.0.2 (C40–C44 closed), pinned; release 0.1.1 | the agent's checker and syntax card come from core |
| P2 | **L1**: core reads formulas, one checker, check on Enter | contracts 2 and 3. An agent built on today's parser is rewritten when L1 lands |
| P3 | **A0**: the unused LangGraph path removed (owner's go-ahead per piece) | one agent, not two |
| P4 | **Commands on the backend** (contract 1) | propose mode can wait for it, since the UI applies proposals today; develop mode (A4) can't |

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
| A0 | **Done 2026-11-09.** The unused LangGraph path removed (inventory above) |
| M1 | **Done 2026-11-09.** The model (contract 5): one `Agent` setting; the OpenAI-compatible, Anthropic and callable transports; the lenient JSON reader and the repair turn; JSON mode asked for and dropped when refused; keys never shown (spec 016, `tests/test_agent_model.py`, stub servers) |
| M2 | **Done 2026-11-09.** The settings panel on the one setting (API, model, base URL, key, temperature; Material Symbols); Test connection there, `POST /api/agent/test` and `simple-steps agent test`; the setting saved in `~/.simple_steps/agent.json` (mode 600), a key write-only and never returned; an App-given setting shown read-only. The LangGraph-era `AgentConfig` is gone (spec 016 REQ-AGENT-008, 009) |
| A1 | Context layers with budgets; the syntax card generated from core; relevance ranking for tools; the context meter |
| A2 | The workflow goal (D2) in the file and the chat pane |
| A2b | **Chat sessions** (T1): saved with the workflow, New chat, earlier chats listed; a session is the transcript (contract 6) |
| A3 | The loop (D1) behind `/api/agent/propose`; the budget, propose mode only |
| A4 | Develop mode, on P4's backend commands: commands applied, stage, run, observe; the activity feed; marks on agent-changed steps; pause, stop, undo; permissions |
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
