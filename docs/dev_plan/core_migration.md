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
| L1 | **Done 2026-11-09** (branch `core-formula`): core's `formula(text)` reads every formula; `operation_formula.py` 933 → 456 lines, the change 527 lines smaller in all. Core's new pick forms (conditions, a string as a column, a pick as a tool's input) work in the formula bar | §6 |
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
| core 1.0.2, release 0.1.1 | done | `96c4026`, tag `v0.1.1` |
| L1: core reads formulas | done, below | branch `core-formula` |

**L1, as built.** `kernels.operation_for`, `grid_runner.run_formula` and the
agent's `check_step` read formulas with core's `formula()`; a pick on its own
becomes the identity-select step core stores. Core binds positional resources,
so `grid_runner`'s binding helpers went. `/api/parse_formula` answers as you
type from core's read alone (D2); what a step means is checked when the
workflow syncs, and the sync now keeps a refusal core makes on assignment as
that step's problem instead of failing the workflow. Those problems show in
the step summary, on the status pill and in the step editor's warning line.
The editor's parts are built from core's operation and the text (positional
resources, `$expr` for anything else); a pick as a tool's input has no parts
and is edited in the formula bar (D6). Test changes, each asserting behaviour
core moved or reworded (D2, D3, D4): `test_formula_switching`'s refusals are
checked by assigning the step, as Enter does; *the refusal reaches the
formula bar* became *reaches the step when entered*; the two-verb case
`select` + `sort` was dropped (core S3: pickers may stand before a verb).
`bad_examples` takes core's wording for four cases and drops `row_selection`
and `no_verb`, which core now accepts on purpose.

## 6. L1: core reads formulas (decisions, owner, 2026-11-09)

What core's `formula(text)` does, run on `fed4d1a`: reads every form,
the new picks included; needs no kernel; takes a leading `=`; refuses code
(`__import__` → refused). `Operation.to_source()` prints one back. It reads
syntax only: an unknown tool, two shape verbs or a misspelt setting is
refused when the step is assigned (`k.check`). It gives no reference
positions.

| # | Decision | Decided |
|---|---|---|
| D1 | What replaces `operation_formula.py` | core reads the text; a thin app adapter keeps `/api/parse_formula` and `/api/format_formula` answering in the same shape, so the frontend is unchanged |
| D2 | When a formula is checked | **Serious parsing and validation happen when the formula is submitted (Enter) or the formula form changes**, against the workflow's live kernel (`k.check`), which knows the inputs and their columns. While typing, only what is cheap: core's `formula()` for syntax and the reference positions. Today the bar calls `/api/parse_formula` on every keystroke |
| D3 | Whose wording | **Core's wording everywhere, except Simple Steps' Python-development wording**: where a message tells you how to write Python, it uses Simple Steps' names (`@simple_step_tool` for core's `@tool`, `simple_step_resource` for `@resource`, `bound` for `@bound_tool`). The 25 refusals where core says less than the app (group E) take **core's wording now, with no shim**, and are handed to core to improve: [012 C44](../core-proposals/012-asks-at-fed4d1a.md). Specifics reviewed by the owner: [core_migration_L1_messages.md](core_migration_L1_messages.md), 56 cases side by side |
| D4 | The app's own rules | drop those core decides otherwise on purpose; keep the rest as `SHIM(core §X)` plus an ask. **Outcome below: everything is core's.** The two shims planned for C40 and C41 aren't needed: core 1.0.2 fixed both |
| D5 | Reference positions (126 F8) | the app finds them with `ast` on text core accepted (about 30 lines, a shim) and asks core for them |
| D6 | The step editor and the new picks | conditions and picks as inputs work in the formula bar; the editor shows those parts as written text, through its `{$expr}` passthrough. Real editor controls belong to plan 130 |
| D7 | Order | its own branch, after `core-v1` merges into `main` |
| D8 | Core's accepted-but-wrong and raw-error cases (groups D, F) | handed to core ([012 C41–C43](../core-proposals/012-asks-at-fed4d1a.md)); the app shims only the unquoted setting (C41), the one that does the wrong thing silently |

### D4: the app's rules, and what becomes of each

| The app's parser refuses | Core | Becomes |
|---|---|---|
| a pick on its own as a step (`wf["s"]`) | accepts, on purpose | **dropped**: core's rule |
| a pick as a tool's input | accepts, on purpose (S3) | **dropped** |
| brackets with no shape verb (`dbl[mod.retry(times=2)]`) | decides the verb (S3) | **dropped** |
| an unquoted setting (`mod.sort(by=n)`) | takes `n` as a tool, then printing raises | core's: fixed in 1.0.2 (C41), refused with *"text needs quotes"* |
| — (the app binds it) a resource passed by position (`tool(wf["s"], res["tiny"])`) | `formula()` refuses it; the Python API binds it | core's: fixed in 1.0.2 (C40); `grid_runner._bind_positional_resources` goes with L1 |
| a tool with a verb but no input; a source given an input | accepts | core's (asked, C43) |
| everything else (one input, settings are literals, two shape verbs, a no-tool verb on a tool, …) | refuses, in its own words | core's (wording asked, C44) |

### Handed to core

[012-asks-at-fed4d1a.md](../core-proposals/012-asks-at-fed4d1a.md), for
the owner to pass on: **C40** positional resources in `formula()`, **C41**
an unquoted setting, **C42** five raw errors, **C43** three formulas
accepted that can't run, **C44** twenty-five messages to improve (each with
the proposed text), and C39, C36 (`value` column names).

### What the message review found (D3)

| Group | Cases | What it means |
|---|---|---|
| A. the same, or nearly | 12 | core's wording, no loss |
| B. core is better | 5 | core catches an unknown tool, an unknown step, a plain function (`print`), and knows the data (`column 3 of 's', which has 2 columns`) |
| C. core accepts, on purpose | 3 | a pick as a step, a pick as an input, a verb decided (S3) |
| D. core accepts, probably shouldn't | 4 | a tool with a verb but no input (`dbl[mod.map()]`); a source given an input; an unquoted setting (`mod.sort(by=n)`) |
| E. core's wording is worse | 25 | refuses rightly but says less (`dbl[mod.map()](s)`: app *"s is not defined. To use the step "s", write wf["s"]"*, core *"a tool's input in a formula is a step or a pick…"*); leaks internals (`binop`, `got Modifier`, `<Operation s>`); one names `@tool` |
| F. core's error looks like a bug | 5 | `'ResRef' object is not iterable`; an empty message; `res["db"]` alone answered with `data_version has no instance` |
