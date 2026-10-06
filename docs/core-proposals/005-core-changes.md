# 005 — Every change the app needs from simple-steps-core

> **For `simple-steps-core`.** Status: proposal. First checked against core
> `d8b6979` on 2026-10-05; **re-checked against `c73f6f8` on 2026-10-06**:
> K10 is done, K11 regressed, the other 16 are unchanged (see "Re-check at
> c73f6f8" below).
>
> This is the one list. It replaces the open items scattered across
> `003-app-adoption.md` (§K, §L), `docs/dev_plan/120` §8, `docs/dev_plan/121`
> §3, and core's own `docs/core-proposals/004-grid-adoption.md` (B6–C11). The
> old IDs are mapped in the last section.

## How to check progress

```bash
python scripts/core_asks.py
```

It runs one probe per ask against the installed core and prints **OPEN** or
**DONE** with what it observed. Every "Today" line below is that script's
output at `d8b6979`, where all 18 were OPEN. An ask is finished when its line
says DONE. K17 is the exception: it needs a manual check.

## Summary

| ID | Ask | Priority | Removes from the app |
|---|---|---|---|
| **K1** | An unrun source's columns are unknown, not empty; re-check steps once their input has run | **1: wrong results** | blocks a workflow-level grid session |
| **K2** | Verb inference must not depend on run state | **1: wrong results** | same |
| **K3** | Refuse an operation used where a step reference belongs | **1: wrong results** | the formula's inline-operation check |
| **K4** | Refuse `over` given in both the modifier and the call | **1: wrong results** | — |
| **K9** | One `select` for rows and columns | **2: needed for the UI** | two-step cells and blocks |
| **K10** | A value from another step as a tool argument (P5) | ✅ **done in `c73f6f8`** | `SHIM(core §L)`, for whole-step values |
| **K12** | A whole-table verb | **2: needed for the UI** | `SHIM(core §K)` |
| **K6** | Declare a source in call form | **2: needed for the UI** | `.bind()` spelling for sources |
| **K7** | Declare a sweep in call form | **2: needed for the UI** | — |
| **K13** | `modifier_catalog()` says which verbs take a tool | 3: cleanup | hard-coded verb lists in two files |
| **K5** | In Python, `over` takes only a `StepRef` | 3: consistency | — |
| **K8** | Tool-less modifiers callable on a reference | 3: consistency | `identity[…]` spelling |
| **K14** | Progress callback on `run` | 3: features | — |
| **K15** | Re-run only the failed rows | 3: features | — |
| **K16** | A pluggable results store | 3: features | the app's own result store |
| **K11** | A step reading two steps (`stack`, `zip`, `join`) — **and a regression to fix now** | 4: later (the crash: 1) | `merge_steps` |
| **K17** | Keep the workflow JSON loadable across P0 | 4: later | — |
| **K18** | Enforce `timeout` | 4: later | the "not enforced" note in the UI |

Priority 1 asks are cases where core accepts something and **silently
produces a wrong result**. They come first, whatever else is planned.

---

## Re-check at `c73f6f8` (2026-10-06)

`c73f6f8` moves a step's input out of its modifiers into its own slot,
`Operation.input`, and writes references as typed JSON: `"input": {"$ref":
"readings"}`, and `{"$ref": …}` in `arguments`. Modifiers now hold only
literal settings, and `over` is no longer in `modifier_catalog()`. This is the
literal/reference split from `docs/dev_plan/120`, done in core.

| Ask | Result |
|---|---|
| **K10** | **DONE.** `scale[mod.map()](wf["readings"], weight=wf["params"])` gives `[20, 40, 60, 40]`. Also checked: the argument serialises as `{"$ref": "w"}` and survives a JSON round trip; changing `w` marks the reader `stale`; `remove("w")` is refused while it's read; `rename` rewrites the argument. |
| **K11** | **Regressed.** `scale[mod.map(over=[wf["a"], wf["b"]])]` used to give a clear *"not an earlier step"* problem. Adding it to a workflow now **raises** `TypeError: __str__ returned non-string (type list)`: `Operation._add` wraps any non-`StepRef` `over` in `StepRef(over)`, a list included. **Fix:** in `_add`, accept only a `StepRef` or a string, and raise *"one step reads one input; combining two needs a merge verb"* for anything else. |
| K4 | Unchanged: `over` in the modifier plus a call input — the call still wins silently (now into `Operation.input`). |
| K5 | Unchanged: `mod.map(over="readings")` still accepts a string as a reference in Python. |
| the other 14 | Unchanged. |

Old saved operations with `over` inside a modifier still load: `from_dict`
moves it into `input`. Core's own tests: 437 passed.

**What it changed in the app** (fixed alongside): the palette's verb
operations built their `over` field from the catalog, so they lost it; the
app now adds it itself. `grid_runner` now writes the `input` slot directly
rather than relying on core moving `over` for it. The app's tests and the
`all_orchestrations` check (38/38) pass on `c73f6f8`.

---

## Priority 1 — silent wrong results

### K1. An unrun source's columns are unknown, not empty

**Today:** `declared invalid; after run_all -> {'value': [None]}`

```python
wf["readings"] = to_rows.bind(data=DATA)[mod.source()]      # tool-backed, not run yet
wf["scored"]   = scale[mod.map(name="score")](wf["readings"])
wf["picked"]   = mod.select(over=wf["scored"], columns=["city", "score"])
# picked: invalid — "select names 'city', which the input does not have (it has score)"
wf.run_all()   # readings and scored run correctly; picked stays invalid -> {'value': [None]}
```

The tool-backed source declares no columns, so later steps are checked
against an empty set. `run_all` never re-checks them once the source has run.
Declaring the same steps *after* running the source gives the right answer.

**Ask:**
- **Unknown, not empty:** treat an unrun source's columns as unknown, so
  column checks against it are deferred rather than failed.
- **Re-check after running:** when a step runs, re-check the staged steps
  that read it, and clear problems that were caused by unknown columns.

This is close to core's open item D2 (source schemas). A source that
declares its schema would remove the unknown case entirely.

**Done when:** `picked` returns `{'city': [...], 'score': [10, 20, 30, 20]}`.

### K2. Verb inference must not depend on run state

**Today:** `with data: collapse; before a tool-backed source runs: map`

```python
add_n(wf["readings"])   # collapse when readings holds data; map when it's an unrun tool-backed source
```

The same text produces two different operations.

**Ask:** infer from the tool's signature alone (`(acc, x)` collapses,
`-> bool` filters, `-> list` expands). If inference needs the input's
columns, mark the step as needing them and infer when they're known, but
never fall back to a different verb.

**Done when:** both workflows declare `collapse`.

### K3. Refuse an operation used where a step reference belongs

**Today:** `accepted; ran as source, status completed, data {'value': [None]}`

```python
scale[mod.map()](identity[mod.select(columns=["n"])](wf["readings"]))
```

Core treats the inner operation as plain data, runs a one-cell source, and
reports success.

**Ask:** raise *"an operation can't be an input yet; make it its own step and
pass wf[…]"* until calls can nest (core's P0, recursive ToolCall). When P0
lands, this becomes the nesting feature.

**Done when:** the call raises.

### K4. Refuse `over` given twice

**Today:** `accepted; over = 'other' (the call won)`

```python
scale[mod.map(over=wf["readings"])](wf["other"])
```

**Ask:** raise when `over` is set in the modifier and a source is passed to
the call.

**Done when:** the call raises.

---

## Priority 2 — needed for the UI

### K9. One `select` for rows and columns

**Today:** `select takes no parameter 'rows'; it accepts columns, over`

The UI's reference picking turns a selection into a select step (see
`docs/dev_plan/121` §1.2). Columns are `select`, rows are `slice`, and core
allows one shape verb per step: *"2 shape verbs in one step (slice, select);
at most one is allowed."* So a single cell or a block takes two steps.

**Ask:** `select(columns=[…], rows=…)`:

| `rows` | Means |
|---|---|
| omitted | all rows (today's `select`) |
| `[0, 2]` | those positions, in that order (today's `slice(at=…)`) |
| `{"start": 1, "stop": 4}` | that half-open range (today's `slice(start=, stop=)`) |

Row positions are 0-based, like `slice`. The output keeps each kept row's
index, so cells stay addressable. `slice` can remain as the rows-only form.

**Done when:** `identity[mod.select(columns=["n"], rows=[0, 2])](wf["readings"])` gives `{'n': [1, 3]}`.

### K10. A value from another step as a tool argument (P5) — ✅ done in `c73f6f8`

**Before `c73f6f8`:** `TypeError: cannot bind 'weight' to a step reference: a bound literal is a constant…`

```python
wf["params"] = 2
scale[mod.map()](wf["readings"], weight=wf["params"])
```

Core's status doc already plans this as P5 (D1). The app needs it for:

- a single-call tool that takes another step's value, such as a dict;
- a parameter that takes a whole column as a list (`values: list[float]`);
- references in keyword arguments, which the reference picker inserts.

**Ask:** let a keyword argument be a `StepRef`, resolved to the step's value
when the step runs: a one-cell step gives the cell, anything else gives the
grid. A dependency on that step is recorded, so `stale`, `remove` and
`rename` see it. It's serialised in the operation JSON as a typed reference,
e.g. `{"$ref": "params"}`.

**Done when:** the call above runs and gives `[20, 40, 60, 40]`.

**Removes:** `SHIM(core §L)` in the app's `core_bridge.needs_whole_frame_shim`.

### K12. A whole-table verb

**Today:** no such verb; `piv[mod.collapse()] -> AttributeError: 'NoneType' object has no attribute 'groupby'`

```python
@tool
def piv(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby("city", as_index=False)["n"].sum()
```

Every verb hands the tool one row, or an accumulator and a row. The app has
several whole-table tools (`pivot`, `unpivot`, `pandas_eval`, `merge_steps`,
`select_cell`) and users write their own.

**Ask:** a shape verb (for example `table`) that passes the input grid as the
tool's first parameter and uses a returned DataFrame as the step's grid: the
mirror image of the tool-backed `source`. It's one unit in the ledger. Its
row rule is "generated", because the tool decides the shape.

**Done when:** `piv[mod.table()](wf["readings"])` returns the grouped frame.

**Removes:** `SHIM(core §K)`.

### K6. Declare a source in call form

**Today:** `to_rows[mod.source()](data=…) -> TypeError: Operation.__call__() missing 1 required positional argument: 'source'`

The canonical formula is `tool[modifiers](input, **arguments)`
(`docs/dev_plan/120`), but a source has no input. Passing `None` instead runs
the tool immediately and stores inline data, not a step that can be re-run.

**Ask:** when the shape verb is `source`, make the positional input optional:
`tool[mod.source()](**arguments)` declares a tool-backed source, the same as
`tool.bind(**arguments)[mod.source()]`.

**Done when:** it returns an `Operation`.

### K7. Declare a sweep in call form

**Today:** `grid_cell[mod.sweep(…)]() -> TypeError: … missing 1 required positional argument: 'source'`

**Ask:** the same as K6, for `sweep`.

**Done when:** it returns an `Operation`.

---

## Priority 3 — consistency and features

### K13. `modifier_catalog()` says which verbs take a tool

**Today:** `modifier_catalog()['select'] keys: ['class', 'name', 'row_rule', 'settings']`

The app hard-codes which verbs apply a tool (`select`, `sort`, … don't; `map`,
`collapse`, … do), in `grid_runner.py` and in `OrchestrationControl.tsx`.

**Ask:** add `takes_tool` (`true` / `false` / `"optional"`) and
`default_tool` (`identity`, `gather`, or `null`) to each entry.

### K5. In Python, `over` takes only a `StepRef`

**Today:** `mod.map(over='readings') -> reference to step 'readings'; scale[mod.map()]('readings') -> Output (the string as data)`

The same string is a reference in one position and a value in the other.

**Ask:** in the Python API, accept only a `StepRef` for `over` (and raise *"pass
wf['readings']"* for a string). Keep string ids in `Operation.from_dict` JSON,
where the setting's type (`reference` in `modifier_catalog()`) says what
they are.

### K8. Tool-less modifiers callable on a reference

**Today:** `mod.select(columns=['n'])(wf['readings']) -> TypeError: 'Modifier' object is not callable`

**Ask:** make `mod.select(…)(wf["x"])` the same as
`op("identity")[mod.select(…)](wf["x"])`, for every verb that applies no
tool.

### K14. Progress callback on `run`

**Today:** `Workflow.run(self, step_id, tools=None) -> Step`. No callback, and
`Output.progress` can only be read after the step finishes.

**Ask:** `run(step_id, tools=None, on_unit=None)`, calling
`on_unit(step_id, unit, record)` as each unit finishes. The app streams it to
the UI's progress bar.

### K15. Re-run only the failed rows

**Today:** `Workflow.redrive exists: False`. `Output.failed` lists the rows,
but nothing re-runs just those.

**Ask:** `wf.redrive(step_id)` re-runs the failed units and keeps the
completed ones. The ledger's `attempts` goes up for the re-run units.

### K16. A pluggable results store

**Today:** `Output.ref: False`. Results sit inside each step; anything that
isn't plain data raises `PayloadError` on `to_session_json()`.

**Ask:** core's D5: `Output.ref` plus a store interface (`put`, `get`,
`delete`) the app can implement with its per-session parquet store.

---

## Priority 4 — later

### K11. A step reading two steps

**Today:** `over=[a, b] -> ("map over '[<readings>, <other>]', which is not an earlier step",)`

**Ask:** core's planned multi-input verbs, `stack` and `zip` first, then
`join`. The app's `merge_steps` waits on `join`.

**Re-checked on `66afce2` (2026-10-06): DONE**, as core 005 B's combine
constructors `join(a, b, on=…)`, `stack(a, b, …)` and `zip_(a, b, …)`. Run in
core: `stack(wf["a"], wf["b"])` over 2 + 1 rows stages as `stack · 3 cells`,
runs to `n = [1, 2, 3]`, and its `inputs` survive `to_json` → `from_json` as
`(<a>, <b>)`. The app compiles `join(wf["a"], wf["b"], on="k")`,
`stack(…)` and `zip_(…)` formulas to these operations
(`operation_formula._combine`) and the `all_orchestrations` check is 44/44.
**Still open:** the `over=[wf["a"], wf["b"]]` regression above —
`TypeError: __str__ returned non-string (type list)`. The app's compiler never
produces that form, so it does not reach users.

### K17. Keep the workflow JSON loadable across P0

**Today:** `to_json version = 1`. Checked by hand.

**Ask:** when P0 (calls inside calls) changes the operation JSON, bump
`version` and keep loading version 1 for at least one release, so saved
workflows still open.

### K18. Enforce `timeout`

**Today:** `4 units × 0.3s with timeout=0.05 took 1.2s; statuses ['completed', 'completed', 'completed', 'completed']`

**Ask:** fail a unit that runs past its `timeout`, recording a timeout error
in the ledger. Core notes this needs its async engine (B5).

---

## Not asked

- **The engine items in `003-app-adoption.md` §A–§J.** They concern the
  engine core is retiring; the app no longer uses it (`docs/dev_plan/119`).
- **Calls inside calls (P0).** That's core's own plan. Until it lands, K3
  keeps it from failing silently.
- **Anything already built:** the palette's parameter info, the verb catalog,
  tool-backed sources, delete/rename, and staleness (core 004 A1–A5) are done
  and working in the app.

## Where the old IDs went

| Old | New |
|---|---|
| core 004 B6 · 003 §L · 120/121 C8 | K10 (values) and K11 (two tables) |
| core 004 B7 · 121 C10 | K14 |
| core 004 B8 · 121 C10 | K15 |
| core 004 B9 · 121 C10 | K16 |
| core 004 C10 | K17 |
| core 004 C11 | K18 |
| 003 §K · 121 C9 | K12 |
| 120 C1 | K4 |
| 120 C2 | K5 |
| 120 C3 | K6, K7 |
| 120 C4 | K8 |
| 120 C5 | K1 |
| 120 C6 | K2 |
| 121 C7 | K9 |
| 121 C11 | K3 |
| (new) | K13 |
