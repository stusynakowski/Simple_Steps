# 124 — Taking core 009, then building the grid on it

> Status: proposed, 2026-10-21. App pinned at core `9a86a0d`; target
> `b9f66d5` (core `origin/main`). Everything marked **verified** was found by
> running the app's backend tests against `b9f66d5`, or by running core
> directly, on 2026-10-20/21. Specs: [`spec/014`](../../spec/014-output-state-and-wiring.md)
> (what the grid shows). Core's own notes:
> [`009-status.md`](../../external/simple-steps-core/docs/core-proposals/009-status.md),
> [`ui-context.md`](../../external/simple-steps-core/docs/ui-context.md).

## Progress

- **2026-10-21 — Phases 0 and 1 done on branch `core-009-integration`**
  (from `examples-hierarchy`), except the 5 test updates, which need the
  TESTS phase. Pin `b9f66d5`; preflight clean; `smoke_install` 20/20; every
  example's `runme.py` passes; frontend 136/136; backend **6 failed** = the
  known `test_select_cell` + the 5 below.
- Tests still to update (TESTS phase), each asserting the pre-009 meaning:
  `test_tool_handle::test_a_step_input_infers_the_verb` (expects `map` saved;
  core now saves `auto`) and 4 × `test_formula_switching::test_each_editor_switch_runs`
  (`to a map tool`, `to a text tool`, `back from select to map`,
  `retry kept`: expect input columns carried through a map).
- Example changes: `scored`/`bucketed` split into a map/group step plus a
  `zip_` (basic, main); `region_table` is a `zip_` (dummy_llm); file names
  zipped beside results (image_processing); a new `with_totals` agent task
  (agent_demo); `bad_examples` drops `output_replaces_input` (core no longer
  refuses it; its successor is ask C22) and turns `output_overwrites_value`
  into `reads_a_result`.
- New asks for core: C22–C27 in `008-core-changes.md` (notably C22: `zip_`
  silently drops a duplicate column).
- **Confirmed by the owner, 2026-10-21**, one change at a time:
  1. *Results-only steps*, and the 4 switching tests updated to expect only
     the result column — **on condition** that any output cell can be traced
     to the exact input cells that made it. Checked by running core: rows
     via row ids, columns and argument cells via the saved formula
     (spec 014 REQ-VIS-058; core ask C27 to make `inputs` complete).
  2. *Implicit steps save `mod.auto()`* (app and the `test_tool_handle` test)
     — **plus** a setting that shows the orchestration auto chose, and the
     modifiers it added, explicitly (spec 014 REQ-VIS-059; to build with the
     formula bar / popover work).
  3. *Example changes*: basic + main, dummy_llm + images + plotly,
     agent_demo's sixth task, and the bad_examples lessons.
- Backend tests now **1 failed** (the known `test_select_cell`) / 353 passed.
- **Working rule:** tests change only when unavoidable; each key core change
  is confirmed by the owner before it lands, in small pieces.
- **2026-10-21 — pin moved to `523ad1d`** (core's answers to asks C21–C27),
  each piece confirmed by the owner: the pin; deleting `SHIM(core §C21)` for
  `output.uncaught`; accepting the two new refusals (`zip_` sharing a
  column, `collapse(by=…)` on a missing column) plus a bad example for the
  first; input values shown only in the popover, labelled (spec 014
  REQ-VIS-060). Backend 1 failed (known) / 353 passed; examples all pass;
  frontend 149/149; preflight clean; `smoke_install` all stages passed.
- **Phase 4–5 first slice built ahead of phase 2** (frontend only, no core
  dependency): selection in the grid (cell, row, column, corner triangle,
  Shift block, ⌘/Ctrl scattered; one dark outline round the selection), the
  open control on the selection's corner, and the selection popover (centred
  where opened, click-off closes, drag moves and pins, minimize/close, short
  and full expression, a state line). A typed cell's full view is
  `CellViewer` embedded in the popover (owner: a widget nested in a widget;
  the popover owns the controls, events are isolated). The in-grid
  click-to-open strip is gone; its one test now opens the cell through the
  popover. **Still to do:** the popover's inputs (left) and outputs (right)
  toggles, which need phase 2; the status bar line for a selection
  (REQ-VIS-013 — shown in the grid footer for now).

- **2026-10-23 — pin moved to `86170a3`** (core's `#` row numbers, column
  numbers, `cols["#"]`, `wf["p"].header`), with the owner. On it, a loaded
  table always gets its own `#` 0…n-1, so the app's per-step workflows lost
  row links: a result computed after a sort and zipped back beside its
  input paired the wrong rows, silently. Fixed by **phase 2, first slice**:
  `session_workflow.py` (since renamed `kernels.py`) — one core `Workflow` per session for the active
  workflow; each `/api/run` carries every step (`workflow_key`,
  `workflow_steps`), unchanged formulas are left alone, inputs never run in
  the session run first, renames keep outputs; `POST /api/workflow/sync`
  declares without running and returns every step's state. The UI sends the
  whole workflow on each run, syncs after an edit, and shows a step whose
  input changed as **out of date** (core's reason as the tooltip). Literal
  steps (`[1, 2]`, `{"x": 1}`) are declared in core as values; other
  old-syntax steps still run on the old path and are loaded as tables.
  Gate met: every example passes through it (sort-then-zip checked), backend
  1 failed (known) / rest passed, frontend 149/149, `smoke_install` 20/20.
  **Still to do in phase 2:** inactive tabs shown from saved outputs; cell
  marks from `wf.preview` are phase 3.
- **2026-10-23 — kernels** (owner: JupyterHub-like). A *kernel* is one live
  workflow: its core `Workflow`, every step's output with its version and
  reads, and the app's bookkeeping. Kernels are kept per (session,
  workflow), `MAX_LIVE = 1` per session; opening another saves the least
  recently used to disk (core's `to_session_dict()`), an idle one is saved
  after `IDLE_SECONDS`, all are saved at shutdown, and asking for a saved one
  restores it with `Workflow.from_dict()` — **nothing recomputes**: outputs,
  versions, row links and staleness come back (checked by running: switch
  A → B → A and a simulated restart, 0 tool calls). `/api/workflow/sync`
  returns refs for outputs the UI lacks, and the UI syncs when a workflow
  becomes active, so a reopened tab shows its outputs. When core can't save
  an output (image arrays, Figures — asks C29, C30) the kernel is saved
  without outputs and those steps re-run. Examples' checks don't persist.
  This closes phase 2's "inactive tabs shown from saved outputs".

## Summary

| Phase | What | Why first | Gate |
|---|---|---|---|
| **0** | Take the pin | everything else builds on it | preflight passes |
| **1** | Back to baseline on the new core | ~100 tests fail on it today | 1 known failure, examples pass |
| **2** | One core `Workflow` per session | staging, plans, versions and staleness need all steps in one workflow | examples run through it |
| **3** | Draw the grid from `wf.preview` | cell states (spec 014 §4) | staged / failed / stale shown from core |
| **4** | Selection | bounding boxes, blocks, name box (spec 014 §6, §9) | selections save as core `select` steps |
| **5** | Selection popover | spec 014 §8 | inputs and outputs traced |
| **6** | Editing: references and consequences | spec 014 §7.2, §4.4 | edit previews from core |

Phases 0–2 are the core integration. 3–6 are the frontend, in an order where
each phase is usable on its own.

---

## What changed in core, for the app

From core's `009-status.md`, each checked by running core:

1. **A step stores only its results.** `map`, `group` and `expand` output only
   their result column. Inputs are reached through row ids (`zip_`).
2. **`Output(data, states, meta)`.** `output.ledger` and `LEDGER_COLUMNS` are
   gone. Per-cell `states`, `row_states`, `notes` (only rows with something to
   say). `output.failed` is still a DataFrame, now of notes (`state`, `error`).
3. **Row ids are the links.** Most verbs keep the input's ids; `expand`
   derives `"1.0"`, `"1.1"`. Ids are a mix of ints and strings.
4. **`zip_` pairs by id, strictly** — an unmatched row fails the step.
5. **Staleness from data versions** (`wf.version`, `meta["read"]`).
6. **Implicit steps save `mod.auto()`**, plus a default `breaker(after=5)` on
   row-wise steps. The verb run is in `meta["auto"]["verb"]`.
7. **`wf.preview(step, rows=)` and `wf.cell(step, row, column)`** for drawing
   grids and answering clicks, run or not.

**Not affected:** the app saves its own workflow format, not core's, so
core's saved-format version 3 doesn't reach it.

---

## Phase 0 — Take the pin

```bash
git -C external/simple-steps-core fetch
git -C external/simple-steps-core checkout b9f66d5
# pyproject.toml: simple-steps-core @ git+...@b9f66d5
python scripts/preflight.py
.venv/bin/pip install -e external/simple-steps-core
```

## Phase 1 — Back to baseline

**Verified starting point:** ~100 failures and errors, almost all
`'Output' object has no attribute 'ledger'`. With only the two ledger reads
patched (in a scratch copy), **11** fail, each for a real reason below.

### 1a. The ledger (2 places)

| Where | Change |
|---|---|
| `grid_runner._engine_metrics` | `units` = `len(output.row_states)`; `status_counts` from `output.row_states.value_counts()` (drop zero counts) |
| `core_bridge.uncaught_failed` — `SHIM(core §C21)` | rewrite on `row_states` + `notes`: rows whose state is `failed`, with no `cause` and not `caught`. Still a shim: core's `_uncaught_failure` stays private |
| `grid_runner._row_errors` | unchanged; `output.failed` still has `error` (verified) |

Check: breaker-stopped rows (`attempts: 0`, "not run: stopped after 5…") —
confirm by running whether core marks them `failed`, and whether they count
as uncaught.

### 1b. Results-only steps

- **Examples** (verified failing): `basic/all-orchestrations` (`kept` filters
  on `n` after `scored`), `dummy_llm/resources` (`region_table` selects
  `city`), `plotly_charts/rich-cells` (reads `n`), plus `bad_examples` and
  the main example. Rewrite each to read inputs through
  `zip_(wf["in"], wf["out"])`.
- **Tests:** 4 cases of `test_formula_switching::test_each_editor_switch_runs`
  expect input columns carried through a map. Update to the new meaning —
  **TESTS phase** (`tests/**` isn't editable in IMPL).
- **UI, for now:** a map step's grid shows only its result column. Showing
  inputs beside results comes back in Phase 3.

### 1c. Implicit auto

- `run_formula` infers a verb itself and writes it into the operation
  (`compiled.needs_inference`). Stop: let core save `mod.auto()` (core
  decision 6). Report the verb from `meta["auto"]` (already done in
  `_engine_metrics`).
- `infer_verb_for` (editor suggestions) stays.
- `test_tool_handle::test_a_step_input_infers_the_verb` expects `map` in the
  saved stack; it should expect `auto` — TESTS phase.

### 1d. Keep row ids

- `run_grid_step` and `run_canonical_step` both store
  `output.data.reset_index(drop=True)`. Keep the index instead; store it with
  the data (parquet keeps it; check mixed int/str ids round-trip).
- `/api/data` sends each cell's row id beside its position
  (`Cell.row_id` stays the position; add `id`).
- Without this, `zip_` by id after an `expand` can pair the wrong rows
  silently.

**Gate:** `pytest -q` back to 1 failure (after the TESTS-phase updates),
`python src/SIMPLE_STEPS/examples/runme.py` passes, `scripts/smoke_install.py`
passes.

## Phase 2 — One core `Workflow` per session

**Today:** every step runs in a fresh `grid.Workflow()` with its inputs loaded
as literal data (`grid_runner.py:121`, `:213`, `:949`), then thrown away. So
core can't plan across unrun steps, version steps, or say what's stale.

**Rule (owner, 2026-10-21): several workflows can be open, but only one is
worked on — run — at a time.** The open-but-inactive ones are shown from
their saved outputs and can't run; switching tabs makes another the active
one.

**Change:**

- One `SessionWorkflow` per session: the **active** workflow tab's
  `grid.Workflow`. Inactive tabs keep their last outputs (readable, marked
  as not running) and no core workflow; making a tab active builds its core
  workflow from its formulas, and its saved outputs become the steps' data
  (stale where their inputs differ). One active workflow per session also
  bounds memory and avoids two runs competing for the same resources. A step is declared (`grid.Operation.from_dict`, the
  app's `OPERATION_REGISTRY` as tools) whenever its formula changes, so it is
  staged at once; it runs with `wf.run`.
- Endpoints:

| Endpoint | Returns |
|---|---|
| `POST /api/workflow/sync` (`[{id, formula}]`) | per step: status, problems, warnings, plan, `auto`, version, stale |
| `POST /api/workflow/run/{step}` | run one step; same per-step summary |
| `GET /api/preview/{step}?start&stop` | `wf.preview` (columns, rows with states, markers, window) |
| `GET /api/cell/{step}?row&column` | `wf.cell`, merged with the app's `cell_types` full view |

- Kept on the ref store, flagged for removal: raw `step`-tool values
  (`RAW_STORE`) and the whole-table shim `SHIM(core §C17)`.
- Frontend: `useWorkflow` syncs formulas instead of chaining `step_map` /
  `outputRefId`, and **stops clearing a step's output on edit** — core keeps
  it and marks it stale.

**Gate:** every example runs through the session workflow; editing an
upstream step marks readers stale exactly as core does; re-running with an
identical result leaves them fresh.

## Phase 3 — Draw the grid from `wf.preview` (spec 014 §4)

- Replace `hooks/useStagedPreview.ts` (it invents `${op}_result` columns) and
  `utils/errorCells.withRowErrors` (errors by row position) with
  `/api/preview`.
- `Cell` gains `state`, `id`, `type`, `error`, `cause`.
- Cell shades, recency marks, placeholder markers, step-header state and
  mapping shape, the run icon's "will re-running do anything?".
- Previous output pointer per step, for "Was …" and the change dot.

## Phase 4 — Selection (spec 014 §6, §9)

- Bounding box for cell / row / column / corner / block / scattered picks;
  status line.
- `utils/selection.ts` writes core's C7 selection syntax
  (`wf["s"][1:3][cols["a":"b"]]`, `wf["s"][[0, 2]]`) instead of
  `identity[mod.slice(at=…)]` — every shape verified to run and keep ids.
- Name box → a saved `select` step.

## Phase 5 — Selection popover (spec 014 §8)

- Open control on the selection border; framed, enlarged, scrollable copy;
  click-off closes; drag pins (reuse the cell viewer's pull-off and
  `DetachedStepWindow`).
- Header: short expression, expandable full expression, state line.
- Inputs toggle (left): checkered boxes + moving dashed lines into the frame,
  from `wf.cell(...).inputs`. Outputs toggle (right): from formula
  references + row ids, computed in the app. One SVG overlay above the grid.
- Toggle settings remembered per user; reduced motion respected.

## Phase 6 — Editing: references and consequences (spec 014 §7.2, §4.4)

- Caret in the formula bar: chips, full-range boxes, hover preview, click
  passes a reference (extends `StepWiringContext`).
- On each edit, re-declare the step in the session workflow (no run) and
  preview later steps: stale, invalid, shape change.

---

## Asks for core

Record in [`core-proposals/008-core-changes.md`](../../core-proposals/008-core-changes.md).

1. **`wf.cell(...)["inputs"][].state`** returns step statuses
   (`"completed"`), not cell states (`"known"`) — contradicts 009 §4.
2. **Docs are behind the code:** `009-status.md` and `ui-context.md` call
   `wf.preview` / `wf.cell` uncommitted; they are in `b9f66d5`.
3. **C21:** make "would this output stop a run" public.
4. **Per-cell staleness (009 step 7)** — the main thing spec 014's
   out-of-date marks depend on; please prioritise.
5. **A parent row that expands to zero items** disappears from
   `zip_(expanded, parent)` without a message (allowed by design; the UI
   should be able to show it).
6. **`join` / `stack` don't carry cell states** yet (known in core).

## Guardrails

- Phase rules (`docs/context.md`): code in IMPL; `tests/**` needs the TESTS
  phase. Phase 1 needs a short TESTS pass for the 5 test updates.
- Every new shim goes in `core_bridge.py`, tagged `SHIM(core §X)`, recorded
  in `008-core-changes.md`.
- Any `frontend/src` change: `python -m SIMPLE_STEPS.build_frontend`.
- Before pushing: `python scripts/preflight.py --fix` and
  `python scripts/smoke_install.py`.
