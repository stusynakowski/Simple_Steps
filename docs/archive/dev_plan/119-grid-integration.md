# 119 — Running steps on simple-steps-core's grid model

> Status: active as of 2026-10-05. Core pinned at `d8b6979`.

## What changed

Step execution now goes through `simple_steps_core.grid` — core's
integration surface (core `docs/integration.md`) — instead of the app's own
orchestrators. The UI contract is unchanged: the frontend still posts
`operation_id` + `config` + `step_map` to `/api/run` and reads results through
`/api/data`. `src/SIMPLE_STEPS/grid_runner.py` translates each request into
core's operation JSON, runs it in a one-step `grid.Workflow`, and stores the
result in the existing ref store.

| Setting | Effect |
|---|---|
| `engine = "grid"` (default) | tools run on core's grid |
| `engine = "legacy"` / `SIMPLE_STEPS_ENGINE=legacy` | the old orchestrators — an escape hatch until they are deleted |

Core verb operations (`=select(...)`, `=map(tool=...)`) always run on the
grid, whatever the setting.

## How a step becomes a core operation

| UI request | Core operation |
|---|---|
| `operation_id` | `tool_id` (`identity` for a tool-less verb) |
| literal args | `arguments`, coerced to the tool's annotations |
| `p=step1["col"]` | `over: step1`; a rename `col → p` first when the names differ, because core binds parameters to columns **by name**. The column keeps its original name in the output |
| `url="url"` with no reference | the older spelling of a column binding on the previous step |
| `_orchestrator` | the shape verb. Unset → core infers it (`-> bool` filter, `-> list` expand, `(acc, x)` collapse, else map); no input → `source` |
| `_name`, `_by`, `_initial`, … | that verb's settings, per `grid.modifier_catalog()` |
| `_retry`, `_timeout` | `retry` / `timeout` modifiers, applied per row |

Tools are never registered with core. Each run passes `OPERATION_REGISTRY` as
the tools dict, so nothing leaks into `grid.TOOLS`.

## What users see differently on the grid engine

- **A failing row no longer fails the step.** Core records it in the ledger;
  the step completes, the failed rows hold `None`, and the run log shows a
  warning with each row's error (`metrics.failed`, `metrics.errors`).
- **The new column is `value`, or `name=`.** The legacy engine named it
  `<tool>_output`, so a chained map overwrote the previous one.
- **A list or dict from a source tool is one cell**, until `expand` or `widen`
  says what its elements mean (core `desired_functionality.md`). Tools declared
  `operation_type="step"` keep the app's raw-value handling — `step1.field`
  reads a dict, records render as rows.
- **Thirteen core verbs are palette operations** (category *Core verbs*),
  usable in the formula bar and the console: `select`, `drop`, `rename`,
  `widen`, `slice`, `sort`, `distinct`, `map`, `filter`, `group`, `expand`,
  `collapse`, `sweep`.
- **The Orchestration dropdown is built from `GET /api/modifiers`**
  (`frontend/src/components/OrchestrationControl.tsx`), with the chosen verb's
  settings and retry/timeout.

## Still on the legacy path (shimmed, `core_bridge.py`)

- `SHIM(core §K)` — tools that take a whole table (`df: pd.DataFrame`).
- `SHIM(core §L)` — a value from another step: a raw value, or a whole column
  given to a `list`-typed parameter.

Both are recorded in `docs/core-proposals/003-app-adoption.md`. A step that
reads two upstream tables fails with a message naming core 004 §B6.

## Verification

- Every step of core's `examples/all_orchestrations` sent through `/api/run`
  as the UI sends it: **37/37 match core's output exactly**.
- Backend suite on the grid engine: baseline (1 known failure).
- Driven in the browser: source step → tool with `map` and `name=score` →
  both complete, `score` column correct.

## Next

1. **TESTS phase:** rewrite the tests that pin the legacy modules
   (`test_orchestrators`, `test_pack_loader`, the `ss_*` cases in
   `test_formula_alignment`) against the grid, and add `TEST-*` cases for
   `grid_runner`. They cannot be edited in IMPL.
2. **Then delete** `orchestrators.py`, `orchestration_ops.py` (`ss_*`), the
   `legacy` engine setting, and `pack_loader.py`'s tiers in favour of importing
   a workspace `tools/` folder (packs are retired), plus the built-ins that
   duplicate core verbs (`select_columns`, `sort_by`, `deduplicate`, …).
3. **When core lands** a whole-table verb (§K) and P5 (§L), delete
   `needs_whole_frame_shim`.
4. **A workflow-level session on the grid** (`wf.rename`, `remove`, `stale`
   from core 004 A4/A5): needs the UI to send step definitions, not just refs.
5. **Known parser bug, unrelated to the grid:** positional arguments are
   dropped — `=format_string(step1["n"])` parses to `args: {}`.
6. **UI issues found running `examples/all_orchestrations` in the browser**
   (all 38 steps run and match core; these are display issues):
   - The data view shows only columns *new relative to the previous step in
     the list*. With `over=` a step can read any earlier step, so real output
     is hidden — `grid_search` loses its `value` column because the step
     before it (`wide`) has one. Compare against the step it reads instead.
   - On reopen, `hydrateStep` rebuilds each formula from its parsed args, so
     `over=readings` comes back as `over="readings"`. It still runs (the
     adapter resolves step names), but the text no longer matches the file.

## Fixed while building the example

- Reopening a saved workflow lost every formula and label: the pipeline
  endpoint returned v2 steps (`name`/`expression`/`meta`) while the UI reads
  `formula`/`label`/`config`. `StepConfig.ui_dict()` now returns both.
- `_orchestrator`, `_name`, `_retry` … were dropped on save. They persist in
  the step's `meta.settings`.
- `hydrateStep` injected `data=stepN` into any formula without a `step…`
  argument, breaking steps that name what they read (`over=readings`) and
  sources. It now does so only for old saves with no usable formula.
