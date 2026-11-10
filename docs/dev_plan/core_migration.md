# Moving Simple Steps onto core v1.0.1

> Written 2026-11-09, from the app at `9ae73fd` (pin `58bc115`, core 0.2.0)
> to core `fed4d1a` (tag `v1.0.1`, 108 commits later). Everything under §1
> was **run**, not read: the app's tests and examples on core `fed4d1a`, and
> each finding probed on core alone.
>
> Core's own guide to this move is
> [app-migration.md](../../external/simple-steps-core/docs/design/app-migration.md).
> Earlier moves onto core (0.2.0, 124, 125) are in
> [`../archive/dev_plan/core_migration/`](../archive/dev_plan/core_migration/).

**Goal.** Core's update refines its rules. The app follows the refinements
with the smallest change that keeps today's functionality. It is **not** a
refactor: what core newly makes possible (§3) is a separate decision.

## 1. What changed in core, and what the app adjusts

Before: the app imports fine; `pytest` 14 failed (baseline 1, the known
`test_select_cell`); the examples fail.

| # | Core refinement | What failed in the app | Adjustment |
|---|---|---|---|
| 1 | **D9**: a step's one output column takes the step's name, not `value` (`eadc2f0`) | example expectations; 4 editor-switch tests. And a bug: `/api/run` for a formula outside a workflow ran under a throwaway step `__formula__`, so its column was called that | `grid_runner.run_formula` runs as the real step when its name is an identifier the formula doesn't read; expectations name the step |
| 2 | **PK8**: a tuple widens to `var0, var1` (was `c0, c1`) | example `split` | expectation; two comments |
| 3 | retired settings (`axis`, `replace`, `retries`) gone from `map`'s "it accepts" | bad example `misspelt_setting` | expected words |
| 4 | `mod.copy` is a new verb that needs `columns=` | 2 `copy` cases in `test_formula_switching` (the test lists every no-tool verb) | the test's settings table gives `copy` its `columns=` |
| 5 | **S3**: an unwritten verb is decided when the step is and written (`mod.map()` plus a default breaker); `mod.auto()` is no longer saved (`2f40797`) | `test_tool_handle::test_a_step_input_infers_the_verb` | expectation |
| 6 | **S3**: a `-> bool` tool with no verb **maps**; keeping rows is written, `mod.filter()`. `k.infer_verb` says so: *"to keep rows, write mod.filter()"* | example `auto_filter`; the "to a filter tool" switch | expectations. No editor change: `/api/infer_verb` already carries core's reason |
| 8 | **S5a**: a view row's number is `#`; its `id` field is gone | `/api/view` (the grid) raised `KeyError: 'id'`. No test covers it; found driving the UI's calls | `kernels.view` reads `row["#"]`: a pick's integer is that row number (S5d) |
| 9 | **SM** (owner, 2026-11-04): only the edited step is stale; a reader turns stale once the step before it re-runs with new data | nothing fails; the grid marks fewer steps out of date after an edit than before | none: core's rule |
| 7 | **S3**: a parameter binds the lone column of its type, and core writes the binding (`name=wf["people"][cols["first"]]`); with several it is refused and the message writes the fix | bad examples `parameter_not_a_column`, `reads_a_result` now run | `people` gets a second text column, so the first is still refused. `reads_a_result` is removed: core accepts it on purpose (§4) |

Every test edit asserts behaviour core removed on purpose (owner go-ahead
2026-11-09). The app's parser reads every form core writes back here
(checked: the written bindings, the breaker).

New for core, in [008](../core-proposals/008-core-changes.md) (§ At core
v1.0.1): **C39**, a source's one column (and a literal's, and the empty step's) is
still `value` while every other verb's takes the step's name; **C36**, `map`'s `name` still defaults to
`'value'`. All six shims (C18, C32, C33, C34, C36, C37) still apply.

## 2. Gates

`pytest` at baseline (1 failure), `examples/runme.py`, `cd frontend && npx
vitest run`, `python scripts/preflight.py --fix`, `python
scripts/smoke_install.py`, and the UI end to end: declare, run, edit
(stale), save, load.

## 3. Later, each its own decision

Not needed for today's functionality; core makes them possible.

| | What | Why it waits |
|---|---|---|
| L1 | Core's `formula(text)` in place of the app's parser (`operation_formula.py`, 923 lines). The app's parser refuses core's new pick forms: conditions (`wf["r"][cols["n"] > 1]`), a string as a column (`wf["r"]["n"]`), a pick as a tool's input | the app writes none of them today. Supersedes the "replace the parser" answer of 2026-11-09's first plan |
| L2 | `kernels.py` reads what core's kernel reports (`repr(k)`, `step.problems`, `k.needs_run()`) | a refactor; nothing fails without it |
| L3 | **Done 2026-11-09.** A step's problems are listed in its summary and on its status pill's hover (they were synced but never shown); a step reading a stale one shows *out of date*, with core's reason (`read stale 's'`, from `k.needs_run()`); the summary shows *Core runs:* the formula core holds when it differs from the one written (the verb it decided, the bindings it wrote) | — |
| L4 | Progress and `cancel()` (K23), the output store (C32), media (R7), stages (R9) | core hasn't built them; the app keeps its own (archive 01 §5) |

## 4. Decisions (owner, 2026-11-09)

| # | Question | Decided |
|---|---|---|
| 1 | Pin | `fed4d1a`, tag `v1.0.1` |
| 2 | Tests asserting behaviour core removed (§1) | update them |
| 3 | Scope | refine, not refactor: §1 now, §3 later |
| 4 | Where this plan lives | here; earlier notes in `archive/dev_plan/core_migration/` |
| 5 | `reads_a_result`, no longer a mistake (§1 row 7) | removed from the bad examples |

## 5. Progress

| Step | Status | Commit |
|---|---|---|
| pin and submodule to `fed4d1a` | done: preflight 3/3 | `6c5883d` |
| §1 adjustments | done: pytest at baseline, every example passes | `7613805`, this commit |
| §2 gates | pytest at baseline (1 failure); every example; vitest 145/145; preflight 3/3; smoke_install 20/20. The UI pass by hand is still to do | this commit |
