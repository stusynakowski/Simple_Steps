# 05 — The agent (the copilot)

The copilot is a chat pane that **plans and writes steps with you**. You
describe what you want; it asks what it needs to, proposes a plan, then
builds it one milestone at a time, checking each one's output. You review
each proposal and apply it. It never runs a step and never changes the
workflow on its own.

## Is it on?

The chat pane is on the right (if it's hidden, use the tab on the right
edge, **Show chat**). Its header shows a dot: lit when the agent is ready,
dim when it's off — hover the dot to see why. The bar under the header shows
what the agent can see: how many steps and resources the workflow has, and
which model it's using.

If it's off, no model is set, or the one set isn't answering. Open
**Agent settings** in the chat header and choose one: the API (any
OpenAI-compatible server, such as OpenAI, Ollama or LM Studio, or
Anthropic), the model, its address, and a key if it needs one. **Test
connection** says whether it works, and what's wrong if not. The setting is
saved for you, outside every workspace; a key is never shown again once
saved.

If the app sets the model itself, the settings show it read-only; whoever
set the app up can change it — see
[Set up the agent](../developer/02-the-agent.md) in the Developer guide.

## Use it: one session per workflow

Each workflow has its own **copilot session**, saved with the workspace, so
you can close the pane or reload and pick up where you were. The bar under
the header names the session, its phase (**planning**, **building**,
**done**) and how many milestones are done; click it for the list of every
session, and **Start over** on this one. The tabs are **Chat**, **Plan**,
**Trace** and **Context**.

### 1. Plan

Say what the workflow should do: *"Total revenue for each city from the
orders."* That becomes the session's **goal**. The copilot either asks a few
questions first (*"Should the cities be sorted, highest first?"*) — answer
them in the chat — or proposes a **plan**:

- the **resources** it needs (only ones your workflow can use);
- the **steps**, each with its tool and what it's for;
- a **dev plan**: small **milestones** in order, each building a step or
  two, each with a check on its output (*"one row per city with its
  revenue"*).

Open **Plan** to read it. Ask for changes in the chat, or press **Replan**.
When it's right, press **Accept plan**.

### 2. Build, one milestone at a time

Press **Continue**. Each press is one turn, and does one thing:

| The milestone's steps are | The copilot |
|---|---|
| missing or failing | proposes them: tick what you want, **Apply**, then run the steps |
| there, not run yet | tells you which to run |
| run | **checks the output** against the milestone. Passed: on to the next. Not yet: says why and proposes a fix |

Type into the chat at any point to steer it (*"use a threshold of 50"*):
it proposes a change for the current milestone. When every milestone has
passed, the session is **done**; you can still ask for changes, or Replan to
extend the goal.

### Give it context

**Context** holds **notes** the copilot reads every turn (what columns
mean, your conventions, domain rules) and **templates**: tick earlier
workflows in this workspace and it reads their steps as worked examples. It
also shows how much of each kind of context the last turn read.

### See where it stands: the trace

**Trace** lists every turn: the phase, what it did (asked, planned,
proposed, waited, checked), the milestone, how many model calls, and the
outcome. Click a row for the time, the model, how much context it read, and
any problems its checks found.

You can also ask questions, such as *"which tool keeps the large orders?"*,
and get an answer with no changes. The header's gear opens the **copilot
settings**.

## What it checks before you see a proposal

Every proposed formula must compile, read only earlier steps (`wf[…]`), use
only resources the workflow has (`res[…]`), and use only real tools. A
proposal that fails goes back to the model with the problem, a couple of
times; anything still wrong is shown with its problem rather than hidden.

The checks guarantee a proposal is **well-formed**, not that it does what you
meant. Run it, and look at the output. Every formula it writes is an ordinary
step formula — see [04 — Expressions](04-expressions.md) to read one.

## Stable, and not yet

**Expect to stay:** the agent proposes and you apply; proposals are checked
before you see them; one session per workflow, planned, then built and
checked a milestone at a time.

**Expect to change:** the chat pane's look (plain for now); the default
model.
