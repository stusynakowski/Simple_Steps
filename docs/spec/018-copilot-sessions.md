# Specification: Copilot sessions — plan, ask, build, validate

Owner, 2026-11-10: a light but sufficient agent framework, close to a code
copilot, that works with any LLM. It plans the problem with the user (asking
clarifying questions when it must), proposes the resources and steps and a
small dev plan, then builds the pipeline **one turn at a time**, validating
each increment. One session per workflow, saved; the user adds context and
earlier workflows as templates; a trace shows where the work stands.

Plan 128 (A1 in part, A2, A2b, A3 in propose mode, A5). Code:
`src/SIMPLE_STEPS/agent/copilot.py` (the turns), `agent/sessions.py` (the
saved session), `agent/routes.py`; the UI is the chat pane only
(`ChatSidebar.tsx`, `CopilotViews.tsx`). Model transport: spec 016.

## The session

- **REQ-COPILOT-001:** a session belongs to one workflow and is named by the
  workflow's id. It is saved as JSON in the workspace,
  `<workspace>/.simple_steps/agent_sessions/<id>.json` (or
  `$SIMPLE_STEPS_AGENT_SESSIONS`), and survives a reload. It holds the goal,
  the context (notes, templates), the phase, open questions, the plan, the
  messages (proposals included) and the trace.
- **REQ-COPILOT-002:** reading a workflow's session that doesn't exist gives a
  new, empty one in the `plan` phase, not saved until its first turn.
  Starting over deletes the session; the workflow is untouched.
- **REQ-COPILOT-003:** the first thing the user says becomes the goal unless
  one is set; the goal, title, notes and templates can be edited at any time.

## Phases and turns

A turn is one request: `continue` (with or without the user's words),
`accept` or `replan`. Each turn does **one** thing and stops.

- **REQ-COPILOT-010 (plan):** in the `plan` phase the copilot either asks at
  most three clarifying questions (and no plan), or proposes a plan:
  `resources` (only ones the workflow can use), `steps` (name, tool,
  purpose; existing steps may be kept) and `milestones` (title, the steps it
  builds, a check on the output).
- **REQ-COPILOT-011:** a plan is checked before the user sees it: unique,
  usable step names; every tool in the catalog, built in, or a resource's
  tool; every resource usable; every milestone names planned steps. Problems
  go back to the model, up to `Agent.retries` times; any left are shown with
  the plan, and a plan with problems can't be accepted.
- **REQ-COPILOT-012:** a step no milestone builds gets a milestone of its own;
  a plan without milestones gets one per step; milestones are ordered by
  where their steps fall in the plan.
- **REQ-COPILOT-013 (accept):** accepting a usable plan moves the session to
  `build` and makes the first milestone that isn't done active. It needs no
  model.
- **REQ-COPILOT-014 (build):** a `continue` in `build` works on the active
  milestone and does exactly one of:
  - its steps are missing or failed, or the user gave feedback →
    **propose** them, a checked proposal (spec 016 / `proposals.py`) with the
    goal, plan, notes and templates as extra context;
  - its steps exist but haven't run → **wait**, naming the steps to run, with
    no model call;
  - its steps ran → **validate**.
- **REQ-COPILOT-015 (validate):** a step that ran with no rows fails without
  asking the model; otherwise the model judges the steps' output (columns,
  size, sample rows) against the milestone's check and answers
  `{"done", "reason"}`. Passed: the milestone is `done` and the next is
  active, or the session is `done`. Failed: the reason is shown and a fix is
  proposed in the same turn.
- **REQ-COPILOT-016:** when the copilot proposes a milestone's steps under
  other names than the plan's, the milestone follows the proposed names.
- **REQ-COPILOT-017 (replan):** `replan` returns to `plan` with the
  conversation so far; milestones already done are planned again from the
  workflow as it is.
- **REQ-COPILOT-018:** the copilot never applies or runs anything: the user
  applies a proposal (the same commands as the console) and runs the steps.

## Context

- **REQ-COPILOT-020:** every turn reads, as plain text, the layers: the
  session (goal, plan, milestone status), the tools, the resources, the
  user's notes (at most 2000 characters), the templates (at most 3000) and
  the workflow (each step's formula, status, error and a sample of its
  output). It sees nothing the user can't (decision C3): no keys, no
  settings.
- **REQ-COPILOT-021:** a template is any workflow in the workspace; its steps
  are given as worked examples. `GET /api/agent/templates` lists them.
- **REQ-COPILOT-022:** the model sees the last eight messages, including the
  questions it asked, so it reads the user's answers in context.

## Trace

- **REQ-COPILOT-030:** each turn appends one record: turn number, time,
  phase, action (`ask`, `plan`, `accept`, `propose`, `wait`, `validate`,
  `validate+fix`, `answer`, `idle`, `off`, `error`), the model, model calls,
  seconds, the active milestone, the size of each context layer, an outcome,
  and the problems the checks left.
- **REQ-COPILOT-031:** the sessions list shows each session's title, goal,
  phase, milestones done of total, turns and when it was last updated.

## Any model

- **REQ-COPILOT-040:** the loop asks for text and finds the JSON in it (spec
  016 REQ-AGENT-004), so any model works, including a Python function
  `Agent(generate=fn)`. A model that fails or is off ends the turn with a
  message naming why; the session is saved.

## Routes

| Route | Does |
|---|---|
| `GET /api/agent/sessions` | every session's summary (REQ-COPILOT-031) |
| `GET /api/agent/sessions/{id}?title=` | the session, or a new one (REQ-COPILOT-002) |
| `PUT /api/agent/sessions/{id}` | edit `title`, `goal`, `notes`, `templates`; `applied` marks a proposal applied |
| `DELETE /api/agent/sessions/{id}` | start over |
| `POST /api/agent/sessions/{id}/turn` | `{action, message, title, steps, resources}` → the saved session |
| `GET /api/agent/templates` | workflows that can be templates |

## The chat pane (UI)

Only the chat pane changes; no other component does (owner, 2026-11-10;
the look comes later).

- **REQ-COPILOT-050:** the pane shows the open workflow's session: a bar
  with its title, phase and progress, which opens the sessions list (Start
  over on the current one); tabs **Chat**, **Plan**, **Trace**, **Context**.
- **REQ-COPILOT-051:** Chat shows the messages; questions as a list; a plan
  as its size with a link to Plan; a proposal as the review card (tick,
  Apply); a validation as passed or failed. **Accept plan** shows when the
  plan is usable, **Continue** while building.
- **REQ-COPILOT-052:** Plan shows the editable goal, open questions,
  resources, steps, the milestones with their status and last check, the
  plan's problems, and Accept / Replan. Trace is one row per turn, opening
  to the context sizes and problems. Context holds the notes, the templates
  to tick, and what the last turn read.

## Checks

| Check | Covers |
|---|---|
| `examples/agent_demo/copilot.py` (scripted model; check 4 of the example's `runme.py`) | 001, 003, 010–016, 018, 020, 022, 030, 040: a whole session from goal to a validated, correct workflow, a repaired proposal included |
| `frontend/src/components/ChatSidebar.test.tsx` | 051: a request sends a turn; the proposal is shown; Apply reaches the workflow |
| `tests/test_agent_model.py` | 040 (through spec 016) |

Not yet covered by a test: REQ-COPILOT-002, 011's individual refusals, 017,
021, 031, 050, 052 (checked by hand on 2026-11-10 through the routes).
