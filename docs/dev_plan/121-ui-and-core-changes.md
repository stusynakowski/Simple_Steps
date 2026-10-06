# 121 — What to change: the UI, core, and the app backend

> Status: proposed, 2026-10-05. Core pinned at `d8b6979`. Builds on
> [`120-literals-and-references.md`](./120-literals-and-references.md), which
> sets the rule this document implements: **a reference is `wf["<step>"]`;
> everything else is a literal.** Every "today" below was observed in the
> running app or by running core, not read from code.

## Summary

| # | Where | Change | Why |
|---|---|---|---|
| U1 | UI | One reference syntax, built from the step's **name** | Five syntaxes today; new steps produce references that silently become text |
| U2 | UI | Click / shift-click / ⌘-click writes a **select step** for columns, rows or cells; a whole step inserts `wf["…"]` | You can't select ranges today |
| U3 | UI | Insert only the reference, at the cursor | Today the UI adds `data=`, which most tools reject |
| U4 | UI | Show references as coloured chips; drop the banner and ⚡ markers | Wiring mode is noisy |
| U5 | UI | The formula bar grows with its content | Fixed at 28px; long formulas scroll sideways |
| U6 | UI | Remove the formula text repeated in staged cells | Every cell shows "(running) ↳ scale[mod(na…" |
| U7 | UI | Show the saved formula as-is; never rebuild it | Reopened formulas change (`over=readings` → `over="readings"`) |
| U8 | UI | The data view shows columns new relative to the step it **reads** | `grid_search` hides its own result |
| U9 | UI | Orchestration dropdown edits the formula's `[…]` stack | It writes a separate `_orchestrator` key today |
| C1–C11 | core | Listed in §3 | |
| A1–A5 | app backend | Listed in §4 | |

---

## 1. Referencing UI

### 1.1 What happens today

Built a two-step workflow, focused step 2's formula bar, typed `=scale(n=`,
and clicked the `n` column of step 1.

| Problem | Seen |
|---|---|
| **Five syntaxes** for the same thing, depending on where you click | `step-000["n"]`, `step-000["n"][2]`, `step-000[row=2]` (grid in wiring mode); `step-000.n`, `step-000[row=2, col=n]` (the picker and a step's own grid) |
| **Internal ids, not names** | the click inserted `step-000["n"]`; the step is called "Step 0" |
| **New steps' references silently become text** | new steps get ids like `step-k3j2h1a` (`genId`). A hyphen isn't valid in a name, so the adapter doesn't see a reference: `=scale(n=step-k3j2h1a["n"])` ran **once on the literal string** and returned **200 OK** |
| **The UI adds `data=`** | inside parentheses with no parameter name, the injector prepends `data=`: `scale() takes no argument 'data'` |
| **No ranges** | one column, one row or one cell per click |
| **Noise** | a yellow instruction banner that overflows the column, a ⚡ on every row number and header, a dashed outline, a "wiring active" footer |

Where it lives:

| File | What |
|---|---|
| `components/DataOutputGrid.tsx` ~115–117 | the three wiring tokens |
| `components/DataOutputGrid.tsx` ~249, ~465 | the banner and the "wiring active" footer |
| `components/PreviousStepDataPicker.tsx` ~53–60 | the picker's dot and `[row=, col=]` tokens |
| `components/OperationColumn.tsx` `handlePickerTokenSelect`, own-grid `onCellClick` | a third copy of the tokens, and the `data=` prefix |
| `context/StepWiringContext.tsx` `injectReference` ~117–128 | the `data=` prefix |
| `hooks/useWorkflow.ts` `genId` | hyphenated step ids |

### 1.2 Selecting part of a step: a select step

**A reference is always a whole step, `wf["readings"]`.** Narrowing it to
some columns or rows is an operation, `select`, written as a step of its
own. A select step takes a step in and gives the chosen part out; later
steps read it with `wf["…"]` like any other step.

| Select | Gesture | Produces |
|---|---|---|
| a whole step | click the step's `#` corner, or its title | `wf["readings"]`, inserted at the cursor; no select step |
| a column | click a column header | `=identity[mod.select(columns=["n"])](wf["readings"])` |
| several columns | ⌘/Ctrl-click headers, or shift-click a range | `=identity[mod.select(columns=["city", "n"])](wf["readings"])` |
| a range of rows | shift-click row numbers | `=identity[mod.slice(start=1, stop=4)](wf["readings"])` |
| scattered rows | ⌘/Ctrl-click row numbers | `=identity[mod.slice(at=[0, 3])](wf["readings"])` |
| a cell, or a block of cells | click a cell, or drag across cells | **today:** a `slice` step, then a `select` step. **With C7:** one step, `=identity[mod.select(rows=[2], columns=["n"])](wf["readings"])` |

Each row up to the last was run in core: as its own step, `select` and
`slice` give the expected grid. Rows and columns can't go in **one** step
today, because core allows one shape verb per step: *"2 shape verbs in one
step (slice, select); at most one is allowed. Split them into separate steps
so every shape change keeps a cell address you can re-drive."* Ask C7 is a
single `select` that takes both.

Two ways a selection is made:

1. **In the select step itself.** Focus a step whose formula is empty (or
   is already a select) and pick from an earlier step: the picks write that
   step's formula. Picking more updates it.
2. **While writing another step's formula.** Picking a whole step inserts
   `wf["…"]` at the cursor. Picking columns or rows **adds a select step
   just before the current one** (named after the source and the selection,
   e.g. `readings_n`, editable) and inserts `wf["readings_n"]` at the
   cursor. Picking more updates that select step. The new step is an
   ordinary, visible step; nothing is hidden inside the formula.

Rules:

- **Rows are positions**, starting at 0 (the grid shows 1-based numbers;
  the formula doesn't). `start`/`stop` are half-open, like Python:
  `start=1, stop=4` is rows 1, 2 and 3.
- **Names, not ids.** `wf["…"]` takes any string, so spaces are fine:
  `wf["Step 0"]`. Renaming a step rewrites its references (REQ-REF-012
  in 120).
- **Only earlier steps are selectable.** Later steps aren't highlighted and
  don't respond.
- **A select step can't be written inline** as another call's input
  (`=scale[mod.map()](identity[mod.select(…)](wf["readings"]))`). That needs
  a call inside a call, core's planned P0. Today core doesn't refuse it: it
  treats the inner operation as plain data and returns `{'value': [None]}`
  with status *completed* (ask C11). The formula must reject it.
- **A value from another step as a keyword argument** (`weight=wf["params"]`)
  is still core's P5 (C8). The formula shows that error rather than guessing.

Why a select step rather than selection syntax on references
(`wf["readings"]["n"]`, as an earlier draft of this document proposed):

- **It works in core today** for columns and for rows, with no new reference
  grammar.
- **It follows core's rule** that each step changes shape at most once, so
  every cell keeps an address that can be re-run.
- **It's visible.** A reader sees what a later step reads by looking at the
  workflow, not by parsing a subscript.

The cost is more steps. The UI can keep that tidy by drawing select steps
narrow, or grouped with the step that reads them.

The app already has `select` as a palette operation
(`=select(over=readings, columns=[…])`, from `grid_runner`'s verb
operations). The canonical form above replaces it, per 120.

### 1.3 Inserting

- Insert **only the reference**, at the cursor, replacing any selected text.
  Never add a parameter name.
- If the call has no input yet (`=scale[mod.map()](|)`), the reference goes
  there. If the cursor is after `weight=`, it goes there.
- Esc ends selecting.

### 1.4 How it should look

- **References are chips** in the formula bar: a Monaco inline decoration
  in the source step's colour, showing the text as typed (`wf["readings_n"]`).
  Hovering a chip shows *readings_n · select n from readings · 4 rows*, and
  highlights the selection in the source grid.
- **Selecting needs no instructions on screen.** Eligible earlier steps get a
  thin outline in their colour while a formula bar has focus. Hovering a
  header, row number or cell previews what a click would select, in the same
  colour. No banner, no ⚡ markers, no footer.
- **The selection stays visible** in the source grid while the select step
  is focused, so you can see what it takes.

### 1.5 Staged cells (U6)

`hooks/useStagedPreview.ts` (~63, ~178) fills each pending cell with
"(running) ↳ <formula>". Show an empty cell with a spinner (running), or a
dot (queued). The formula is already in the formula bar.

---

## 2. The formula bar (U5)

**Today:** `components/FormulaEditor.tsx` fixes the editor at
`height="28px"` with `wordWrap: 'off'` (~205, ~229). Measured: 360 × 28px
with a 160-character formula; the start of the formula scrolled out of view.

**Change:**

- **Grow while focused.** `wordWrap: 'on'`, and set the height from
  `editor.getContentHeight()` in `onDidContentSizeChange`, between 1 line and
  about 8 lines, scrolling beyond that.
- **One line when not focused,** ending in "…", so step columns keep a
  steady height. The full text shows on hover.
- **Enter commits; Shift+Enter adds a line break.** A formula is one
  expression, but Python allows line breaks inside brackets, so a long
  modifier stack can be laid out:

  ```
  =scale[mod.map(name="score"),
         mod.retry(times=2)](wf["readings"], weight=2)
  ```
- **A pop-out editor** (an expand button) for very long formulas: a larger
  Monaco instance on the same text.

---

## 3. Core

> **Consolidated:** every open core ask now lives in [`docs/core-proposals/005-core-changes.md`](../core-proposals/005-core-changes.md), with new IDs (K1–K18) and a script that checks each one. The table below is kept for its context.

Ordered by what unblocks the app. C1–C6 keep their numbers from 120 §8;
C7–C11 are new here. Each was produced by running core at `d8b6979`.

| # | Ask | Found | Priority |
|---|---|---|---|
| C5 | Treat an unrun source's columns as **unknown**, and re-check staged steps once their input has run | A step reading a tool-backed source that hasn't run is declared invalid against an empty column set and returns `{'value': [None]}` after `run_all` | **high**: wrong results |
| C7 | **One `select` for rows and columns**: `select(columns=[…], rows=[…])`, with `rows` taking positions or a `start`/`stop` range, so a cell or block is one step | `select` takes only `columns`; `select` + `slice` in one step is refused (*"2 shape verbs in one step"*) | **high**: cells and blocks are two steps without it |
| C11 | **Refuse an operation where a step reference belongs**, until calls can nest (P0) | `scale[mod.map()](identity[mod.select(…)](wf["r"]))` runs, stores `{'value': [None]}`, and reports *completed* | **high**: a silently wrong result |
| C3 | `tool[mod.source()](**arguments)` and `tool[mod.sweep(…)]` declare a step with no input | the first raises *missing 1 required positional argument: 'source'*; `(None, …)` runs the tool immediately and stores inline data | high: canonical form for sources |
| C8 | **A value from another step** as a tool argument (P5, core 004 §B6) | `bind(weight=wf["x"])` is refused | high: references in keyword arguments |
| C9 | **A whole-table verb**: hand the tool the input grid, and use a returned DataFrame as the step's grid | `piv[mod.collapse()]` passes `None`; `piv[mod.map()]` looks for a column `df` | high: `pivot`, `merge_steps`, `pandas_eval` and user `df` tools are shimmed (003 §K) |
| C6 | Verb inference **independent of run state** | `add_n(wf["readings"])` is `collapse` with data, `map` before a tool-backed source runs | medium |
| C1 | Error when `over` is given both in the modifier and in the call | the call silently wins | medium |
| C2 | In Python, `over` takes only a `StepRef`; string ids only in `from_dict` JSON | `mod.map(over="readings")` is a reference, `scale[mod.map()]("readings")` a literal | medium |
| C4 | Tool-less modifiers callable on a reference, or document `identity[…]` | `'Modifier' object is not callable` | low |
| C10 | Per-unit progress callback on `run`; `redrive(step_id)`; a results-store interface | core 004 §B7–B9 | medium: progress bars, re-running failures |

---

## 4. The app backend

| # | Change | Files |
|---|---|---|
| A1 | Parse `wf["…"]` into typed references (`{"$ref": "readings"}`); reject bare names, `stepN`, `=Step!col`, dot and `[row=, col=]` forms, subscripts on a reference (suggest a select step), and an operation used as an input, with the messages in 120 §4 | `formula_parser.py`, `safe_formula.py` |
| A2 | Build the operation from the parsed form (tool, modifier stack, input reference, literals); resolve only typed references | `grid_runner.py` |
| A3 | Remove the string guessing: `_step_ref`'s name matching, the Excel regex, `_bind_previous_step`, the hidden column rename | `grid_runner.py` |
| A4 | Step references by **name**; ids stay internal | `useWorkflow.ts` (`genId`), the step map sent to `/api/run` |
| A5 | Migrate saved workflows to `wf["…"]` and print each change | a one-off script |

---

## 5. Order of work

1. **A4 + U1 + U3:** names in references, one syntax, no `data=`. This
   removes the silent-literal bug today, with whole-step and single-column
   references only.
2. **U5:** the formula bar grows. Independent of everything else.
3. **A1–A3:** typed references, end to end (120's requirements).
4. **U2 + U4:** select steps from picking (two steps for a cell until C7), chips, a quiet
   wiring mode.
5. **U6–U9:** staged cells, verbatim formulas, the data view, the dropdown.
6. **C5, C3, C8, C9** in core, as they land; each removes a shim or a
   restriction.

## 6. Tests to add with each change

| ID | Checks |
|---|---|
| TEST-UI-001 | Clicking a column of a **new, unsaved** step inserts `wf["<name>"]["col"]`, and the step runs as a map over it (the silent-literal bug) |
| TEST-UI-002 | No click ever inserts `data=` or any parameter name |
| TEST-UI-003 | Each gesture in §1.2 produces exactly the select step, or the reference, in its row |
| TEST-UI-009 | Picking a column while writing another step's formula adds a select step just before it and inserts `wf["<that step>"]` at the cursor; picking again updates the same select step |
| TEST-UI-010 | An operation written inline as another call's input is rejected with a message, never run |
| TEST-UI-004 | Renaming a step rewrites `wf["old"]` everywhere |
| TEST-UI-005 | A 200-character formula: the bar grows to show all of it while focused, and is one line when not |
| TEST-UI-006 | Reopening a saved workflow shows each formula byte-for-byte as saved |
| TEST-UI-007 | Staged cells contain no formula text |
| TEST-UI-008 | `grid_search` (in the demo) shows its `value` column |
