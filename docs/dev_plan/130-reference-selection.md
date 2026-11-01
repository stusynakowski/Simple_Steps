# 130 — Selecting data from earlier steps

**Status:** proposed (2026-11-01). Nothing here is built yet. The owner's
rules are in §2 (2026-11-01). The points still open are in §2.2.

**Goal:** a user can point at any cell, row, column or block of an earlier
step and get a reference that (a) reads the way it looks in the grid,
(b) means the same thing every time it runs, and (c) can be written the same
way wherever a reference is allowed.

This plan takes over the selection parts of
[120](./120-literals-and-references.md) (§2.1, §2.4, §2.5, which no longer
describe the code) and builds on what
[126](./126-formula-ui.md) already shipped (D1, F7, F8, R3, R7, F10).
Core's own design for the notation is
[008 C7](../core-proposals/008-core-changes.md#c7-excel-style-selection-wfsteprowscolscolumns-includes-k9).

---

## 1. Where things stand (run 2026-11-01)

### 1.1 What the parser accepts

Run through `operation_formula.compile_formula`:

| Formula | Result |
|---|---|
| `wf["r"][1]` | `select(rows=1)` |
| `wf["r"][1:3]` | `select(rows={"start": 1, "stop": 3})` |
| `wf["r"][[3, 1]]` | `select(rows=[3, 1])` |
| `wf["r"][rows["0.1"]]` | `select(rows="0.1")` |
| `wf["r"][1][cols["n"]]`, `cols[["a","b"]]`, `cols["a":"b"]` | accepted |
| `wf["r"][-1]` | **refused**: *takes rows ([1], [[0, 2]], [1:3], rows["0.1"]) or columns* |
| `wf["r"][cols[0:2]]` | **refused**: *cols[…] takes a column name, a list of names or a range* |
| `wf["r"][1, cols["n"]]` | **refused** (one-bracket pair) |
| `wf["r"]["n"]` | **refused**, with a hint to use `cols["n"]` or `rows["n"]` |

Where a selection can go:

| Position | Today |
|---|---|
| A whole step: `=wf["r"][0:2][cols["n"]]` | yes, compiles to `identity[mod.select(…)]` |
| A tool argument: `tool(wf["a"], n=wf["r"][cols["n"]])` | yes, saved in the panel as `{"$expr": …}` |
| A tool's input: `tool(wf["r"][0:2])` | **refused** (`_reject_column_ref`); core ignores it silently in JSON ([008 C20](../core-proposals/008-core-changes.md), [009 §7](../core-proposals/009-decisions-to-confirm.md)) |

### 1.2 A row number means two different things

On `s` = `r` sorted by `n` descending (row ids `3, 2, 1, 0`; values
`40, 30, 20, 10`), running core:

| Formula | Rows returned | Read as |
|---|---|---|
| `wf["s"][1]` | id `1` → `20` | **row id** |
| `wf["s"][[3]]` | id `3` → `40` | **row id** |
| `wf["s"][1:3]` | ids `2, 1` → `30, 20` | **positions** 1–2 |

So `[1]` and `[1:3]` count from different things. The grid's `#` column
shows ids (`3, 2, 1, 0` after a sort, `0.0, 0.1, …` after an expand), and the
user counts positions down the screen. Neither reading works every time. This
is the root of most "I picked the wrong row" reports. It also breaks C7, which
asks for **positions everywhere**.

### 1.3 What core already does that the rules below rely on

Running core (2026-11-01):

| Case | Result |
|---|---|
| `addk[mod.map()](wf["r"], k=wf["one"])`, `one` a one-cell step | `k` is the cell's value |
| `tot[mod.map()](wf["r"], xs=wf["col"])`, `col` a one-column step | `xs` is the column as a list |
| `addk(…, k=wf["t"][0][cols["a"]])` (one cell) | the value |
| `addk(…, k=wf["t"][0])` (a row), `k=wf["t"][cols[["a","b"]]]` (a block) | refused: *an argument is passed whole, not one value per row* |
| `double(wf["r"])`, `r` has columns `a, b` (no `n`), with `mod.auto()`, `mod.map()` or implicit | refused: *double() needs 'n', which 'r' does not have* |
| `double[mod.auto()](wf["r"][cols[["a","b"]]])` | refused: *a selection can't be a tool's input* |
| a column named `0`, `"0"` or `1.5` | kept as the string `"0"`, `"1.5"` |

Core binds parameters to columns **by name only**. I couldn't reproduce
auto picking "the first column of the right type" (§2.3, Q1).

### 1.4 Other problems

1. **Only some spellings are accepted.** `wf["t"][1][cols["score"]]` and
   `identity[mod.select(…)](wf["t"])` work. `[1, cols["score"]]`,
   `[cols["score"]][1]` with `rows[…]`, `[-1]` and `cols[0:2]` don't.
2. **Selections can be arguments but not inputs.** Picking rows to feed a tool
   means making an extra step by hand.
3. **The `#` columns may be usable as data.** Not yet checked: whether `#`
   or `#r` can be selected with `cols[…]`, bound to a parameter or used in a
   modifier setting.
4. **Retired syntax is still shown.** The console help lists `step1["score"]`
   ([commands.ts](../../frontend/src/types/commands.ts)). Its test uses
   `step1["url"]` ([commands.test.ts](../../frontend/src/types/commands.test.ts)),
   and a comment in [formulaParser.ts](../../frontend/src/utils/formulaParser.ts)
   shows `.map(url=step1.url)`.
5. **Selections are saved as text and re-parsed.** Arguments go through
   `{"$expr": …}` (`operation_formula.py` `_selection_text`, `format_parts`).
   That's the legacy route 009 D1 is meant to retire.
6. **A non-rectangular pick writes nothing.** `selectionText` returns `null`,
   and the user isn't told why.
7. **The known red test isn't a selection bug.**
   `select(columns=["score"], rows=1)` returns `score = 75` at row id `1`,
   which is correct. `test_select_cell` reads it with `result.iloc[0][0]`,
   and current pandas reads the second `[0]` as a column label → `KeyError: 0`.
8. **The specs are out of date.** 120 still says there are no column
   references and that a reference can't be an argument until P5.

---

## 2. The owner's rules (2026-11-01)

| | Rule |
|---|---|
| **R1** | **Rows are positions, like a Python list.** Every step's `#` column runs `0` to `n-1` over its current output, always. `wf["s"][0]` is the first row, `[i:j]` rows `i` to `j-1`, `[[0, 2]]` rows 0 and 2, `[-1]` the last. `rows[…]` is an explicit label for the same thing. Text row ids (`rows["0.1"]`) are retired |
| **R2** | **Lineage lives in `#<step>` columns,** one per step the rows came from (a join or stack has one for each). They're behind an expander in the grid. Each cell holds the positions in that step: **one position** after filter, sort or slice; **a list of positions** after a reduction (collapse, group, distinct); **`i.j`** after an expansion, where `i` is the parent row and `j` the item's index within that row's cell. This replaces 126 D8, where `#` was core's row id |
| **R3** | **`#` and `#<step>` are never data.** They can't be selected with `cols[…]`, bound to a tool's parameter, passed as an argument or used in a modifier setting (a map condition, `by=`, …) |
| **R4** | **Column names are unique strings, and never numbers.** A tool's outputs with no names, and a name that is a number or a numeric string, become `var<n>`: `0` and `"0"` are both `var0`. Two columns with the same name are refused, including when a rename collides (`0` → `var0` beside an existing `var0`) |
| **R5** | **A tool's arguments (inside `()`) are literals, references to a selection of cells, or resources.** A step whose output is one cell or one column is referenced whole, `wf["s"]`, and the UI makes it obvious that it is one cell or one column. A block or whole table is allowed only when the parameter takes a `DataFrame`, or when the block's column names match the tool's parameter names |
| **R6** | **Many ways to write a selection,** all accepted and saved as written: `wf["r"][1:3][cols["a"]]`, `wf["r"][cols["a"]][1:3]`, `wf["r"][1:3, cols["a"]]`, `wf["r"][rows[1:3], cols["a"]]`, and `identity[mod.select(rows=…, columns=…)](wf["r"])` |
| **R7** | **A selection can be a tool's input, as shorthand:** `double(wf["r"][0:5])`. Core should support it directly (§6); the app doesn't fake it with a hidden step |
| **R8** | **Pairing rows across steps needs proof they line up.** When a step maps row by row and its arguments read rows from more than one step, the rows must be clearly aligned: lineage shows they're the same rows in the same order (e.g. a chain of maps with no filter, sort, expand or collapse between them). Otherwise the user must `join`, `zip_` or merge the steps first. This applies to the input and to the arguments |
| **R9** | **Auto never picks a column by type.** It binds by name; anything ambiguous is refused, naming the columns |
| **R10** | **A reference passes values, not names.** A tool argument that is a reference receives the data it points at. A tool doesn't receive a column's or step's *name* to look up for itself (`top_n(df, column="n")` is the pattern to move away from). Column names as strings stay only in modifier settings (`by=`, `columns=`) |
| **R11** | **What the user sees is what the tool gets.** The worst outcome is a user who thinks a step processes one selection while it processes another. The same reference text must never mean different data depending on something the user can't see (a parameter's type, run state, which step is the input) |

### 2.1 The model in one place

**A step's output** is a table with three parts:

- `#`: the row's position, `0..n-1`. Bookkeeping, not data.
- `#<step>`: where each row came from, one column per source step.
  Bookkeeping, not data.
- **data columns**: unique string names. These are the only things a
  reference or a tool can read.

**A reference** names data: `wf["s"]` for the whole step, and rows by
position and columns by name, in any spelling (R6).

**A reference goes in one of three places**, and each has its own rule:

| Place | Holds | Rule |
|---|---|---|
| **Input** (the positional argument) | a step or a selection of it | What the step works over. Its columns bind to the tool's parameters **by name**, never by type (R9) |
| **Arguments** (keywords in `()`) | a literal, a resource, or a reference | A reference passes its **values** (R10). **A cell**: the same value for every row. **A column, in a row-by-row step**: that row's value, paired with the input's row, only when the rows are aligned (R8). **A table**: only when the parameter takes a `DataFrame` or its column names match the parameter names (R5) |
| **Settings** (inside `[mod.…()]`) | literals only | Never a reference, never a `#` column (R3). The one place a column is named rather than passed |

**Row alignment** is the one rule that spans steps. Row `i` of one step
means row `i` of another only when lineage proves it. Otherwise
`join` / `zip_` / merge is the explicit way to say how rows match (R8).

### 2.1a What core does with a column argument today (run 2026-11-01)

`r` = columns `n, a`; `m` = a map over `r` (same rows); `f` = an unrelated
2-row step. All in a `map` over `r`:

| Argument | Parameter | Result |
|---|---|---|
| `k=wf["r"][cols["a"]]` (the input's own column) | `k: int` | **per row**: `11, 22, 33` |
| `k=wf["r"][cols["a"]]` (the same text) | `k: list` | **the whole column** to every row: `61, 62, 63` |
| `k=wf["m"]` (aligned map step) | `k: int` | refused: *to pair its rows with the input's, join first* |
| `k=wf["f"][cols["a"]]` (unrelated) | `k: int` | refused: *the rows of 'f' aren't the rows of 'r' … join them, or zip_* |

So per-row pairing already exists, but only for the input's own columns.
Two gaps against the rules:

- **R11 is broken.** The same text, `wf["r"][cols["a"]]`, is one value per
  row or the whole column depending on the parameter's type annotation,
  which the formula doesn't show.
- **R8 is narrower in core.** A step whose rows provably match the input's
  (`m`, a map of `r`) is refused, even though it's aligned.
- **R8 and R11 broken the other way.** A filter of the input *is* paired, by
  row id: `add_k(wf["r"], k=wf["filtered"][cols["n"]])` runs, row 0 silently
  gets null, and the other values become floats. Worked example:
  `scripts/ui_status` workflow `06-mappings-and-references`, step
  `unaligned_step`, which records every rule as EXPECT / TODAY / VERDICT.

### 2.2 What these change

- R1 reverses my earlier recommendation of ids for picks. A pick by position
  can read a different row after an upstream filter changes. The dashed box
  and the hover (P9) show what it reads now, and the step goes stale when its
  source re-runs.
- R1 and R2 change what core's `#` means. Today `#` holds row ids (§1.2).
  This needs core (§6). Until then the app can show core's `position` as
  `#`, since `k.view` already returns it, but it can't change what `[1]`
  selects. Only single rows can be shimmed (as `{start: i, stop: i+1}`).
- A non-rectangular pick still writes nothing.

### 2.3 Answers (owner, 2026-11-01)

| | Question | Answer |
|---|---|---|
| **Q1** | Where does auto bind the first column of the right type? | **Not reproduced.** Every case below was refused by name, in core and through the app's paths. Still open: the owner's own example |
| **Q2** | `var0` already exists when `0` is renamed | Refused: column names are unique (R4) |
| **Q3** | Does R8 cover arguments? | Yes, when the step maps row by row and its arguments read rows from more than one step (R8) |
| **Q4** | A block or table as an argument | Yes, when the parameter takes a `DataFrame` or the block's column names match the parameter names (R5) |
| **Q5** | In a row-by-row step, how does a user pass a **whole column** as a list, if a column reference means "this row's value" (R11)? | **Open.** Recommended: from a cell that holds the list, e.g. a `gather` step referenced as one cell, so the reference always shows what arrives. Alternatively an explicit marker on the reference |

**Q1, run 2026-11-01** (core directly; `double(n: int)`, `shout(s: str)`,
reducers `add_n(acc, n)`, `joined(xs: list)`):

| Input columns | Formula | Result |
|---|---|---|
| `a, b` (int) | `double(wf["r"])`, `double[mod.auto()]`, `double[mod.map()]` | refused: *needs 'n'* |
| `t` (str), `b` (int) | `double[mod.auto()](wf["r"])` | refused |
| `x` alone | `double(wf["r"])` | refused |
| `value` alone, or `value` + others | `double(wf["r"])`; also a map's output fed to the next map | refused: *needs 'n', … (it has value)* |
| `t, a, b` | `add_n[mod.collapse(initial=0)]`, `joined[mod.auto()]`, `joined[mod.collapse()]` | refused |
| `t, a, b` | `double[mod.auto()](wf["r"][cols[["a","b"]]])` | refused: *a selection can't be a tool's input* |
| `a, b` from step `t` | `addk(wf["r"], k=wf["t"][cols[["a","b"]]])` | refused: *is a block* |

In the app: `_bind_positional_resources` binds **resources** by type, but
refuses when more than one parameter fits. The panel (`ToolEditor`) and
`partsForTool` don't choose columns. Two findings from the same run feed
other rules:

- `first` and `gather` collapses put `#r` among the **data cells** of their
  output. That's evidence for R3.
- `total[mod.collapse()]` on `t, a, b` returns `None` in every column, with
  no error, where `a` and `b` are summable. That breaks "never silently
  `None`" and is a core ask.

---

## 3. Phases

The order is chosen so that what users see stops being wrong before anything
new is added.

### P0 — Make the record match the code (no behaviour change)

| # | Work | Where |
|---|---|---|
| P0.1 | Fix `test_select_cell`'s read (`result.iloc[0, 0]`). The selection is right and the test reads it wrong (§1.4.7). **Needs the owner's OK** under CLEANUP | `tests/test_tabular_selection.py` |
| P0.2 | Remove `step1["score"]` from the console help. Update its test and the old comment | `frontend/src/types/commands.ts`, `commands.test.ts`, `utils/formulaParser.ts` |
| P0.3 | Mark 120 §2.1, §2.4 and §2.5 as superseded by this plan, and update the README's one-line summary | `docs/dev_plan/120-…`, `README.md` |
| P0.4 | Change "Known red" in `docs/context.md` to name the real cause | `docs/context.md` |

### P1 — Rows are positions; `#` is `0..n-1` (R1)

| # | Work | Where |
|---|---|---|
| P1.1 | Raise the core ask with §1.2 as evidence: `#` is the position, and every plain integer form selects by position | `docs/core-proposals/008-core-changes.md`, a probe in `scripts/core_probes/` |
| P1.2 | Until core lands: the grid shows core's `position` as `#`, and the parser writes a single `[i]` as the range `i:i+1` (`SHIM(core §C7)`). Lists of rows wait for core | `core_bridge.py`, `DataOutputGrid.tsx` |
| P1.3 | Picks write positions (`selectionText`), and `referenceBoxes` draws by position | `frontend/src/utils/selection.ts` |
| P1.4 | Retire `rows["…"]` text ids. Rewrite saved formulas that use them or a plain id, print each change, and fail on anything ambiguous | a one-off script; `examples/`, `tests/fixtures/` |

### P2 — Lineage columns (R2)

| # | Work | Where |
|---|---|---|
| P2.1 | Probe what core puts in `#<step>` for filter, sort, collapse, distinct, expand, join and stack, by running it (126's D8 table is the starting point) | `scripts/core_probes/` |
| P2.2 | Core ask: `#<step>` holds positions in that step: one, a list, or `i.j` for an expansion | `008-core-changes.md` |
| P2.3 | The grid shows one expander per `#<step>`, collapsed by default | `DataOutputGrid.tsx` |

### P3 — `#` columns are never data (R3)

| # | Work | Where |
|---|---|---|
| P3.1 | Check by running whether core lets `#` or `#<step>` be selected, bound or named in a setting | `scripts/core_probes/` |
| P3.2 | The parser refuses `cols["#…"]` and a setting naming a `#` column; core is asked to refuse binding them | `operation_formula.py`, `008-core-changes.md` |
| P3.3 | Clicking a `#` cell picks the row, never the `#` column | `utils/selection.ts` |

### P4 — Column names (R4)

| # | Work | Where |
|---|---|---|
| P4.1 | Core ask: unnamed and numeric names become `var<n>` where a step produces its output. This extends C7's "names are strings" rule | `008-core-changes.md` |
| P4.2 | Until then, the same rule where the app hands data to core (`engine.values`), tagged as a shim | `core_bridge.py` |

### P5 — Every spelling accepted (R6)

Each form is run through core before the parser accepts it.

| # | Form | Today |
|---|---|---|
| P5.1 | negative rows: `[-1]`, `[-3:]` | refused |
| P5.2 | columns by position: `cols[1]`, `cols[0:3]`, `cols[[0, 2]]` | refused |
| P5.3 | one-bracket pair, either order: `[1:5, cols["a"]]`, `[cols["a"], 1:5]` | refused |
| P5.4 | `rows[…]` around any row form | text ids only |
| P5.5 | The formula is saved and shown as written; nothing reprints it in another spelling | `format_parts` |

### P6 — Arguments (R5)

| # | Work | Where |
|---|---|---|
| P6.1 | The parser refuses rows and blocks as arguments as you type, with core's message (subject to Q4) | `operation_formula._argument` |
| P6.2 | A step whose output is one cell or one column is marked so in its header, and hovering `wf["s"]` shows the value or column it passes | `DataOutputGrid.tsx`, `FormulaEditor.tsx` |
| P6.3 | Selection arguments travel as typed `{"$ref", rows, columns}`, retiring `{"$expr": …}` | `operation_formula.py`, `formulaParser.ts`, `ToolEditor.tsx` |

### P7 — Selection as input (R7)

| # | Work | Where |
|---|---|---|
| P7.1 | Core ask: accept `tool(wf["r"][0:5])` as the tool applied to the selection, in Python and in JSON (closes C20) | `008-core-changes.md`, `009` §7 |
| P7.2 | When it lands, remove `_reject_column_ref` | `operation_formula.py` |

### P8 — Row alignment (R8, R9)

| # | Work | Where |
|---|---|---|
| P8.1 | A step that maps row by row with arguments from steps whose lineage differs is refused, and the message points to `join`, `zip_` or merge | core ask; `operation_formula.py` until then |
| P8.2 | Turn the §2.3 Q1 table into TEST-SEL-010, and add the owner's case if one turns up | `tests/` |

### P9 — Writing references without remembering the syntax

| # | Work | Where |
|---|---|---|
| P9.1 | Autocomplete: `wf["` → earlier step names; `cols["` → that step's columns, with no `#` columns | `FormulaEditor.tsx`, `shell/monacoSetup.ts` |
| P9.2 | Hover on a reference: the step, the rows, the column names, and what the tool will receive (a value, a list, a frame) | `FormulaEditor.tsx`, `/api/parse_formula` |
| P9.3 | A usage page with every form and a picture of what each selects | `docs/usage_docs/` (bundled) |

---

## 4. Requirements

| ID | Requirement |
|---|---|
| REQ-SEL-001 | Every step's `#` is `0..n-1` over its current output. |
| REQ-SEL-002 | Every plain integer row form (`[i]`, `[[i, k]]`, `[i:j]`, `[-1]`) selects by position, as a Python list does. |
| REQ-SEL-003 | Each step has one `#<step>` column per step its rows came from, holding a position, a list of positions, or `i.j`. |
| REQ-SEL-004 | `#` and `#<step>` can't be selected as columns, bound to a parameter, passed as an argument or used in a setting. |
| REQ-SEL-005 | Column names are unique strings; unnamed and numeric names become `var<n>`; a duplicate is refused. |
| REQ-SEL-006 | A tool argument is a literal, a cell selection or a resource; a one-cell or one-column step is passed whole by `wf["s"]`. |
| REQ-SEL-007 | Every spelling in R6 is accepted and saved as written. |
| REQ-SEL-008 | A selection can be a tool's input (once core supports it). |
| REQ-SEL-009 | Reading rows from steps whose lineage differs requires an explicit join, zip or merge. |
| REQ-SEL-010 | Auto never binds a column chosen by type. |
| REQ-SEL-011 | The dashed reference box covers exactly the cells the formula reads. |
| REQ-SEL-012 | No retired reference form appears in help, autocomplete, examples or messages. |

## 5. Tests

| ID | Checks | Covers |
|---|---|---|
| TEST-SEL-001 | After a sort, a filter and an expand, `#` is `0..n-1` | REQ-SEL-001 |
| TEST-SEL-002 | On a sorted step, `[1]`, `[[1]]`, `[1:2]` and `rows[1]` select the same row, the second on screen | REQ-SEL-002 |
| TEST-SEL-003 | Lineage after filter, collapse, expand (`i.j`) and a join of two steps | REQ-SEL-003 |
| TEST-SEL-004 | `cols["#"]`, a parameter named like `#r`, and `by="#r"` are refused | REQ-SEL-004 |
| TEST-SEL-005 | A tool returning two unnamed values, and columns `0` and `"0"`, give `var0`, `var1` | REQ-SEL-005 |
| TEST-SEL-006 | A one-cell step passes its value and a one-column step passes a list; a row is refused | REQ-SEL-006 |
| TEST-SEL-007 | Each R6 spelling of one block selects the same cells and reopens unchanged | REQ-SEL-007 |
| TEST-SEL-008 | `double(wf["r"][0:2])` gives the two rows doubled | REQ-SEL-008 |
| TEST-SEL-009 | A map reading a filtered step and its unfiltered source is refused; after a join it runs | REQ-SEL-009 |
| TEST-SEL-010 | The §2.3 Q1 table, kept as a regression test: every case is refused by name, and none binds a column chosen by type | REQ-SEL-010 |
| TEST-SEL-011 | `referenceBoxes` for each row form equals the rows core returns | REQ-SEL-011 |
| TEST-SEL-012 | A grep for `step1`, `=Step`, `.map(` and `rows["` in help, examples and the bundle finds nothing | REQ-SEL-012 |
| TEST-SEL-013 | `test_select_cell` passes with the corrected read (P0.1) | — |

## 6. Asks for core

| # | Ask | Evidence |
|---|---|---|
| — | `#` is the position, `0..n-1`; every plain integer row form selects by position (C7) | §1.2, run 2026-11-01 |
| — | `#<step>` holds positions: one, a list, or `i.j` after an expansion | P2.1, to be probed |
| — | `#` columns are never bound, selected or used in settings | P3.1, to be probed |
| — | Unnamed and numeric column names become `var<n>` | §1.3: today `0` becomes `"0"` |
| — | A selection as a tool's input, in Python and in JSON (replaces C20's "refuse") | §1.3; 009 §7 |
| — | A column argument from a step aligned with the input (e.g. a map of it) pairs row by row, as the input's own columns already do | R8, §2.1a |
| — | A column argument means the same thing whatever the parameter's type: per row in a row-by-row step. A whole column is passed only when written as one (Q5) | R11, §2.1a |
| — | A block argument binds by name when its columns match the parameter names | R5 |
| — | `#<step>` never appears among a collapse's data cells | §2.3 (`first`, `gather`) |
| — | `total` on mixed columns fails, or sums what it can; never all `None` silently | §2.3 |
| — | C7's negative rows, column positions and one-bracket pairs | P5, to be probed |

## Progress

| Date | Item | Done | Confirmed |
|---|---|---|---|
