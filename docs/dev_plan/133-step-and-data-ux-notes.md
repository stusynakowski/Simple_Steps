# 133 — Step and data: UX notes

**Status:** notes (2026-11-13). The owner's list of what isn't working in a
step and its data, with what was found and proposed in the same session.
Nothing in §2–§4 is built. Each item becomes a decision (D-number) or moves
into [126](./126-formula-ui.md) / [130](./130-reference-selection.md) once
the owner settles it.

**The principle behind all of it:** show little; make everything easy to
reach when it's needed. Excel users start by editing cells, not by writing a
formula.

---

## 1. The owner's notes

| # | Note | Where it goes |
|---|---|---|
| N1 | The user is overwhelmed with information. It looks generally nice, but there is too much on screen. | Every item below shows less by default. |
| N2 | In Excel people don't start with the formula: they start by editing cells. Empty steps are editable in the grid, and that is how the step is built: a familiar way to define it. The formula bar shows the syntax being defined as you edit. You start with a single cell and can add columns or rows. | §3 |
| N3 | The data bar expander is disliked. It should not be a full bar. | §2 |
| N4 | Referencing between steps is ambiguous, and so is selection in the UI. | §2, §4 |

---

## 2. The data header (N3, N4)

**Today:** the data sits in a `StepWidget` with a full-width name bar
(`▾ Data` and, at the right, the size and selection note from
`DataOutputGrid`'s `onNoteChange`). The grid below has its own `#` header,
whose corner triangle selects the whole table. So there are two headers, and
nothing on screen shows how to refer to the step.

**Owner's design:** the expander becomes part of the grid's header, and the
header names the reference.

Collapsed:

```
Data  >  /  wf["step name"]  \  size
```

Expanded:

```
Data  v  /  wf["step name"]  \  size
v| # | var0       |
||| 0 | cell value |
```

- **One header, not two.** `Data >` / `Data v` is the expander. It is a tab
  as wide as its text, not a bar across the step.
- **The header is the reference.** `wf["step name"]` refers to the whole
  grid, so clicking it selects the whole table (it takes over the `#`
  corner triangle's job). The reference a step is written with is now
  visible on the step itself.
- **The size** (`4 rows × 2 cols`) sits at the header's right, replacing the
  bar's note.
- **The lineage gutter.** A collapsed column to the left of `#` (the `v|`
  above) hides the reference rows, i.e. which row of each earlier step each
  row came from. It opens only when needed. This is the expander already
  agreed in [126 D8](./126-formula-ui.md) and
  [130 R2](./130-reference-selection.md), placed in the header's column.

**Built 2026-11-13** (`DataOutputGrid.tsx`, `.data-head` in
`OperationColumn.css`), refined with the owner over several passes:

```
▦ ›          │ wf["step"] │          4 rows × 2 cols
```

- **Left:** the Material Symbols `dataset` icon (weight 600) and a caret
  that turns down when the table is open. No outline, no shading.
- **Clicking:** anywhere on the header except the reference folds or
  unfolds the table.
- **Middle:** `wf["step"]`, square and as wide as its text, drawn as a column
  header. A click selects the whole table, or, while writing a formula,
  inserts the reference.
  - Open, it sits in the column headers' grey with vertical lines on each
    side.
  - Folded, it goes dark with the rest of the bar.
- **Right:** the size in grey (`4 rows × 2 cols`).
- **Removed:**
  - the data `StepWidget`'s name bar;
  - the `#` corner triangle, since `wf["step"]` does its job;
  - the selection's description, which is left to the selection's own tab.
- **Folding:** the grid stays mounted, only hidden.
- **Rejected looks:** slanted tab sides, rounded corners, an outlined or
  shaded icon.

**More widgets will join this header, left of the dataset icon** (owner,
2026-11-13). The first is the toggle that opens the reference (lineage)
columns left of `#`; that gutter is not built yet.

---

## 3. Writing an empty step by editing its cell (N2)

The owner's direction from the same session, prototyped in
[Step by Example](https://claude.ai/artifact/QRyc4hfUsixBJDd1Mo5X3W)
(an isolated page, not the app):

1. **An empty step is one cell you can edit**, as in Excel. It is the 1×1
   `empty` frame that core already gives an empty step.
2. **The cell becomes the step's formula.** You write what that one cell
   should be, clicking cells of earlier steps to refer to them, e.g.
   `to_f(p[1].temp_c)`. The formula bar shows the real formula worked out
   from it: `=to_f[mod.map()](wf["p"])`. The kind of reference chooses the
   verb:

   | You refer to | The step | Verb |
   |---|---|---|
   | one cell of an earlier step | one value per row | `map` (or `filter` for a true/false tool) |
   | a whole column (click its header) | all rows into one | `collapse` |
   | nothing, just a value (`7`, `[1, 2]`) | a value | `source` |

   While writing, every row's result shows faded below the cell, with the
   example row picked out.

   **Adding columns and rows (owner, 2026-11-13).** The empty step starts as
   one cell, and the user can add columns or rows to it, as in a sheet. The
   formula bar updates with each edit. Readings to settle:

   | Edit | Possible meaning | What core needs |
   |---|---|---|
   | Values typed down one column (`1`, `2`, `3`) | a literal table: the step is a source of those rows | `=[1, 2, 3]` is **one cell** holding the list. Rows take a second step, `=identity[mod.expand()](wf["a"])` (run 2026-11-13). |
   | Values typed across a row and down (a small table) | a literal table with named columns | Takes **three** steps: `=[{"x": 1, "y": 3}, …]`, then `expand`, then `widen(columns=["x", "y"])`. A dict of lists + `widen` gives one row of lists, not a table. A step allows one shape verb, so one step can't do it. Options: hidden helper steps, or a core ask for a literal-table source (§7 Q7). |
   | A second column whose cell is another call on the same input row (`to_f(p[1].temp_c)` beside `upper(p[1].name)`) | one step with several output columns | A step holds **one** formula. This needs either one formula that yields several columns, or one step per column put side by side with `zip_`. Open (§7 Q6). |
   | A second row in a formula column | another example of the same formula | Must agree with the first example. Otherwise it is a different formula and the step should say so. |
3. **Once a step has run, it locks.** You can inspect it but not edit it.
   Clearing its output and formula is the only way back to editing; that
   also empties the steps that use it.
4. **Clicking a cell shows the formula that made it**: the step's formula,
   and the cell's own call (`to_f(temp_c=38.2) = 100.76`), with the rows it
   came from highlighted in the earlier steps.

**Feasibility:**

| Part | Who | Effort |
|---|---|---|
| The cell's own formula (4) | core `k.cell(step, row)` returns `inputs` with argument, row and values | Ready in core. The app passes only the value today. |
| Where a row came from (2, 4, §2's gutter) | core `k.view()` rows carry `lineage`, e.g. `{'#p': 1}` | Ready in core. Dropped at [`kernels.py:431`](../../src/SIMPLE_STEPS/kernels.py#L431); one field to pass. |
| Cell shorthand to step formula (2) | frontend | New. Core still checks the result when the step is assigned. |
| Locked after a run, Clear to edit (3) | frontend | A rule in the app; core allows any step to be reassigned. |

---

## 4. Ambiguous referencing and selection (N4)

What makes it ambiguous today:

- **The reference isn't shown anywhere.** A step is referred to as
  `wf["name"]`, but the step shows its label in the arrow header and nothing
  in the grid. §2 puts `wf["name"]` on the grid.
- **Two kinds of row number.** Core 1.0.2 numbers each step's rows `0..n-1`
  (`#`) and keeps where each came from separately (`lineage`). A filtered
  step's row `#0` may be row `#1` of the step before it. Without the lineage
  gutter (§2) that can't be seen.
- **The same click means two things.** A click on a cell selects it when
  you're looking, and inserts a reference when you're writing a formula
  elsewhere. Nothing on screen says which mode you're in.
- **Selection lingers.** It stayed after clicking away (fixed 2026-11-13,
  §6).

Proposed direction (for the owner to confirm):

- A selection's tab shows the reference it stands for (`wf["p"][1]`), so
  pointing teaches the notation.
- While writing (§3), clicking another step's cell always inserts its
  reference, and the target cell shows a "copy" cursor. While looking, it
  selects.
- Hovering a row's `#` lights up the rows it came from in earlier steps,
  using `lineage`. The grid gets a highlight, not a button.

---

## 5. Facts (verified by running core 1.0.2, `dbaf4c7`, 2026-11-13)

- `.data` has no `#` columns after `source`, `filter`, `map` or `zip_`, but
  **does** after `expand` (`#a` in front, index `0.0, 0.1, …`). So the `#`
  handling in `engine.values()` is still needed for expanded steps; it is not
  all dead. The reliable source for every step is
  `k.view(name, (start, stop))`, where each row is
  `{'#': 0, 'position': 0, 'state': 'known', 'lineage': {'#p': 1}}`.
  Lineage goes back through every earlier step; a step reached twice gets
  `#p.2`.
- `k.cell(step, row)` returns `lineage` and `inputs`:
  `[{'step': 'sick', 'argument': 'temp_c', 'row': 0, 'values': {'temp_c': 38.2}}]`.
- An expanded row's lineage also names its place in the list it came from:
  `{'#r': 0, '#r.idx': 1}`.
- In the app, `kernels.py` passes on only `id=row["#"]`.
  `/api/data?index=true` and `engine.values()` expect `#` columns, which
  only `expand` still writes. Moving the grid to `k.view()` lineage would make
  them unnecessary (removal to be confirmed).

---

## 6. Done in the same session (2026-11-13)

- The step header's status outline has no bottom bar (`OperationColumn.css`).
- The resources column starts collapsed unless the workflow has resources
  (`ResourceColumn.tsx`).
- The step header's notepad shows only on hover or keyboard focus. It was
  showing whenever a step had notes, and after any click (`OperationColumn.css`).
- Clicking off the grid clears the selection and its inspect tab; only an
  open inspection stays marked (`DataOutputGrid.tsx`).

---

## 7. Open questions

1. ~~N2 is unfinished~~ Settled 2026-11-13: empty steps are edited in the
   grid, starting as one cell; columns and rows can be added (§3).
2. ~~§2: does the selection's description stay in the header?~~ No: the
   header shows only the size; the selection's tab names the selection.
3. §3: how to bind a column whose name differs from the tool's argument
   (the prototype's `text=cols["name"]` is a placeholder), and how to write
   a step with two inputs (zip) from one cell.
4. §3: does Enter run the step, or keep the draft for a separate Run?
5. §5: remove the dead `?index=true` path and the `#` filtering in
   `engine.values()`?
6. §3: a built step with several formula columns. Should it be one formula
   that yields several columns, or hidden steps per column joined with
   `zip_`? Core keeps one formula per step, so this needs a decision, and
   possibly a core ask.
7. §3: a small table typed into an empty step needs three core steps today
   (literal, `expand`, `widen`). Hide the helpers, or ask core for a
   literal-table source (one step, one formula)?
