# 134 — Defining a step from its data grid (step by example)

**Status:** proposed (2026-11-13). Builds on [133 §3](./133-step-and-data-ux-notes.md)
(writing an empty step by editing its cell) and takes it to Excel's level of
interaction. Every "core: works" below was **run** against core 1.0.2
(`dbaf4c7`) on 2026-11-13; the formulas and what came back are in §8.

**Goal:** a user builds a step the way they would build a column in Excel:
type values, write one example cell, drag it down. The formula bar always
shows the formula the grid edits stand for.

---

## 1. The owner's rules

| # | Rule |
|---|---|
| R-A | **Every widget on the data grid maps to a formula in the top bar.** A grid edit is only a way of writing the step's formula. If an edit has no formula, the grid doesn't offer it. |
| R-B | **One formula, one step output.** A step holds one formula. An edit that would need two formulas makes a second step, or is refused with the reason. |
| R-C | **The formula bar describes the selected cell.** Once a step has run, selecting one of its cells shows the call that produced *that cell's value alone* (when a function produced it), as well as the step's formula. |

The rules from 133 still hold: an empty step is the 1×1 `empty` frame; a step
that has run is **locked** until it is cleared; Enter stages and ⌘/Ctrl+Enter
stages and runs ([126 D3](./126-formula-ui.md)); controls go on the selection
popover, and the grid gets marks, not buttons.

---

## 2. Excel's toolbox, mapped to formulas

Every Excel feature for putting data in, or defining a function between cells,
with the formula it would write here. **Core** says whether core accepts that
formula today.

### Putting data in

| G | Excel | Here: the gesture | The formula it writes | Core |
|---|---|---|---|---|
| G1 | Type a value in a cell | Type in the empty step's one cell | `=7`, `="text"` | works |
| G2 | Type values down a column (Enter moves down) | Enter at the last cell adds a row | `=identity[mod.sweep(value=[1, 2, 3])]()` | works in one step. Gives **two equal columns** (`value` and the step's own), §4 C1 |
| G3 | Type a small table (across and down) | Tab adds a column, Enter adds a row | **Three steps** today: `=[{…}, {…}]` → `expand` → `widen`. Or two: `sweep(row=[{…}])` → `widen` | constrained, §3 K1 |
| G4 | Paste a block (from Excel, CSV) | Paste into an empty step | same as G2 or G3 | same as G2/G3 |
| G5 | Fill series (drag `1, 2` to get `3, 4, 5`) | Drag the fill handle on a literal column | `sweep(value=[1, 2, 3, 4, 5])`: the list written out | works. A formula can't compute `range()`: core refuses computed values. Past a limit (say 1,000), offer a tool instead |
| G6 | Insert or delete a row or column | Popover on a literal step | rewrites the literal | works (it's just a new literal) |
| G7 | Paste values (formula to values) | Popover: "Make values" on a ran step | the step becomes a literal of its values (G2/G3) | as G2/G3 |

### Defining a function between cells

| G | Excel | Here: the gesture | The formula it writes | Core |
|---|---|---|---|---|
| G8 | `=B2*9/5+32`: a formula using another cell | Type `=` in the empty cell, pick a tool, click a cell in an earlier step | **One row, the example:** `=to_f[mod.map()](wf["p"][1])` | works: one row out |
| G9 | Drag the fill handle down | Drag the example cell's handle to row *k* | `=to_f[mod.map()](wf["p"][0:k])` | works |
| G10 | Double-click the fill handle (fill to the end of the data) | Double-click the handle | `=to_f[mod.map()](wf["p"])`: **one function, the whole column** | works |
| G11 | Column name differs from the argument (`a` reads `temp_c`) | Clicking a cell binds that column to the argument being written | `=add[mod.map()](wf["p"], a=wf["p"][cols["temp_c"]], b=1)` | works. Answers 133 Q3 |
| G12 | Two inputs (`=A2+C2`) from different steps | Click a cell in each | `=add[mod.map()](wf["p"], a=wf["p"][cols["temp_c"]], b=wf["m"])` | works when the two steps share lineage. Not tried for unrelated steps (§7 Q4) |
| G13 | Absolute reference `$B$1` (F4 toggles) | F4 on a reference while writing; it is drawn pinned | `b=wf["p"][0][cols["temp_c"]]`: the same cell for every row | works. `k.cell` reports it wrongly, §4 C3 |
| G14 | `=SUM(A2:A10)`: a range | Click a column header while writing | `=total[mod.collapse()](wf["m"])` | works |
| G15 | `=IF(…)` keeping rows / AutoFilter | A true/false tool chooses `filter` | `=is_hot[mod.filter()](wf["p"])` | works |
| G16 | Spill (`=SEQUENCE()`, dynamic arrays) | A tool returning a list | `=tool[mod.expand()](wf["p"])` | works |
| G17 | Sort, Remove duplicates, Text to columns, PivotTable | Popover on a column of a ran step; each makes a **new step** | `sort`, `distinct`, `widen`, `group` / `collapse(by=…)` | verbs exist; these formulas not run yet |
| G18 | Insert Function / autocomplete | The existing tool pickers | `tool[mod.map()](…)` | built ([126](./126-formula-ui.md) F1, F2) |
| G19 | Named ranges | Step names | `wf["name"]` | built |
| G20 | Show the formula of the selected cell | Select a cell (R-C) | §5 | partly in core, §4 C2–C4 |
| G21 | Trace precedents / dependents | Hover a cell: its input cells light up in earlier steps | none (it's a view) | `k.cell` inputs and lineage, [126](./126-formula-ui.md) F15 |
| G22 | Undo | ⌘Z in a draft step | the previous formula text | app only ([126](./126-formula-ui.md) R13.4) |
| G23 | Flash Fill (type examples, it guesses) | Type 2–3 output values beside a step; the agent proposes a tool | a proposal, applied on a click | later, [128](./weekend_developments/128-agent-workflow-builder.md) |

### Not offered, under R-B

| Excel | Why not | What the grid offers instead |
|---|---|---|
| Overwrite one computed cell | A second formula inside one step | "Make values" (G7), then edit; or a new step |
| A different formula in some rows | Same | A filter step and two steps, or a tool with a condition |
| A second computed column in the same step | Same | A new step beside it (`zip_` if they should be one table) — 133 Q6 |
| Data validation, conditional formatting, charts | Not a step output | Charts are [131](./weekend_developments/131-explore-widgets.md) |

---

## 3. What the rules constrain

**K1 — A typed table is three steps.** Core allows one shape verb per step and
refuses a literal as a verb's input (`expand([…])`: *the input must be a step
reference*), so a 2×2 typed table can't be one formula. Options:

| Option | Cost | R-B |
|---|---|---|
| a. Ask core for a literal-table source: one formula, many rows and columns | A core change; nothing hidden | holds |
| b. Hide the helper steps behind the step the user typed | Steps the user didn't write; they leak into references, export and lineage | bent |
| c. Typed tables are one column only (G2) until core has (a) | Smallest | holds |

**Recommendation: c now, a as a core ask (C5).** No hidden steps.

**K2 — Writing mode and looking mode use the same marks.** A click selects a
cell when you're looking and inserts a reference when you're writing
(133 §4). The fill handle already exists (the dot on the selection's bottom
right, which resizes the selection). Proposed: in a **draft** step the dot
fills (G9, G10); in a ran step it resizes the selection, as today. The draft
step is drawn as being written (a writing cursor in its cell, its formula bar
active), so what the dot does follows from what is on screen.

**K3 — A step reads its input rows by position.** The example is "row 1", so
G8's draft is `wf["p"][1]`. If `p` changes, row 1 is a different row: amber,
as in [126](./126-formula-ui.md) R13.6. G10's `wf["p"]` has no such problem,
which is one more reason to fill to the whole column by default.

---

## 4. Core gaps found (to record in `../core-proposals/008-core-changes.md`)

Each was seen in a run (§8). None blocks P1–P3; C2–C4 decide how good R-C
looks.

| C | Gap | Seen | Needed for |
|---|---|---|---|
| C1 | `sweep` with one parameter gives the values twice: the parameter column and the step's own | `sweep(value=["a","b","c"])` → `value` and `swn`, equal | G2 shows one column |
| C2 | `k.cell` on a map whose argument is a **column pick** gives `values: {}`, `row: None` and every row (`rows: [0, 1]`), not the row's value | `add(…, a=wf["p3"][cols["temp_c"]])` | R-C for G11, G12 |
| C3 | `k.cell` reports an **absolute pick** argument as `missing`: *'p3' has no lineage #p to test*, although the step ran and the value is right | `b=wf["p3"][0][cols["temp_c"]]` | R-C for G13 |
| C4 | `k.cell` on a `collapse` lists the lineage column `#p` as an argument | `total[mod.collapse()](wf["m1"])` | R-C for G14 |
| C5 | No one-step literal table (K1) | `expand([…])` refused; `sweep(…) + widen` is two shape verbs | G3, G4, G7 |
| C6 | `widen(column="swr0")` on a sweep's own column raises `TypeError: typing.Any cannot be used with isinstance()` | §8 | a crash, not a refusal |

Until C2 and C3 are fixed, the app can fill the gap itself (P1): it knows
the binding from the formula and reads the value from the source step at the
row given by lineage. That code is marked as waiting on core and deleted
when core fixes it.

---

## 5. The formula bar for a selected cell (R-C)

Two lines. The first never changes within a step; the second follows the
selection.

```
f(x) = to_f[mod.map()](wf["p"])                      ← the step: one formula
[1]  = to_f(temp_c=wf["p"][1][cols["temp_c"]])  → 100.76   ← this cell alone
```

The second line uses **references, as Excel does** (`=B2*9/5+32`, not
`=38.2*9/5+32`). Hovering a reference shows its value and outlines the cell it
reads, dashed in that step's colour ([126 D6](./126-formula-ui.md)).

**It is a real formula.** `=to_f[mod.source()](temp_c=wf["p3"][1][cols["temp_c"]])`
staged on its own gives `100.76` (run, §8). So R-C can be tested: stage each
cell's formula and compare with the cell. "Copy" on the line copies this
valid form; the line shows the short form above (Q2).

What the second line says, by verb:

| The step | The selected cell's line | From |
|---|---|---|
| a literal (`=7`, `sweep`) | the value itself: `= 7`, `= "b"` | no function: R-C's "assuming it is a function" |
| `map` | `tool(arg=wf["p"][r][cols["c"]], …) → value` | `k.cell` inputs (C2, C3 until fixed) |
| `filter` | `tool(…) → True`: the row was kept; the cell is the input's `wf["p"][r]` | `k.cell` inputs, lineage |
| `collapse` | `total(wf["m"][cols["m"]]) → 150.76`: the range, as `SUM(A2:A10)` | inputs `row_numbers` (C4) |
| `expand` | `tool(wf["p"][r])[i]`: item *i* of row *r*'s list | lineage `#p`, `#p.idx` |
| `sweep` with a tool | `tool(a=1, b=20) → 21`: the swept values on that row | the row's swept columns |
| a pick or `zip_` | the reference it copies: `wf["p"][r][cols["c"]]` | lineage |
| a failed cell | the call, and core's error in place of the value | `k.cell` |

---

## 6. Phases

Each phase ships on its own and is confirmed with the owner before the next
([context.md](../context.md): core-driven changes confirmed piece by piece).
P1 comes first because it works on every existing step, writes nothing, and
is the base the writing phases show their results in.

| Phase | What | Where | Done when |
|---|---|---|---|
| **P0** Plumbing | Pass `k.cell` `inputs` and row `lineage` to the client (dropped at `kernels.py:431`, 133 §3). One function builds a cell's formula from them: printing, not parsing | `src/SIMPLE_STEPS/kernels.py`, `operation_formula.py` (thin), `/api/cell` | For every cell of every shipped example (`examples/runme.py`), staging the cell formula gives the cell's value |
| **P1** Formula bar shows the cell (R-C) | §5's second line; references as chips; hover shows the value and outlines the cell | `StepToolbar.tsx`, `FormulaEditor.tsx`, `DataOutputGrid.tsx` | Select any cell: the line is right for each verb in §5's table |
| **P2** Typing data in (G1, G2, G4 one column, G5, G6) | Empty cell editable; Enter adds a row; paste a column; fill series. The formula bar rewrites with each edit. Enter stages | `DataOutputGrid.tsx`, `useWorkflow.ts` | Typing `1⏎2⏎3⏎` shows `sweep(value=[1, 2, 3])` and stages one step of 3 rows |
| **P3** An example cell (G8, G11, G12, G13) | `=` in an empty cell starts writing; clicking cells inserts references (relative; F4 pins); the step formula is the one-row form; the other rows show faded as a preview | `DataOutputGrid.tsx`, `utils/selection.ts`, `FormulaEditor.tsx` | Writing `to_f(` and clicking `p` row 1 gives `=to_f[mod.map()](wf["p"][1])` and its value |
| **P4** Fill (G9, G10, G14) | Draft step: the dot fills to row *k*; double-click fills to the whole column; clicking a column header while writing gives `collapse` | `DataOutputGrid.tsx` (the handle at `:308`) | Double-click turns `wf["p"][1]` into `wf["p"]`; the formula bar shows it before Enter |
| **P5** Locked, values, and the popover (G7, G15–G17, G22) | A ran step locks; Clear to edit; "Make values"; sort, distinct, widen, group from a column's popover, each a new step; undo in a draft | `SelectionInspector.tsx`, `OperationColumn.tsx`, `useWorkflow.ts` | Each popover action writes a new step whose formula is in the bar |
| **P6** Later | Typed tables (G3) once C5 lands; Flash Fill (G23) through the agent | — | — |

After each frontend phase: `python -m SIMPLE_STEPS.build_frontend`, then
`python scripts/preflight.py --fix`.

---

## 7. Decisions for the owner

1. **K1, typed tables:** one column only until core has a literal table (c,
   recommended), or hidden helper steps (b)?
2. **The cell line (§5):** short form `to_f(temp_c=…)` shown with the valid
   `to_f[mod.source()](…)` on copy (recommended), or always the valid form?
3. **Default fill:** should finishing an example (Enter) apply it to the whole
   column straight away (G10, recommended: avoids K3's row-position warning),
   or stage the one-row draft and wait for a fill?
4. **G12, two steps that don't share rows:** refuse with core's reason, or
   offer `zip_` / `join` first? Needs a run with unrelated steps.
5. **K2:** in a draft step, the selection's dot fills; in a ran step it
   resizes. Agreed?
6. **C1–C6:** raise them as core asks, one at a time, as for earlier ones?

---

## 8. Evidence (core 1.0.2 `dbaf4c7`, 2026-11-13)

Tools: `to_f(temp_c)`, `add(a, b)`, `upper(name)`, in a `Catalog([...])` and a
`Kernel`, each formula through `formula(text)`, then `k.run`.

| Formula | Result |
|---|---|
| `=identity[mod.sweep(value=["a","b","c"])]()` | columns `value`, `swn`: both `a, b, c` (C1) |
| `=[{"name":"a","temp_c":10.0}, …]` → `identity[mod.expand()]` → `identity[mod.widen(columns=["name","temp_c"])]` | 3 steps; `name`, `temp_c` as rows |
| `=identity[mod.expand(), mod.widen(…)](wf["p"])` | refused: *2 shape verbs in one step* |
| `=identity[mod.expand()]([{…}, {…}])` | refused: *the input must be a step reference* |
| `=identity[mod.sweep(row=[{…}]), mod.widen(column="row")]()` | refused: *2 shape verbs* |
| `=to_f[mod.map()](wf["p3"][1])` | 1 row, `100.76` |
| `=to_f[mod.map()](wf["p3"][0:1])` | 1 row, `50.0` |
| `=to_f[mod.map()](wf["p3"])` | `50.0, 100.76`. `k.cell("m1", 1)["inputs"]` = `[{argument: temp_c, row: 1, values: {temp_c: 38.2}}]` |
| `=add[mod.map()](wf["p3"], a=wf["p3"][cols["temp_c"]], b=1)` | `11.0, 39.2` |
| `=add[mod.map()](wf["p3"], a=wf["p3"][cols["temp_c"]], b=wf["m1"])` | `60.0, 138.96` |
| `=add[mod.map()](wf["z"], a=wf["z"][cols["temp_c"]], b=wf["z"][cols["m1"]])` | `60.0, 138.96`; `k.cell` inputs: `values: {}`, `row: None` (C2) |
| `=add[mod.map()](wf["p3"], a=…, b=wf["p3"][0][cols["temp_c"]])` | `20.0, 48.2` (right); `k.cell` says `b` is `missing` (C3) |
| `=add[mod.map()](wf["z"], a=cols["temp_c"], …)` | refused: *a Cols isn't a literal* (write `wf["z"][cols["temp_c"]]`) |
| `=total[mod.collapse()](wf["m1"])` | `150.76`; `k.cell` inputs include argument `#p` (C4) |
| `=to_f[mod.source()](temp_c=wf["p3"][1][cols["temp_c"]])` | `100.76`: a cell's formula, run on its own |
| `=identity[mod.widen(column="swr0")](wf["swr0"])` | `TypeError: typing.Any cannot be used with isinstance()` (C6) |
| `=to_f(temp_c=10.0)`, `=to_f[mod.map()](10.0)` | refused; `=to_f[mod.source()](temp_c=10.0)` gives `50.0` |
