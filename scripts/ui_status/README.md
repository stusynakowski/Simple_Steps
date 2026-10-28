# UI status: check the formula-UI work

A workspace for the items in
[`docs/dev_plan/126-formula-ui.md`](../../docs/dev_plan/126-formula-ui.md):
open it in the UI to see each issue, and run `status.py` to see where each
one stands. Not shipped: it lives in `scripts/`, outside the package (the root `/examples/` is gitignored: it is where `simple-steps --load-examples` copies to).

## Run it

From the repo root, with the dev venv active:

```bash
python scripts/ui_status/status.py                # the report: OPEN / CHANGED / CORE
simple-steps-dev --workspace scripts/ui_status    # the UI at http://localhost:5173, hot reload
```

`simple-steps-dev` reads `scripts/ui_status/app.py` (its four tools) and
`projects/ui_status/` (the workflows). Edit `frontend/src`, and the page
reloads.

## The report

| Line | Means |
|---|---|
| `OPEN` | the problem is still there, measured: the parser refuses the form, `/api/data` lacks the field, or the code that causes it is still in place |
| `CHANGED` | that measurement no longer finds the problem. **Confirm it in the browser** with the workflow named, then mark the item done in 126 |
| `CORE` | what core gives for the decision, from running core: per-cell states, planned shapes, lineage columns. If one of these changes, core moved |

The frontend checks look for the code that causes each problem, so
`CHANGED` means the code moved, not that the fix is right. Every count of
open items is a fact; a fix is only confirmed by trying it.

## The workflows

Open one from the file explorer. Each step's notes (its **Settings** panel → Notes, also shown in **Analytics**) say
what to try and what the decision expects.

| Workflow | Items | Try |
|---|---|---|
| `01-formula-bar-and-panel` | R1, D3, D4, F1 | edit in the bar and watch the panel (fx); Enter vs Cmd/Ctrl+Enter; a formula that doesn't parse; choose a tool from the autocomplete |
| `02-cell-states` | R5, R6, D7 | run all: known, failed, null, absent (`stacked.extra`), the empty step; declare `staged` without running; edit `readings` and watch `doubled` go stale |
| `03-references` | D1, D5, D6, R3, R7, F11 | with the caret in `reader`, pick a column, rows, a cell, a block from `readings` |
| `04-lineage` | D8, R9 | the index after filter, slice, sort, distinct, expand, collapse, stack, join, and a chain |
| `05-staged` | R6 | **don't Run All.** Open it: every step is staged, with core's reason its rows aren't known. Run only `readings` (⌘/Ctrl+Enter): `doubled` and `by_n` show 4 pending rows, `big_only` and `top2` 4 `maybe` rows (dashed: a filter or slice may drop them), `split` and `per_ward` a typed header and core's reason |

## Adding a check

When 126 gains an item: add a step to the right workflow, with notes saying
what to try, and a `report(...)` line in `status.py` that measures it. Keep
each check to one fact.
