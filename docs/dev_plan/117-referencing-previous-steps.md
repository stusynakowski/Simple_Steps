# 117 — Referencing previous steps: suggestions for the selection UI

*Date: 2026-10-05*
*Status: **suggestions, nothing agreed**. Companion to [`103`](./103-ui-as-formula-formulator.md) (the UI's brief) and [`../core-proposals/001-index-selection.md`](../core-proposals/001-index-selection.md) (the core ask).*

Note 103 says the UI's only job is to help the user write a valid expression,
and names "insert reference" affordances as one of five obligations — "same
idea as Excel clicking a cell while editing a formula." This note is a list of
concrete suggestions for finishing that one obligation, written after probing
what the three resolvers actually do.

> **Everything below marked ✓/✗ was verified by running it**, not by reading.
> The probe is reproduced in the appendix so any claim here can be re-checked
> after a change.

---

## The framing: structured references, not A1

A1 notation (`B3`) is positional. Our columns are named, which makes the right
Excel analogue the **structured reference** — `Table1[Score]`,
`Table1[[Name]:[Score]]` — not A1. `step1["score"]` is already most of the way
there, and 103 has already settled that bracket form is the only thing the UI
emits. None of the suggestions below change that decision; several of them
finish enforcing it.

---

## 1. Where we are

### 1.1 Three emitters, two of them emitting dead syntax

| Click target | Token emitted | Site |
|---|---|---|
| Grid corner | `step1` | [`DataOutputGrid.tsx:314`](../../frontend/src/components/DataOutputGrid.tsx) |
| Grid column header | `step1["score"]` | `DataOutputGrid.tsx:115` |
| Grid cell | `step1["score"][1]` | `DataOutputGrid.tsx:116` |
| Grid row number | `step1[row=1]` | `DataOutputGrid.tsx:117` |
| Picker column badge | `step1.score` ← legacy | [`PreviousStepDataPicker.tsx:54`](../../frontend/src/components/PreviousStepDataPicker.tsx) |
| Picker cell badge | `step1[row=1, col=score]` ← legacy | `PreviousStepDataPicker.tsx:59` |
| Grid cell, *non*-wiring mode | `step1.score` / `[row=, col=]` ← legacy | [`OperationColumn.tsx:517,520`](../../frontend/src/components/OperationColumn.tsx) |

The same click produces a different token depending on whether a later step's
formula happens to be focused. `DataOutputGrid`'s own comment says the legacy
forms "were not valid Python and could not be evaluated by safe_formula" — and
two other components still emit them.

### 1.2 The three resolvers disagree

One token set, one DataFrame, three resolvers:

| token | `core.is_reference` | core resolver | `safe_formula` (AST) | engine regex | usable as `f(arg)` |
|---|---|---|---|---|---|
| `step1` | ✓ | DataFrame | StepProxy | DataFrame | ✓ |
| `step1["score"]` | ✓ | Series | ColumnProxy | Series | ✓ |
| `step1["score"][1]` | ✓ | `75` | `75` | `75` | ✓ |
| `step1[row=1]` | ✓ | AttributeError | FormulaError | Series (row) | **✗ unparseable** |
| `step1.score` | ✓ | Series | ColumnProxy | Series | ✓ |
| `step1[row=1, col=score]` | ✓ | AttributeError | FormulaError | `75` | **✗ unparseable** |
| `step1[["name","score"]]` | **✗** | **echoes the string** | StepProxy 3×2 | echoes back | ✓ |
| `step1[[0,2]]` | **✗** | **echoes the string** | StepProxy 2 rows | echoes back | ✓ |
| `step1[0:2]` | ✓ | AttributeError | StepProxy 2 rows | echoes back | ✓ |
| `step1[1]` | ✓ | IndexError (**row**) | KeyError (**column**) | echoes back | ✓ |

Three findings worth pulling out:

1. **`[row=N]` is not valid Python**, so it cannot appear inside a call. It
   survives only as a bare pass-through formula, caught by the legacy regex at
   `engine.py:426`. It is the grid's own row token.
2. **`is_reference` rejects list subscripts**, so `step1[["name","score"]]`
   falls past core's resolver and comes back as the literal string — exactly
   the silent-wrong-answer case `ReferenceResolver._walk`'s docstring says it
   was written to prevent.
3. **`step1[1]` means three different things**: a row to core, a column to
   pandas, nothing to the engine regex.

---

## 2. Grammar to settle first

The UI cannot be cleaned up before the token set is fixed, because the UI's
whole job here is emitting tokens.

| Selection | Proposed canonical token | Works today |
|---|---|---|
| whole frame | `step1` | everywhere ✓ |
| column | `step1["score"]` | everywhere ✓ |
| cell | `step1["score"][1]` | everywhere ✓ |
| multi-column | `step1[["name","score"]]` | AST ✓, core ✗ |
| row range | `step1[0:5]` | AST ✓, core ✗ |
| rectangle | `step1[["name","score"]][0:2]` | AST ✓, core ✗ |
| **single row** | **`step1.rows[1]`** | **nothing ✗** |

**SR-01 — adopt `step1.rows[1]` for a single row; retire `[row=N]` and
`[row=N, col=C]`.**
Proposal: `.rows[n]`. Core's grammar already anticipates it — the docstring
example in `domain/references.py` is literally `step1.rows[0].name`, and
`parse_reference` returns `('step1', ['rows', 0, 'name'])` for it today. It
needs a `rows` property on `StepProxy` and nothing else. `step1.iloc[1]`
already works but leaks pandas vocabulary into a spreadsheet UI.

**SR-02 — make a bare integer subscript an error, not a guess.**
Proposal: `step1[1]` raises with a did-you-mean naming `.rows[1]` and
`["<column>"]`. Three resolvers currently give three different answers for it;
picking one silently is how a typo becomes a wrong number downstream. This
follows the reasoning already recorded in [`116 §4.5`](./116-open-questions-and-decisions.md)
for unknown parameters — reject with did-you-mean rather than guess.

---

## 3. UI suggestions, ranked

**SR-03 — one emitter.** Extract `frontend/src/utils/referenceTokens.ts` with
one function per selection kind and route all three call sites through it.
Delete the legacy spellings in `PreviousStepDataPicker` and `OperationColumn`.
This is a bug fix, not a refactor: two of the three sites emit syntax the
parser rejects.

**SR-04 — drag to select a range.** The largest missing Excel behaviour: there
is no range concept anywhere today, only single clicks. Add anchor/focus state
to `DataOutputGrid` (mousedown anchors, mousemove extends, mouseup emits).
Column span → `[["a","b"]]`, row span → `[0:5]`, rectangle → the chained form.
All three already evaluate in the AST path, so this is frontend-only.

**SR-05 — colour-code each reference and outline its source range to match.**
The thing that makes an Excel formula legible, and we have none of it: a
reference is plain text in the bar with no visual tie to the grid it points at.
Blocked on SR-10.

**SR-06 — delete the Previous Step Data Picker panel.** Excel has no
"pick from a list of prior data" side panel — you click the cells. The panel
duplicates the grid, emits dead tokens, and is a second surface to keep in
sync. Prior-step grids are already clickable; make them always clickable and
drop the panel.

**SR-07 — remove the hover gate.** `OperationColumn.tsx:76` requires
`isWiringHovered` before a source step highlights. Excel arms every sheet the
instant you type `=`. Highlight all eligible upstream steps immediately.

**SR-08 — replace the blur timeout with explicit edit modes.**
`StepWiringContext.tsx:97` deactivates wiring on a 200 ms `setTimeout` so grid
clicks can land first — a race that gets worse as grids grow. Model it as Excel
does: `idle | editing | point`, entered on `=`, left on Enter (commit) or Esc
(revert). Esc currently does nothing at all.

**SR-09 — stop guessing `data=`.** Both injection paths hardcode `data=` as the
parameter name when the cursor sits inside parens
(`OperationColumn.tsx:110`, `StepWiringContext.tsx:124`). `currentOp.params` is
already in hand: insert the first unfilled required parameter's name, or insert
bare when the op takes a single positional.

**SR-10 — give `describe()` reference spans.** Prerequisite for SR-05. Today it
returns refs with no character offsets, drops trailing subscripts, and returns
`[]` for a bare reference:

```
=score(url=step1["url"], n=step2["k"][0])
  → step_refs: ["step1['url']", "step2['k']"]      ← no spans, the [0] is lost
```

Colour-coding needs `{text, start, end, step_id, kind}` per reference. This is
`src/SIMPLE_STEPS/safe_formula.py` — app-side, not core.

**SR-11 — show the resolved shape of a selection.** Excel's status bar shows
Count/Sum while you drag. The equivalent — `2 cols × 4 rows`, or the scalar
value — tells the user what a reference will yield *before* they commit it, and
is the cheapest way to catch a row/column mix-up.

---

## 4. What this asks of core

`external/simple-steps-core` is read-only here, so these belong in
`docs/core-proposals/`.

**SR-12 — accept list and slice subscripts in the reference grammar.**
`_REFERENCE_RE` in `domain/references.py:20` rejects them, which is what makes
`step1[["name","score"]]` resolve to its own source text.

**SR-13 — make `ReferenceResolver._walk` DataFrame-aware.** It is
container-generic today: an int means a row, a string means a column, and a
list of strings means a projection — none of which it knows.

**SR-14 — resolve the contradiction with proposal 001.**
[`001-index-selection.md`](../core-proposals/001-index-selection.md) §C argues
*against* subscripting a `StepRef` at all, which is the opposite of what a
click-the-grid UI implies. 001 is still marked "proposal, not agreed"; that
disagreement should be settled before SR-04 is built on top of it.

---

## 5. Summary

| ID | Suggestion | Where | Blocked on |
|---|---|---|---|
| SR-01 | `step1.rows[1]` for a single row; retire `[row=N]` | grammar + `step_proxy.py` | — |
| SR-02 | Bare int subscript errors with did-you-mean | grammar | — |
| SR-03 | One token emitter | frontend | — |
| SR-04 | Drag to select ranges | frontend | SR-03 |
| SR-05 | Colour-coded refs ↔ outlined source ranges | frontend | SR-10 |
| SR-06 | Delete the Previous Step Data Picker | frontend | SR-03 |
| SR-07 | Remove the hover gate | frontend | — |
| SR-08 | Explicit edit modes; Esc reverts | frontend | — |
| SR-09 | Param-aware insertion instead of `data=` | frontend | — |
| SR-10 | `describe()` returns reference spans | `safe_formula.py` | — |
| SR-11 | Selection shape readout | frontend | SR-04 |
| SR-12 | Grammar accepts list/slice subscripts | **core** | — |
| SR-13 | DataFrame-aware `_walk` | **core** | SR-12 |
| SR-14 | Settle the §C contradiction in 001 | **core** | — |

SR-03, SR-07, SR-08 and SR-09 are frontend-only, independent of each other, and
need no backend change.

---

## Appendix — the probe

The tables in §1.2 came from running this against core, `safe_formula` and the
engine with one shared DataFrame
(`name/score/age`, 3 rows):

```python
from simple_steps_core.domain.references import is_reference
from simple_steps_core.execution.context import SessionContext
from simple_steps_core.execution.resolver import ReferenceResolver
from SIMPLE_STEPS import safe_formula, engine

ctx = SessionContext(session_id="s1"); ctx.put("r1", DF); ctx.bind_step("step1", "r1")
ReferenceResolver(ctx).resolve_value(token)          # core
safe_formula.run_formula(token, steps={"step1": DF}) # AST
engine.resolve_reference(token, step_map, session_id="s1")
safe_formula.parse_call(f"=my_op(data={token})")     # usable as an argument?
```

Baseline when this note was written: core `1c30e03`, core suite 357 passed /
0 failed, app backend 159 passed / 1 failed (the known `test_select_cell`),
frontend 4 passed / 2 failed (stale `vi.mock` stubs, unrelated).
