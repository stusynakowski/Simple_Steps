# Agent — build a workflow by asking

The agent reads your tools and your workflow, and **proposes** steps; you
review each proposal and apply it. It never runs anything and never edits the
workflow itself. The model is a local [Ollama](https://ollama.com) model.

```bash
ollama pull llama3.2:3b                         # once (about 2 GB)
simple-steps run examples/agent_demo/app.py     # the UI, with the agent on
python examples/agent_demo/ask.py               # the agent, tested from the terminal
python examples/agent_demo/runme.py             # everything but the model: no Ollama needed
```

Use another model with `OLLAMA_MODEL=qwen2.5:7b`, another host with
`OLLAMA_HOST=http://…`. Without Ollama the app still runs; the chat pane says
the agent is off, and why.

## In the UI

1. Open the **`start`** workflow: one step, `orders`. Press **Run All**, so
   the agent can see what `orders` holds.
2. Open the chat pane: the tab on the right edge (**Show chat**). Its header
   shows the model, or why the agent is off.
3. Ask for something, one request at a time:

   | ask | a good answer adds |
   |---|---|
   | Add a step called totals with each order's total: price times quantity. | `line_total[mod.map(), mod.name("total")](wf["orders"])` |
   | Add a step called with_totals: each order beside its total. | `zip_(wf["orders"], wf["totals"])` |
   | Add a step called large that keeps only the orders whose total is over 100. | `is_large_order[mod.filter()](wf["with_totals"], threshold=100)` |
   | Add a step called ranked: the large orders sorted by total, highest first. | `identity[mod.sort(by="total", ascending=False)](wf["large"])` |
   | Add a step called per_city with the total revenue for each city. | `sum_totals[mod.collapse(by="city", initial=0)](wf["with_totals"])` |
   | Add a step called months with the month each order was placed. | `month_of[mod.map(), mod.name("month")](wf["orders"])` |

4. The proposal lists each change — add, change or remove a step — and any
   problem the checks found. **Apply** it, then run the new steps.

[`reference`](workspace/projects/agent_demo/reference.simple-steps-workflow)
is the workflow those six answers build. (`totals` holds only the totals —
a map step is only its results — so `with_totals` puts each order beside
its total for the steps after it.)

## From the terminal: `ask.py`

```
$ python examples/agent_demo/ask.py
Asking llama3.2:3b at http://localhost:11434

── totals: Add a step called totals with each order's total: price times quantity.
      agent: Adds totals.
      add     totals after orders: =line_total[mod.map(), mod.name("total")](wf["orders"])
      (1 attempt(s), 4.2s)
…
── does each task's step do the job?
PASS  totals     line_total[mod.map(), mod.name("total")](wf["orders"])
…
N/6 tasks done right by llama3.2:3b
```

It sends the six requests in [`tasks.py`](tasks.py) in turn, applies each
proposal that passed the checks (as **Apply** does), runs what the agent
built, and checks each step **by its output**, so a different but correct
formula still passes. What it built is saved as `agent-built`; open it in the
UI. `python ask.py "keep only tea orders"` asks one thing of your own and
prints the proposal.

A small model won't always get 5/5, and the results differ between models;
that's what this is for. One difference from the UI: `ask.py` sends the
workflow without the steps' outputs, so the model sees a little less.

## What `runme.py` checks, without a model

1. the `reference` workflow runs and passes each task's check;
2. the agent's checks accept every reference step, and refuse the mistakes a
   small model makes — a bare step name, a tool that doesn't exist, a step
   that isn't there yet, a resource the workflow doesn't have;
3. one agent turn with a scripted model: a wrong first answer goes back to the
   model with its problem, and the corrected one comes out as a clean change.

## Writing tools an agent can use

The agent sees each tool's **name, signature, and the first line of its
docstring** — nothing else. [`order_tools.py`](order_tools.py) is written for
that:

- names say what a tool does: `line_total`, `is_large_order`;
- parameters are named after the columns they read: `price`, `quantity`;
- the first docstring line is a sentence a user might say;
- `-> bool` marks a filter, `(acc, x)` a reducer.
