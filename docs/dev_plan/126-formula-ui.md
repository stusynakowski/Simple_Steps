# 126 — The formula UI: what's open

> Status: **active**, 2026-10-27, app at `22009dc`, core `58bc115`. The one
> list of open work on writing formulas, picking references and showing a
> step's cells. It replaces the open parts of
> [121](../archive/dev_plan/121-ui-and-core-changes.md) (U1–U9),
> [123](../archive/dev_plan/123-tool-picker-discrepancy.md) (the two tool pickers),
> [124](../archive/dev_plan/124-core-009-integration.md) phases 3–6 (the grid), and
> [125](../archive/dev_plan/125-migrate-to-core-kernel.md#the-formula-parser-central-and-thin)
> (the parser and reference spans). Those keep the evidence; this page keeps
> the status. The rule underneath is [120](120-literals-and-references.md):
> a reference is `wf["<step>"]`, and everything else is a literal.

## What each path writes today (run 2026-10-27)

Each is the text a UI path writes, put through `operation_formula.compile_formula`:

| Path | Writes | Result |
|---|---|---|
| Formula panel → Tool (`ToolEditor`) | `=extract_json[mod.map()](wf["r"])` | parses |
| Formula-bar autocomplete (`StepToolbar.tsx:169`) | `=extract_json.map(wf["r"])` | **refused**: *extract_json.map is not a tool* |
| Grid pick, columns (`utils/selection.ts`) | `=identity[mod.select(columns=["n"])](wf["r"])` | parses |
| Grid pick, rows | `=identity[mod.slice(at=[0, 2])](wf["r"])` | parses |
| Core's selection notation, typed | `wf["r"][cols["n"]]`, `wf["r"][0:2]` | **refused** by the app's parser (`_reject_column_ref`): *a step reads a whole step, not part of one* |
| A cell as an argument, typed | `scale[mod.map()](wf["r"], n=wf["r"][0][cols["n"]])` | **refused**: *n must be a literal … or wf["…"]* |
| A reference by position, typed | `wf[0]` | **refused**: *wf[…] takes a step name in quotes*. Owner decision 2 says it should work; core ask K30 |

## Open items

### Writing a formula

| # | Item | Where | From |
|---|---|---|---|
| F1 | **One writer.** The autocomplete inserts through the panel's path (`formatFormula(partsForTool(…))`), so a tool chosen anywhere gives the same valid formula and the same default input | `components/StepToolbar.tsx:169` | 123 §1 |
| F2 | **One list, one look.** A shared tool list (tools only, grouped by category, label then id) for both pickers; verbs and orchestrators offered as modifiers, not tools; a searchable panel picker (`cmdk`) | `StepToolbar.tsx`, `ToolEditor.tsx:146` | 123 §2–4 |
| F3 | **Highlighting knows `wf["x"]`.** Monaco colours only the retired `step1.col` | `shell/monacoSetup.ts:96` | 125 |
| F4 | **The orchestration dropdown edits the formula's `[…]` stack**, not a separate `_orchestrator` key | `components/OperationColumn.tsx:346` | 121 U9 |
| F5 | Formula bar: Enter commits, Shift+Enter breaks a line, a pop-out editor for long formulas. Growing while focused is built (`FormulaEditor.tsx`); the rest not checked | `components/FormulaEditor.tsx` | 121 §2 |

### References and selection

| # | Item | Where | From |
|---|---|---|---|
| F6 | **What a pick writes** (decision D1 below): a visible select step (today), or core's notation inline | `utils/selection.ts` | 121 §1.2, 124 phase 4, 125 |
| F7 | **The parser accepts selections** (`wf["r"][0:2][cols["n"]]`, as a step and as an argument): remove `_reject_column_ref` and map the subscript to the spec; core checks it | `operation_formula.py:586` | 125 |
| F8 | **Reference spans from the parser**: for each reference, its offsets in the text and what it covers (step, rows, columns). One source for both chips and boxes | `operation_formula.py`, `/api/parse_formula` | 125 |
| F9 | **Reference chips** in the formula bar, each in its source step's colour, matching a box around the cells it covers in the source grid; hover shows what it reads | `FormulaEditor.tsx`, `DataOutputGrid.tsx` | 121 U4 §1.4, 124 phase 6 |
| F10 | **Cells and blocks** as picks, and dragging a selection's edge to resize it | `utils/selection.ts`, `utils/gridSelection.ts` | 121 §1.6 |
| F11 | **`wf[index]`** in a formula, saved by name | parser; core K30 | 125 decision 2 |

### Showing a step's cells

| # | Item | Where | From |
|---|---|---|---|
| F12 | **Staged cells carry no formula text.** They show `↳ <ref>` today; show empty with a spinner (running) or a dot (queued) | `hooks/useStagedPreview.ts:63`, `:183` | 121 U6 |
| F13 | **Draw the grid from core** (`k.view`), replacing `useStagedPreview` and `utils/errorCells.withRowErrors`: cell states, shades, placeholders, header state | `hooks/useStagedPreview.ts`, `utils/errorCells.ts` | 124 phase 3 |
| F14 | The data view shows the columns new relative to the step it **reads** (`grid_search` hid its result). Not rechecked since results-only steps | `DataOutputGrid.tsx` | 121 U8 |
| F15 | **The popover's inputs and outputs toggles**: traced boxes into the frame from `k.cell(…)` inputs, and out from references and row ids | `SelectionInspector.tsx` | 124 phase 5 |
| F16 | **Editing shows consequences**: on each edit, re-declare without running and mark later steps stale, invalid or reshaped | `useWorkflow.ts` | 124 phase 6 |

### Reported by the owner

*To fill: the issues seen in the running app, each with the formula and what
happened, checked against the items above.*

## Decisions to make

| | Question | The two positions |
|---|---|---|
| D1 | What does picking columns or rows write? | **A select step** (121 §1.2, built): visible in the workflow, one shape change per step. **Core's notation inline** (124 phase 4, 125): `wf["r"][0:2][cols["n"]]` where the pick is used, no extra step; core now runs it. F7–F10 depend on this |
| D2 | Order | Recommended: F1 (a silent dead end today) → F3, F12 (small) → D1, then F7, F8, F9 → F13 → the rest |

## Tests to add with each change

Carried from 121 §6; IDs kept.

| ID | Checks |
|---|---|
| TEST-UI-002 | No pick ever inserts `data=` or any parameter name |
| TEST-UI-003 | Each pick gesture produces exactly the formula D1 settles on |
| TEST-UI-004 | Renaming a step rewrites `wf["old"]` everywhere |
| TEST-UI-005 | A 200-character formula: the bar grows to show all of it while focused, and is one line when not |
| TEST-UI-006 | Reopening a saved workflow shows each formula byte-for-byte as saved |
| TEST-UI-007 | Staged cells contain no formula text (F12) |
| TEST-UI-011 | A tool chosen in the autocomplete and in the panel gives the same formula, and it parses (F1) |
