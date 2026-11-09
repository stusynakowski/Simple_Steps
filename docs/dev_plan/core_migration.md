# Moving Simple Steps onto core v1.0.1

> Written 2026-11-09, from the app at `9ae73fd` (pin `58bc115`, core 0.2.0)
> to core `fed4d1a` (tag `v1.0.1`, 108 commits later). Everything under §1
> was **run**, not read: the app installed in a clean venv against core
> `fed4d1a`, its tests and examples run, and each shim probed.
>
> Core's own guide to this move is
> [app-migration.md](../../external/simple-steps-core/docs/design/app-migration.md)
> (§3.4 formulas, §3.8 what the expression cleanup changes). Earlier notes on
> moving onto core (0.2.0, 124, 125) are in
> [`../archive/dev_plan/core_migration/`](../archive/dev_plan/core_migration/).

**Goal.** The same functionality on core v1.0.1, with less code and one
implementation per concept. Where core now does something the app does, the
app's copy goes.

## 1. Where the app stands on v1.0.1

| Check | Result |
|---|---|
| `import SIMPLE_STEPS` | ok: nothing the app imports was removed |
| `pytest` | **14 failed** (baseline 1, the known `test_select_cell`) |
| `examples/runme.py` | collapse, sweep, expand, widen and every resource example fail; `KeyError: 'value'` |
| core's `tutorial/handover.py` | 53 ✓ · 4 ✗ · 2 ? |
| the six shims in `core_bridge.py` | all still needed |

### 1.1 Why the tests fail: three deliberate core changes

| Core change | Core commit | Fails here |
|---|---|---|
| **D9**: a step's one output column is named after the step, not `value`. The app's formula check runs under the step name `__formula__` ([grid_runner.py:23](../../src/SIMPLE_STEPS/grid_runner.py#L23)), so its column is `__formula__` | `eadc2f0` | `test_formula_switching::test_each_editor_switch_runs` (5 cases); the examples' expected results |
| **S3**: a verb not written is decided when the step is, and saved (`mod.auto()`, `breaker`) | `2f40797` | `test_each_editor_switch_runs` (formula text); `test_tool_handle::test_a_step_input_infers_the_verb` (`'breaker' == 'auto'`) |
| `copy` needs `columns=`; it has no default | — | `test_a_verb_that_applies_no_tool_refuses_another_tool[copy]`, `…takes_its_default_tool[copy]` |

Eight test functions plus the five example runs. Each test asserts
behaviour core removed on purpose, so under the CLEANUP rule it changes:
**owner go-ahead 2026-11-09, each one listed before it's edited**.

### 1.2 Handover: what core hasn't built (the app keeps its own)

| Ask | State | The app meanwhile |
|---|---|---|
| K23 progress, `cancel()` | not built | `progress.py` |
| K28b per-cell lineage stored | worked out on request by `k.cell` | nothing |
| R7 media handles | not built | `cell_types.py` |
| R9 stages | not built | nothing |
| K19a, Pc4 | **?**: rows pair by identity between aligned steps (CA-11), never by position | refusals now write the join; show them |

### 1.3 Shims: probed on `fed4d1a`

| Shim | Still needed? | What ran |
|---|---|---|
| C18 description = first docstring paragraph | yes | `describe()["tools"]["dbl"]["description"]` → `'Double it.'` (first line only) |
| C33 `inspect.signature(tool)` | yes | `(*args, **kwargs) -> 'Any'` |
| C34 `check_modifier`, `shape_verbs` internal | yes | not exported; the kernel offers only `check`, `infer_verb` |
| C36 `describe()` lists `name=` | yes, **and now wrong**: `map`'s `name` defaults to `'value'`, which D9 contradicts | `describe()["modifiers"]["map"]["settings"]` |
| C37 array cell crashes `k.view` / `k.cell` | yes | `ValueError: can only convert an array of size 1 to a Python scalar` |
| C32 kernel saved with outputs | yes | after `Kernel.from_json`, a run step is `staged`; no store API |

New ask for [008](../core-proposals/008-core-changes.md): C36's default
`'value'` (above).

## 2. The plan

One branch, `core-v1`. Each phase is a commit and ends with its exit
check. Removals are listed for the owner first (what each piece does, what
replaces it), then made one at a time.

### Phase 0: branch and pin

- Move `pyproject.toml`'s pin and `external/simple-steps-core` to `fed4d1a`
  together; `python scripts/preflight.py`; `pip install -e
  external/simple-steps-core`.
- **Exit:** preflight passes; the 14 failures of §1, no others.

### Phase 1: green on the new core, smallest change

- Read `output.value_column` everywhere the app assumes `"value"`
  (`grid_runner`, `example_check`, the examples' expected results).
- Show the verb core saved as core's decision; stop expecting it unwritten.
- Update the eight tests of §1.1, each listed first.
- **Exit:** `pytest` back to 1 failure; `examples/runme.py` passes.

### Phase 2: core reads formulas; the app's parser goes

Core's `formula(text)` reads formula text into an operation, pick or
literal, checked against the kernel's catalog, and never runs it (EX13,
`febe4dc`). `formula(step.formula)` gives the step back. This supersedes
the 2026-10-27 decision that the parser lives in the app (archive, 01 §9
decision 3).

- **Inventory first**, for the owner: each name used from
  [operation_formula.py](../../src/SIMPLE_STEPS/operation_formula.py)
  (923 lines; `compile_formula`, `FormulaError`, `describe`, `is_canonical`,
  `format_parts`, `not_a_step`, `references`, `is_literal`), its 8 callers,
  and what replaces it: `formula`, `FormulaError`, `step.formula`,
  `step.spec`, `k.check`, `k.infer_verb`.
- `/api/parse_formula` calls `formula` and keeps its response shape.
- Anything core can't give becomes a tagged shim in `core_bridge.py` and an
  ask in 008, never leftover parser code.
- **Exit:** `operation_formula.py` deleted; tests and examples as phase 1.

### Phase 3: the kernel reports itself

App-migration §3.3: `kernels.py` computes formulas, reads, problems and a
summary that core now gives (`k.steps`, `step.operation.reads`,
`step.problems`, `repr(k)`, `k.needs_run()`, `k.on_change`). The app's
kernel keeps hosting only: key, lock, last used.

- Inventory, then delete piece by piece.
- **Exit:** as phase 1.

### Phase 4: frontend

- The view's `#` is the row number `0…n-1`; lineage stays hidden behind
  the planned expander.
- Show the new problem codes (`bad_pairing`, `id_argument`, `bad_combine`),
  run warnings, and why a step is stale.
- `python -m SIMPLE_STEPS.build_frontend`.
- **Exit:** `cd frontend && npx vitest run`; preflight (bundle fresh).

### Phase 5: saved files and docs

- Re-save the examples and mock projects in core's current format.
- `CLAUDE.md`, `docs/context.md`: the pin-drift symptom names something new
  in this core.
- 008: close what v1.0.1 closed; add C36's default. Regenerate
  `scripts/core_probes/` and `scripts/core_asks.py`.
- `dev_plan/README.md` and `126`: the parser is core's.

### Phase 6: gates

`pytest` (1 failure), `examples/runme.py`, `preflight.py --fix`,
`smoke_install.py`, and the UI end to end: declare, run, edit (stale),
save, load.

### Not in this move

Progress and `cancel()`, the output store (C32), media (R7), stages (R9):
each is a small pass when core lands it (archive, 01 §5).

## 3. Decisions (owner, 2026-11-09)

| # | Question | Decided |
|---|---|---|
| 1 | Pin | `fed4d1a`, tag `v1.0.1` |
| 2 | Tests asserting behaviour core removed (§1.1) | update them, each listed first |
| 3 | The formula parser | core's `formula()` replaces the app's; supersedes the 2026-10-27 decision |
| 4 | Where this plan lives | here; earlier notes in `archive/dev_plan/core_migration/` |

## 4. Progress

| Phase | Status | Commit |
|---|---|---|
| 0 pin | done: preflight 3/3; pytest the 14 failures of §1, no others | this commit |
| 1 green | — | — |
| 2 parser | — | — |
| 3 kernel | — | — |
| 4 frontend | — | — |
| 5 files, docs | — | — |
| 6 gates | — | — |
