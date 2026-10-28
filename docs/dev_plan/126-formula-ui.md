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
>
> **To check where each item stands:** `python scripts/ui_status/status.py`;
> to try them in the UI: `simple-steps-dev --workspace scripts/ui_status`
> ([its README](../../scripts/ui_status/README.md)).

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

## Reported by the owner (2026-10-28)

From the owner's notes ([`noticed_issues_with_UI.md`](../archive/dev_plan/noticed_issues_with_UI.md), archived 2026-10-28), each checked in the
code or by running core at `58bc115`. "Traced" means read in the code and
not yet reproduced in the browser.

### R1 — The formula bar and the Formula panel don't stay in sync

**Bar → panel: traced.** Each keystroke in the bar writes `step.formula`,
but the panel's own copy (`editorFormula`) skips any change the bar made
(`OperationColumn.tsx:216–220`, the `lastTyped` guard). It catches up only on
Enter (`StepToolbar.tsx:430`), and **Enter also runs the step**. Blur doesn't
commit (`:435`). So after a valid edit and a click away, the step holds the
new formula and the panel shows the old one. Editing the panel then writes
from its old parts (`ToolEditor.write`) and **overwrites the bar's edit**.

**Panel → bar: not found in the code.** The panel's write reaches
`step.formula`, and the bar takes an outside value (`FormulaEditor.tsx:214`).
Needs the steps that showed it.

**Update.** One formula, one state: the panel re-reads the formula on every
change that parses, from either side. Committing and running are separate
actions (D3).

### R2 — What the panel does with a formula that doesn't parse

**Today** (`ToolEditor.tsx:94`): the panel keeps the last formula that parsed,
still editable, under a warning. Editing it writes that older formula back
and replaces the text being typed. This is D4.

### R3 — Box each reference in the colour of the step it reads

**Update** (F8, F9): each reference in the formula gets a box in its source
step's colour. The same colour boxes the cells it covers in the source grid:
dashed when that source's output is shown, none while it is staged (D6).
Needs the parser's reference spans (F8).

### R4 — A click draws the box, but doesn't open the window

**Today:** a click or a drag draws the solid outline. The window (the
selection inspector) opens only from the control on the selection's corner
(`DataOutputGrid.tsx:595`). This is D5.

### R5 — Cell states aren't shown: staged, failed, empty, stale, absent

**Today:** the grid can't show them. The `Cell` type has no state
(`types/models.ts`), and no endpoint calls `k.view`. Cell states are
guessed in the browser (`useStagedPreview`, `errorCells`).

**Core has them** (run 2026-10-28, `k.view(step)`): each row and each cell
carries `state`. Seen: `pending` for a staged step, `known`, `failed` (with
`error`), `stale` (with a marker: *stale output (input r changed)*). A
`None` result is `known` with value `None`. `absent` and `empty` are core's
rule 9 (`docs/design/rules.md`): null, absent and `[]` are three different
things. Neither appeared in this probe.

**Update** (F13): serve `k.view` for a step, add `state`, `type` and `error`
to `Cell`, and draw each state (D7).

### R6 — Staged steps: show the cell types and the expected shape

**Core has it** (run 2026-10-28). A staged `double[mod.map()](wf["r"])` over
4 rows gives `plan` = rows **exact 4**, columns `["value"]`, types
`{"value": "int"}`. Its view gives 4 rows of `pending` cells, each typed.
Where a count isn't known, `plan` says why and how to find out (`size`:
*unknown*, *d hasn't run…*, `resolve: ["run 'd'"]`).

**Update** (F13): a staged step's grid is its planned shape: the planned
rows of empty `pending` cells under typed headers, with core's reason in
place of any count it can't give. This replaces the guessed staged columns
and the `↳` text (F12).

### R7 — Cells can't be picked as a reference while writing a formula

**Traced.** It's deliberate in the code: while a formula bar has focus, a
cell click is ignored (`DataOutputGrid.tsx:430`: *single cells: later*).
There are also **two selection models**:
- exploring (`utils/gridSelection.ts`) does cells, blocks, rows, columns;
- picking (`utils/selection.ts`) does only rows, columns, or the whole table.

**Update** (F10): one selection model. While a formula bar has focus, the
same selection you explore with is the pick. What it writes is D1.

### R8 — Reference boxes during deep exploration

The owner has more to add. Depends on R3 and R7.

### R9 — Index and `#` columns: shown as a hint, expandable

**Core** (rules 2, 3): every row has an id `#`, which follows it through
sorts and filters. `#v` holds the row of step `v` it came from. Tools never
see them.

**Today:**
- The grid's index column is the **screen position** (`String(r)`), not
  core's `#`.
- `/api/data?index=true` returns the `#` columns, but the grid never asks
  for them.
- Owner, 2026-10-27: lineage columns are kept in stored data and hidden by
  default, with an expander planned.

**Update:** show core's `#` as the index. `#v` and the other lineage
columns go in a hidden side expander to the right of `#`: a hint that they
exist, opened on demand. What a row pick refers to is D8.

### Unfinished in the notes

- *"make sure the data is …"*
- *"and rules"* (under staged results). Possibly core's rule 7, *you see the
  shape before you run*: the plan's `inverse` (`rebuild`, `trace`, `opaque`,
  `generated`).

## Progress

| Date | Item | Done | Confirmed |
|---|---|---|---|
| 2026-10-28 | **R1** | `OperationColumn` keeps one formula: the panel reads `step.formula`, which the bar writes on every keystroke. The second copy (`editorFormula`), its `lastTyped` guard, and `onFormulaCommit` are gone | by construction; to try in the browser: `scripts/ui_status` 01/doubled |
| 2026-10-28 | **F1** (and F2's list) | The autocomplete writes through the panel's writer, `formatFormula(partsForTool(tool, type, previous step))`, so it gives `=is_big(wf["readings"])` (core's implicit auto), not `=is_big.map(`. It lists tools only, as the panel does; the badge no longer shows a `.` | a throwaway vitest (type `=is_`, pick, check the formula and the parts sent), deleted after; to try in the browser: 01/pick_a_tool |
| 2026-10-28 | the index header | reads `#` (header, tooltip, hover, `colLabel`). Its values are still screen positions: R9 | — |
| 2026-10-28 | **D4** | `ToolEditor` freezes while the formula doesn't parse: core's reason shown, inputs and modifiers greyed in a disabled fieldset, and `write()` refuses every edit but a tool choice. Choosing a tool starts the formula over (`partsForTool(tool, type, previous step)`), replacing the text that doesn't parse; the picker shows no tool, so any choice fires | a throwaway vitest (freeze, an argument edit writes nothing, a tool choice writes `=reduce(wf["r"])`); it failed with `write()`'s guard removed, so the guard, not only the fieldset, holds; deleted after |
| 2026-10-28 | **D3** | **Enter declares, ⌘/Ctrl+Enter runs.** Enter syncs the workflow at once (`useWorkflow.declareWorkflow`: `/api/workflow/sync`, nothing run; core's stale marks applied), where it used to run the step. ⌘/Ctrl+Enter is a new Monaco command (`KeyMod.CtrlCmd \| KeyCode.Enter`, 2048 \| 3, checked in the installed package) that runs it. Passed through both `OperationColumn` callers (`MainLayout`, `DetachedStepWindow`); the Run button's tooltip names the key. Edits were already declared 300 ms after each change; Enter now does it at once | a throwaway vitest (a stand-in editor: Enter calls declare, not run; ⌘Enter runs), deleted after. Monaco doesn't load in jsdom, so the real keys are to try in the browser: 01/doubled |
| 2026-10-28 | **R5, R6** (and R9's values) | **The grid draws core's view of each step, run or not.** Server: `kernels.view` (core's `k.view` and `step.plan`) behind `GET /api/view?workflow_key&step&offset&limit`: each cell with `state`, `type`, `error` and row id `#`; the step's state, problems and plan; `#` lineage columns left out. Each step's summary (sync and run) gains a `view_key` (state, data version, formula, plan, problems). Frontend: `useWorkflow.refreshViews` fetches a step's view only when its key changes, and fills its cells from it; `runStep` no longer reads cells from `/api/data` or guesses failed rows (`withRowErrors`). The grid marks each cell by state (D7a as recommended: pending empty, or a spinner while running; failed tinted with the error as its tooltip; stale dimmed; absent grey; a known null a dim `null`), shows each column's type after its name, shows core's `#` in the index (D8), and draws a staged step with no rows as its typed header plus the plan's reason. The guessed staged columns (`useStagedPreview`) show only until core's view arrives | server: a TestClient run of 02-cell-states (sync → staged view with its plan; run → `failed` cell with its error; `view_key` changes; 404 for an unknown workflow). Frontend: two throwaway vitests, deleted after (the grid: states, tooltip, `null`, ids `3,2,1,0,0.1`, types, planned header, the empty frame kept; `refreshViews`: fetches on a new key only, a run fills cells from the view with `/api/data` stubbed to throw) |
| 2026-10-28 | **D5, as the owner meant it** | **A click draws the box; the selection's corner control opens the inspector.** A plain cell click used to open the inspector (owner, 2026-10-22); the owner reversed that ("when I select I don't want to see the panel, just the box; the corner opens the inspector"). `clickCell` now only selects; the cell viewer test changed with it, to click then open from the corner | the updated test; vitest 148/148 |
| 2026-10-28 | **text row ids: `rows[…]`** | As core's Python says, a plain bracket takes int row ids (or positions, for a range); a text id goes through `rows["0.1"]` / `rows[["A", "C"]]`, since `["n"]` would read as a column. The parser had taken `wf["per_ward"]["A"]` as a row; it now refuses a plain `["…"]` with core's wording (`wf["readings"]["n"]` → use `cols["n"]`, or `rows["n"]` for a text row id), and picks on expand / collapse steps write `rows[…]` | each form parsed, run in core and round-tripped; a throwaway vitest for the pick text, deleted after; pytest 1 failed (the known one); every example's runme |
| 2026-10-28 | the `#` column | as narrow as its widest row id (`max-content`, smaller digits, tight padding), never cut | — |
| 2026-10-28 | **D1 picks, R7, F6, F10** | **Picks write core's notation at the caret, from the grid's one selection.** While a formula bar has focus, the grid uses the same selection as looking (a cell, a block, rows, columns, the corner; Shift, ⌘/Ctrl, drag), drawn as the bold outline (D6), and sends it in core's notation (`selectionText`): single and scattered rows by row id (`[3]`, `[[3, 1]]`), runs by position (`[1:3]`, core's ranges), columns `cols[…]`; a selection that isn't one rectangle sends nothing. The formula takes it at the caret, in an open call, or as the whole step (`wf["r"][:]` for a whole table); the next pick replaces the last while its text is still there (`placePick`). Gone: select steps made by picking (`selectionFormula`, `applyPick`, `selectStepName`, `parseSelectionFormula`, `insertStep`, `onInsertStepBefore`/`onSetStepFormula`), the separate highlight, and the guard that ignored cell clicks. The status bar shows the pick as written (`Selecting wf["r"][1:3]`); its test changed with it (it asserted the removed select-step description) | throwaway vitests, deleted after: every pick kind's text (with sorted ids), the grid in wiring mode (cell, Shift block, column, corner, ⌘ rows, non-rectangle → nothing, no inspector tab), `placePick`'s cases; every text run through the parser and core on a sorted step (`05-staged`'s `by_n`): each selects exactly the cells picked. vitest 148/148 (149 less the merged status-bar test) |
| 2026-10-28 | **F7** (D1's parser half) | **The parser reads core's selection notation**, mapped to core's spec and nothing more (`_selection`): rows by id (`[1]`, `[[0, 2]]`, `[1:3]`, `["0.1"]`), columns (`cols["n"]`, `cols[["a", "b"]]`, `cols["a":"b"]`), in either order. As an argument, `n=wf["split"][cols["value"]]` is `{"$ref": "split", "columns": {"names": ["value"]}}`; as a whole step, `wf["r"][0:2][cols["n"]]` is `identity[mod.select(…)]` and prints back in the notation (`format_parts`, as core prints it). As a tool's input it is refused, with core's reason and remedy. The panel carries a selection argument as its text (`{"$expr": …}`), so the browser never parses it. `bad_examples`' `row_selection` lesson now teaches it: the corrected step is `wf["readings"][0:2]` | each form parsed, run in a kernel (values checked) and round-tripped unchanged; refusals checked; pytest 1 failed (the known one), every example's runme, `05-staged`'s `after_split` run through the server: `[20, 22, 40, 42, 60, 62, 80, 82]`. Reported by the owner: the column reference in 05's last step didn't parse |
| 2026-10-28 | staged cells | a light blue cell holding its type, `<int>` (owner's ask); `maybe` cells dashed as well | — |
| 2026-10-28 | `simple-steps-dev` | **the dev UI talked to whatever was on :8000.** Vite's proxy was fixed at `127.0.0.1:8000`; when that port was taken (here, a week-old server from another checkout), the dev backend moved to :8001 and the UI kept asking :8000. `cli_dev` now passes the backend it started (`SIMPLE_STEPS_BACKEND`) and `vite.config.ts` proxies there | reproduced with :8000 taken: before, the UI listed another server's `demo` project; after, `ui_status` |

Checks after: tsc clean, vitest 149/149, pytest 1 failed (the known `test_select_cell`, after R1/F1; no backend change since), preflight clean (bundle rebuilt), `scripts/ui_status/status.py` 11 open / 5 changed (after D3; tsc clean, vitest 149/149, bundle rebuilt, preflight clean). After R5/R6: tsc clean, vitest 149/149, pytest 1 failed (the known one), bundle rebuilt, preflight clean, `status.py` 8 open / 8 changed.

**Found with `scripts/ui_status` 05-staged (run, 2026-10-28):** core plans a
staged `filter` or `slice` as `bounded` rows of `maybe` cells (the row may
not be kept), and a `collapse(by=)` as `bounded` with no cells ("one row per
group; the groups come from the data"). The grid now draws `maybe` cells
(dashed, their own tooltip) and shows core's reason for any rows that aren't
exactly known, not only `unknown` ones, also under the empty frame.

**Left from R5/R6:** `previewStep` and `showOutputs` still fill cells from
`/api/data` first (the view replaces them as its key arrives); `useStagedPreview`,
`errorCells.withRowErrors` (still used by `previewStep`) and the staged
overlay can go once the view is confirmed in the browser (F12, F13). D7a's
look is the recommendation, not yet confirmed. `/api/data` stays for the
selection inspector's whole-column reads and `?index=true`.

R1 made the panel see each keystroke, so a formula that doesn't parse
showed the last one that did, still editable; D4's freeze closed that.


## Decisions (owner, 2026-10-28)

| | Question | Decided | What it means for the work |
|---|---|---|---|
| D1 | What a pick of columns, rows or cells writes | **Core's notation, inline**: `wf["r"][0:2][cols["n"]]` where the pick is used, no select step | F6: `utils/selection.ts` writes the notation, and `selectionFormula` / the select-step insertion (`onInsertStepBefore`) go. F7: the parser accepts it. Unblocks F8–F10, R3, R7 |
| D3 | What Enter does | **Enter declares the step** (instantiates it, so core checks and plans it) **without running the operation. ⌘/Ctrl+Enter declares and runs** | Built 2026-10-28 (Progress). What a declared step shows (staged, its plan, invalid with core's reason) comes with R6: the sync already returns each step's state and problems, but a `Step` has no field for them yet |
| D4 | The panel while the formula doesn't parse | **Freeze it**, with core's reason. **Its tool picker still works: choosing a tool rewrites the formula for that tool. Any state change in the panel re-enters the whole formula** (owner, 2026-10-28) | Built 2026-10-28 (Progress). A tool chosen in the autocomplete does the same, through F1's writer |
| D5 | What opens the selection window | **Only the corner control.** A click never opens it | No change to today's behaviour. R4 is closed: a click draws the outline only |
| D6 | How references and selections are drawn | **Dashed = a reference** (the cells a formula's reference covers, in the source step's colour). **Bold = the selection** | Two separate marks, and they can overlap. R3: the formula's reference box and the source grid's box are dashed in the same colour. The selection is bold (today's solid outline) |
| D7 | Cell states | **Grey for absent** (written "abstract"; *check* that absent is what was meant) | The other states' look is still open; see D7a |
| D8 | Lineage after re-indexing and filtering | **Keep the link to the previous row, and show it only when the user asks**: an expander for each `#<step>` column | See *Lineage columns* below |

Still open:

| | Question | Recommended |
|---|---|---|
| D7a | How `pending`, `failed`, `stale`, null and `empty` look | pending: empty cell, type dimmed. failed: tinted, error in the popover. stale: values dimmed. null: a dim `null`. empty step: one `empty` cell. Checked in light and dark |
| D2 | Order | R1 and F1 (both lose edits or dead-end) → D3 (Enter declares) and D4 (frozen panel) → F3, F12 → R5, R6 (F13) → D1: F6, F7, F8, then R3, R7, F10 → R9 / D8 → the rest |

## Lineage columns (D8)

Run at `58bc115` with `kernels.operation_for` (the UI's path), on
`r` = 4 rows (`ward`, `n`):

| Step | Row ids `#` | Lineage columns |
|---|---|---|
| `filter`, `slice` | the input's ids, with gaps: `1, 2, 3` | none: `#` **is** the input's row |
| `sort` | the input's ids, reordered: `3, 2, 1, 0` | none: `#` **is** the input's row |
| `distinct(columns=["ward"])` | the kept ids: `0, 1, 3` | `#r` = the rows each stands for: `[0, 2], [1], [3]` |
| `expand` | new: `0.0, 0.1, 1.0, …` | `#r` = the parent row: `0, 0, 1, …` |
| `collapse(by="ward")`, `gather` | the key: `A, B, C` | `#r` = the member rows: `[0, 2], [1], [3]` |
| `stack(wf["r"], wf["filter"])` | new: `0…6` | `#r` and `#filter`, one per input; `None` where the row came from the other |
| `join(…, on="ward")` | the left side's: `0…3` | `#r`, `#collapse` |
| `filter → sort → expand` | `3.0, 3.1, 2.0, …` | `#s2` only: **one hop back**, to the step it read |

What the grid does with this:

- **The index column shows `#`**, never the screen position (R9). After a
  filter or sort it shows the gaps and the order: that is the link back, so
  there's no column to expand.
- **Each `#<step>` column is collapsed behind one expander**, to the right
  of `#`, labelled with the step it points to (`#r`). Opening it shows the
  previous step's row ids, as a list where several rows became one.
- **One hop.** A chain is followed step by step: an expander shows the step
  read, and going further back means opening that step's own lineage, or
  core following the chain (ask core whether `k.cell` already traces it:
  [008 K28](../core-proposals/008-core-changes.md#k28-cell-to-cell-lineage-stored-in-each-output)).
- Seen in the same run: after `expand`, the step has only `value` and
  `#s2`, so `collapse(by="ward")` on it is refused (*which 'e2' does not
  have*). Results-only steps make the user `zip_` the parent's columns back
  first. Worth a clearer message or a hint in the UI.

## Tests to add with each change

Carried from 121 §6; IDs kept.

| ID | Checks |
|---|---|
| TEST-UI-002 | No pick ever inserts `data=` or any parameter name |
| TEST-UI-003 | Each pick gesture writes core's notation (`wf["r"][…][cols[…]]`) at the cursor, and it parses (D1) |
| TEST-UI-012 | Enter declares and doesn't run; ⌘Enter runs (D3) |
| TEST-UI-013 | A valid edit in the bar shows in the panel without Enter; editing the panel after it keeps the bar's edit (R1) |
| TEST-UI-014 | While the formula doesn't parse, the panel writes nothing; choosing a tool unfreezes it (D4) |
| TEST-UI-004 | Renaming a step rewrites `wf["old"]` everywhere |
| TEST-UI-005 | A 200-character formula: the bar grows to show all of it while focused, and is one line when not |
| TEST-UI-006 | Reopening a saved workflow shows each formula byte-for-byte as saved |
| TEST-UI-007 | Staged cells contain no formula text (F12) |
| TEST-UI-011 | A tool chosen in the autocomplete and in the panel gives the same formula, and it parses (F1) |
