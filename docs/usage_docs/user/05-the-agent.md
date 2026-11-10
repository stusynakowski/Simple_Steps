# 05 — The agent

The agent is a chat pane that **writes steps for you**. You describe what you
want; it proposes steps; you review the proposal and apply it. It never runs
a step and never changes the workflow on its own.

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

## Use it

1. Open a workflow and **Run All**, so the agent can see what each step holds.
2. Ask for one thing at a time, and name the step you want:
   *"Add a step called totals with each order's total: price times quantity."*
3. Read the proposal: each change is an **add**, **change** or **remove**,
   with its formula and any problem the checks found. Untick a change you
   don't want.
4. **Apply** it, then run the new steps. Not right? Say what's wrong —
   *"use a threshold of 50"* — and it proposes a change.

You can also ask questions — *"which tool keeps the large orders?"* — and
get an answer with no changes. The header's buttons open **Agent
settings** and **Clear chat**.

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
before you see them.

**Expect to change:** the chat pane's layout; the default model.
