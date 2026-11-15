# 135 — When a step's cells can be edited: the rules

**Status:** proposed (2026-11-15). Refines [134](./134-step-by-example-grid.md)
for four abilities the owner asked for. Every "core: works" was **run** against
core 1.0.2 (`dbaf4c7`) on 2026-11-15; the evidence is in §8.

**The four abilities:**

1. Easy data entry in a step's cells.
2. Easy extension of columns, and naming them.
3. Easy extension of rows, for more data.
4. Easy augmentation with a tool call: on one row first, then the same
   operation across every row (mapping).

**The principle they must keep:**
[one step, one expression](../design_principles/one_step_one_expression.md).
A cell edit is only a way of writing the step's expression, never a value
stored beside it (134 R-A, R-B).

---

## 1. The rule in one line

> **You can type into a cell exactly when the step's expression *is* its
> values. Everywhere else, typing in a cell writes a new expression.**

So a cell can be in one of three modes, decided by what kind of step it
belongs to:

| Step kind | Its expression | What typing in a cell does | Mode |
|---|---|---|---|
| **Empty** (1×1 `empty`) | none | starts the step: a value, or `=` to call a tool | **write** |
| **Data step** (a literal table) | `table[mod.source()](data={…})` | edits that value **inside** the expression | **edit data** |
| **Computed step** (a tool, a verb, a combine) | `tool[mod.…](wf["…"], …)` | nothing; the cells are read-only | **look** |

The step's mode is visible without buttons: a data step's cells look editable
(a text cursor on hover, as in a spreadsheet), and a computed step's cells
don't. See the [UI rule](../design_principles/intuitive_tabular_ui_design_notes.md):
marks, not chrome.

---

## 2. The rules

| # | Rule | Why |
|---|---|---|
| **E1** | **Only an empty step or a data step takes typed values.** A computed step's cells are never edited in place | An edited computed cell would no longer be what the expression produces (R-B) |
| **E2** | **Every edit rewrites the step's expression, and the formula bar shows it as you type** | The expression is the step; the grid is a way of writing it (R-A) |
| **E3** | **A data step is one expression, whatever its size**: `table[mod.source()](data={"col": [...], …})` | One step, not three hidden ones (134 K1, resolved in §4) |
| **E4** | **Adding a row or a column to a data step edits its data.** A new column gets a name at once (`column2`, renamed in place in the header) | Names are part of the expression; no unnamed columns |
| **E5** | **Calling a tool always makes a new step** to the right, reading the step you started from. It never adds a computed column to a data step | Mixing typed and computed columns would put two expressions in one step (R-B) |
| **E6** | **A tool call starts on one row, the example, and extends to all rows by mapping.** One row is `wf["p"][r]`; every row is `wf["p"]` | One gesture from example to column, as Excel's fill handle |
| **E7** | **A step that has run is locked** until cleared (133). A data step is the exception: editing its values just re-stages it, and steps that read it go stale | A data step has nothing to recompute; its values are its expression |
| **E8** | **Turning a computed step into data is explicit**: "Make values" on the popover replaces its expression with a data expression holding its current values. Then it can be edited | The change from computed to typed is visible and can be undone |
| **E9** | **Controls live on the selection popover**, not as grid buttons. Keys work as in a spreadsheet: Enter moves down, Tab moves right | The [UI rule](../design_principles/intuitive_tabular_ui_design_notes.md), and familiar gestures |

---

## 2a. Augment, clear, or a new step

Every change to a workflow is one of three moves:

| Move | What happens | The step's name and position | Steps that read it |
|---|---|---|---|
| **Augment** | this step's expression is edited in place | kept | go stale, re-run on demand |
| **Clear, then write** | the expression and output are removed (back to 1×1 `empty`), then a new expression is written in its place | kept | go stale; invalid until the new one runs, if they no longer fit |
| **New step** | a step is added to the right, reading this one | this step untouched | unaffected |

### The test: three questions, in order

```text
1. Does the change need a second expression in this step?
   (a computed column in a data step, a typed column in a computed step,
    a different tool for some rows, a sort or filter of this step's output)
        yes → NEW STEP

2. Is it a different expression, rather than the same one refined?
   (data ↔ computed, another tool, another shape verb, another input step)
        yes → NEW STEP to keep this result, or CLEAR to replace it

3. Otherwise it refines this expression. Is the step open to editing?
   - empty or a draft (never run)                → AUGMENT
   - a data step (its values are its expression) → AUGMENT
   - a ran computed step, and the change only extends it,
     leaving every existing cell as it is (fill to more rows) → AUGMENT
   - a ran computed step, and the change alters existing cells
     (an argument, a modifier, the column bound)  → CLEAR, then write
```

**The principle behind question 3:** a ran computed step can grow but not
change. Anything that would change a value already on screen goes through
Clear, so a result never changes under the user without an explicit step
back (133's lock). A data step is the exception, because its values *are*
its expression: editing a value is the expression changing, visibly.

**Choosing between Clear and a new step** (question 2) is the user's intent,
and the popover offers both:

- **Clear** when this step was wrong and what reads it should read the
  replacement. Its name and references are kept.
- **New step** when this result is right and the next idea builds on it.

### The rules, by change

| The change | Empty / draft | Data step (`table(…)`) | Computed step, ran |
|---|---|---|---|
| Type or edit a value | augment | **augment** | **new step** (or Make values, then augment) |
| Add a row | augment | **augment** | new step |
| Add a typed column | augment | **augment** | new step, then `zip_` |
| Rename a column | augment | **augment** | new step (`mod.rename`) |
| Delete a row or column | augment | **augment** | new step (`slice` / `drop`) |
| Extend the example to more rows (fill, `wf["p"][1]` → `wf["p"]`) | augment | — | **augment**: existing cells unchanged |
| Narrow it to fewer rows | augment | — | clear, or a new step that filters |
| Change an argument, a modifier or the bound column | augment | — | **clear**, then write |
| Change the tool or the input step | augment | — | new step, or clear |
| Call a tool on this step's data | new step | **new step** | **new step** |
| Sort, filter, distinct, group | new step | new step | new step |
| Make values (computed → data) | — | — | **in place**, explicit on the popover: every value kept, so nothing on screen changes |
| Rename the step | anytime: a rename is not a recompute, and references follow | anytime | anytime |

### What the user sees

- **Can augment:** the cells or the formula bar take input directly (a text
  cursor on a data step's cells; the fill dot on a ran step's example).
- **Must clear:** typing into a locked cell, or into the formula bar of a ran
  computed step, opens the popover with **Clear and edit** and **New step
  from here**, and a one-line reason ("this changes values already
  computed"). Nothing is silently refused.
- **New step:** the change is staged in the empty step to the right, its
  formula in the bar, so the user sees where it went.

---

## 3. The four abilities, as gestures and expressions

### 3.1 Data entry

| Gesture | Expression written |
|---|---|
| Type `7` into an empty step | `=7` (a one-cell value) |
| Type `a`, Enter, `b`, Enter, `c` | `=table[mod.source()](data={"value": ["a", "b", "c"]})` |
| Paste a block from Excel or CSV into an empty step | `=table[mod.source()](data={"name": [...], "temp_c": [...]})`, header row as column names |
| Edit any cell of a data step | the same expression with that value changed |

A single value stays the literal `=7`. The moment a second cell exists (Enter
or Tab), the step becomes a `table`, so there is never a jump between two
syntaxes past that point.

### 3.2 Columns: extend and name

| Gesture | Expression change |
|---|---|
| Tab past the last column | adds `"column2": [None, None, …]` and puts the cursor in its header |
| Type in a column header | renames the key: `"temp_c"` |
| Popover on a column: insert left / right, delete | adds or removes the key |
| Popover on a column of a **computed** step: rename | a **new step**: `identity[mod.rename(columns={…})](wf["…"])` (E5) |

A header name must be a valid Python identifier, and different from the other
columns. An invalid name is refused in the header itself, with the reason.

### 3.3 Rows: extend

| Gesture | Expression change |
|---|---|
| Enter on the last row | every column's list gets one more item, `None` |
| Paste below the last row | the lists grow by the pasted rows |
| Popover on a row: insert above / below, delete | an item added or removed from every list |
| Fill series (drag `1, 2` down) | the values written out (`[1, 2, 3, 4, 5]`): a formula can't compute `range()`. Past ~1,000 rows, offer a tool instead |

### 3.4 Augment with a tool: one row, then every row

Starting from a data step `p` (or any step):

| Gesture | Expression of the **new** step |
|---|---|
| In the empty step to the right, type `=to_f(` and click `p`'s `temp_c` cell in row 1 | `=to_f[mod.map()](wf["p"][1])`: **one row**, the example, with its value |
| Drag the example's fill handle to row *k* | `=to_f[mod.map()](wf["p"][0:k])` |
| Double-click the fill handle | `=to_f[mod.map()](wf["p"])`: **every row**, one expression |
| Column name differs from the argument | `=to_f[mod.map()](wf["p"], temp_c=wf["p"][cols["reading"]])` |

The other rows show faded while only the example exists, as a preview of what
mapping would give.

**Recommendation (134 Q3):** pressing Enter on a finished example maps it to
every row straight away, and the one-row form is only a draft while
writing. A one-row step reads by position, so it goes amber when `p`
changes (134 K3), while the whole-step form has no such problem.

**The result is a new step holding only the tool's output.** To see the
inputs and outputs side by side as one table, the popover offers
`zip_(wf["p"], wf["f"])`, which is another step. That keeps every step one
expression.

---

## 4. Typed tables in one step: resolved without core

134 K1 found that a typed table took **three** steps
(`[{…}]` → `expand` → `widen`) and proposed asking core for a literal table
(C5). Run on 2026-11-15, there is a smaller answer:

- Core reads a literal as **one cell**, whatever its shape: `={"name": [...]}`
  is a 1×1 frame holding a dict. That's correct, and should stay.
- A **source tool whose parameter takes a dict or a list** gives the whole
  table in one step, readably:
  `table[mod.source()](data={"name": ["a", "b"], "temp_c": [10.0, 38.2]})`
  → 2 rows × 2 columns. Mapping over one row or every row of it works.
- The app already has `to_rows` (`operations.py`), but it takes a **JSON
  string**, so the formula bar shows escaped JSON
  (`data="{\"name\": [\"a\", …]}"`).

**Proposed:** a system tool `table(data: dict | list) -> DataFrame`
(column → values, or a list of records), or widen `to_rows` to accept a dict
or list as well as a string. This is an app change in `operations.py`, and
**C5 is dropped from the core asks**. The owner chooses the name (Q1).

---

## 5. What is never offered

| Request | Why not (rule) | Offered instead |
|---|---|---|
| Overwrite one computed cell | E1 | "Make values" (E8), then edit; or a new step |
| Add a typed column to a computed step | E5 | A data step, then `zip_` |
| Add a computed column to a data step | E5 | A new step, then `zip_` if wanted as one table |
| A different tool for some rows | R-B | A filter step and two steps, or a tool with a condition |
| Compute a value in the formula bar (`range(100)`, `len(…)`) | the grammar runs no Python | A catalog tool |

---

## 6. Phases

These replace 134 P2 and extend P3–P5; each ships alone and is confirmed by
the owner first.

| Phase | What | Where | Done when |
|---|---|---|---|
| **A** `table` source | The system tool of §4 | `src/SIMPLE_STEPS/operations.py` | `table[mod.source()](data={…})` stages one step of the typed table |
| **B** Data entry and rows | Type into empty or data steps; Enter adds a row; paste; edits rewrite the expression live (E1–E3, §3.1, §3.3) | `DataOutputGrid.tsx`, `useWorkflow.ts` | Typing `a⏎b⏎c` shows the `table` expression and stages one 3-row step |
| **C** Columns | Tab adds a column; header renames in place; popover insert/delete (E4, §3.2) | `DataOutputGrid.tsx`, `SelectionInspector.tsx` | A 2×2 table typed by keyboard alone, with named headers |
| **D** One row → every row | 134 P3–P4: `=` starts an example; Enter maps to all rows (E5, E6, §3.4) | `DataOutputGrid.tsx`, `FormulaEditor.tsx` | Writing `to_f(` and clicking row 1 gives the one-row draft; Enter gives `wf["p"]` |
| **E** Locks and Make values | E7, E8 | `OperationColumn.tsx`, `SelectionInspector.tsx` | A ran computed step is read-only; "Make values" turns it into a data step |

After each frontend phase: `python -m SIMPLE_STEPS.build_frontend`, then
`python scripts/preflight.py --fix`.

---

## 7. Decisions for the owner

1. **The table tool's name:** a new `table`, or widen the existing `to_rows`?
2. **A single value:** keep `=7` for one cell (recommended), or always write
   `table(…)` from the first keystroke?
3. **Enter on an example:** map to every row at once (recommended), or stage
   the one-row draft and wait for a fill (134 Q3)?
4. **E7:** a data step stays editable after it has run (recommended), or locks
   like every other step?
5. **New column's empty cells:** `None` (recommended), or `""`?
6. **§2a, extending a ran computed step:** filling it to more rows is an
   augment, since existing cells don't change (recommended), or does every
   change to a ran computed step need Clear, as 133's lock says today?
7. **§2a, a ran computed step's formula bar:** typing in it offers Clear and
   edit / New step from here (recommended), or is the bar read-only until
   cleared?

---

## 8. Evidence (core 1.0.2 `dbaf4c7`, 2026-11-15)

Each formula through `formula(text)`, assigned in a `Kernel`, then `k.run`.

| Formula | Result |
|---|---|
| `=[1, 2, 3]` | 1×1: one cell holding the list |
| `={"name": ["a", "b"], "temp_c": [10.0, 38.2]}` | 1×1: one cell holding the dict |
| `=[{"name": "a", "temp_c": 10.0}, {…}]` | 1×1: one cell holding the list |
| `=identity[mod.sweep(value=[1, 2, 3])]()` | 3 rows, columns `value` and the step's own, equal (134 C1) |
| `[{…}]` → `identity[mod.expand()]` → `identity[mod.widen(columns=["name","temp_c"])]` | 2×2 table, in **three** steps |
| `=to_rows[mod.source()](data={…})` (app tool, `data: str`) | refused: *declares data: str, but it is bound to … (dict)* |
| `=to_rows[mod.source()](data='{"name": […], …}')` | 2×2 table; prints as escaped JSON |
| `=table[mod.source()](data={"name": ["a","b"], "temp_c": [10.0, 38.2]})` (probe tool, `data: dict \| list`) | **2×2 table, one step**; prints as written |
| same, with `data=[{…}, {…}]` | 2×2 table |
| `=to_f[mod.map()](wf["p"][1])` on that table | 1 row: `100.76` |
| `=to_f[mod.map()](wf["p"])` | 2 rows: `50.0, 100.76` (only the tool's output column) |
| `=identity[mod.rename(columns={"sw1": "reading"})](wf["sw1"])` | renamed, as a new step |
