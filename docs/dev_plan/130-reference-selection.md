# 130 — Selecting data from earlier steps

**Status:** proposed (2026-11-02). Nothing here is built yet. **The design**
(object model, definitions, ruleset) and the core work are in
[`docs/core-asks/`](../core-asks/README.md). This page is the evidence and
decisions behind it (§1–§2, §7) and the app-side work (§3–§5).

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

## 0. The model and the ruleset

**Moved to [`docs/core-asks/model.md`](../core-asks/model.md)** (2026-11-02),
with the core work and its tests in [`plan.md`](../core-asks/plan.md) and
[`probe.py`](../core-asks/probe.py) beside it. That folder is the one to
hand to core. Everything below is the history and evidence behind it, and the
app-side work.

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
| **R6** | **Many ways to write a selection,** all accepted and saved as written. The accepted equivalents are listed in §7.6a |
| **R7** | **A selection can be a tool's input, as shorthand:** `double(wf["r"][0:5])`. Core should support it directly (§6); the app doesn't fake it with a hidden step |
| **R8** | **Pairing rows across steps needs proof they line up.** When a step maps row by row and its arguments read rows from more than one step, the rows must be clearly aligned: lineage shows they're the same rows in the same order (e.g. a chain of maps with no filter, sort, expand or collapse between them). Otherwise the user must `join`, `zip_` or merge the steps first. This applies to the input and to the arguments |
| **R9** | **Auto never picks a column by type.** It binds by name; anything ambiguous is refused, naming the columns |
| **R10** | **A reference passes values, not names.** A tool argument that is a reference receives the data it points at. A tool doesn't receive a column's or step's *name* to look up for itself (`top_n(df, column="n")` is the pattern to move away from). Column names as strings stay only in modifier settings (`by=`, `columns=`) |
| **R11** | **What the user sees is what the tool gets.** The worst outcome is a user who thinks a step processes one selection while it processes another. The same reference text must never mean different data depending on something the user can't see (a parameter's type, run state, which step is the input) |
| **R12** | **Data and lineage are kept apart, and the header says which is which** (owner, 2026-11-01). An output has three regions: `#` (the row's position), **lineage** (`#<p>` columns) and **data** (named columns). A name starting with `#` is lineage, and nothing else; a data name never starts with `#`. Tools see only data. Lineage becomes data only through one explicit step the user writes, `rename(columns={"#r": "parent"})`, after which it's an ordinary data column. Each data column's header shows what the step did with it: read by the tool (bound to a parameter), produced by the step, or passed through |
| **R13** | **Rows can be picked by a condition, on data or on lineage** (owner, 2026-11-01). A condition goes in the row slot of a reference: `wf["split"][lineage["r"] == 3]`, `wf["r"][(cols["n"] > 15) & (cols["ward"] == "A")]`. `lineage["p"]` reads the `#p` column; `cols["x"]` reads a data column. The condition only chooses rows; lineage still never reaches a tool. The same thing as a setting: `select(where=…)` |
| **R14** | **Each step's own row number is named after the step, and lineage holds row references only** (owner, 2026-11-02). Step `split`'s output reads `#r \| #split \| value`: parents' row numbers first (`#r`, `#other`, …, collapsible in the grid), then the step's own `#split` (`0..n-1`), then the data. So the name a child uses for a parent's rows, `#split`, is the name the parent shows. Parent **data** is never copied automatically; the user copies it when needed (usually from one parent) with a join on the lineage column (B4) |

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
- **`zip_` of steps that don't line up gives a wrong answer silently.**
  `zip_(wf["doubled"], wf["filtered"])` (4 rows and 3) returns one row
  holding null, with no error. Workflow 07, step `zipped_unaligned`, which
  walks every step that changes the rows.

### 2.2 What these change

- R1 reverses my earlier recommendation of ids for picks. A pick by position
  can read a different row after an upstream filter changes. The dashed box
  and the hover (P9) show what it reads now, and the step goes stale when its
  source re-runs.
- R1 and R2 change what core's `#` means. Today `#` holds row ids (§1.2).
  This needs core (§6). Until then the app can show core's `position` as
  `#`, since `k.view` already returns it, but it can't change what `[1]`
  selects. Only single rows can be shimmed (as `{start: i, stop: i+1}`).
- **A row id is the chain of lineage positions back to the source**
  (owner, 2026-11-01). Core's id `3.0` in a filter → expand chain is "item 0
  of `filtered` row 2, which is `r` row 3", compressed. So `#` can be the
  position alone: the id is derivable from the `#<p>` columns, and core may
  keep ids internally for its own work (`zip_(…, match_ids=True)`, tracing).
- A non-rectangular pick still writes nothing.

### 2.3 Answers (owner, 2026-11-01)

| | Question | Answer |
|---|---|---|
| **Q1** | Where does auto bind the first column of the right type? | **Not reproduced.** Every case below was refused by name, in core and through the app's paths. Still open: the owner's own example |
| **Q2** | `var0` already exists when `0` is renamed | Refused: column names are unique (R4) |
| **Q3** | Does R8 cover arguments? | Yes, when the step maps row by row and its arguments read rows from more than one step (R8) |
| **Q4** | A block or table as an argument | Yes, when the parameter takes a `DataFrame` or the block's column names match the parameter names (R5) |
| **Q5** | In a row-by-row step, how does a user pass a **whole column** as a list, if a column reference means "this row's value" (R11)? | **Open.** Recommended: from a cell that holds the list, e.g. a `gather` step referenced as one cell, so the reference always shows what arrives. Alternatively an explicit marker on the reference |
| **Q6** | R3 forbids `collapse(by="#r")`, which is today's only way to undo an expand (one row per parent). What replaces it? | **Open.** E.g. a collapse that names the parent step instead of a column. Workflow 07, step `back_to_parent` |
| **Q7** | Does a one-to-one step (map, rename) carry its parent's `#<step>` columns forward? Today it does | **Open.** Workflow 07, step `expanded_n` |

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

### 2.4 Conceptual tensions

Where two rules pull against each other. Each resolution is a
**recommendation for the owner to confirm**; nothing is decided until it's
marked confirmed.

| # | Tension | Recommended resolution | Confirmed |
|---|---|---|---|
| T1 | **Positions drift; noticing it needs ids.** `wf["filtered"][0]` reads "the first row now". If upstream data changes it reads another row without an error (R1 vs R11). Telling the user means remembering which row was meant, which is an id | Ids stay inside core and are never shown or written. Picks write positions. When a re-run puts a different row at a referenced position, the step is flagged **"reference moved"**. For a reference that must follow a row, write a condition (R13) | — |
| T2 | **An inferred verb hides what a column argument means.** In `tool(wf["r"], k=wf["r"][cols["n"]])`, core infers the verb from the tool's signature: `map` gives `k` per row, a collapse or table step gives the whole column. The text doesn't say which (R11) | When a step has a column argument, the inferred verb is written into the formula (`tool[mod.map()](…)`); at minimum the formula bar shows it | — |
| T3 | **Lineage values have three shapes:** one position (filter), a list (collapse), `"i.j"` (expand). A condition like `lineage["r"] == 3` then needs a special case per step kind | `lineage["p"]` always means the parent position(s): `== 3` and `.isin` work everywhere. The item number within an expanded cell is separate, `lineage["p"].item` | — |
| T4 | **Lineage is one hop, but combining several steps should keep every source** (owner, 2026-11-01: a goal). `stack(a, b, c)` already gives `#a`, `#b`, `#c`. `join` takes two steps, so three need a chain, and the chain loses the first two: `join(join(r, other), third)` has `#j2`, `#third`, not `#r`, `#other` | **Combines are transparent in lineage:** a join, stack or zip adds one `#<p>` per input, and when an input is itself a combine, its lineage columns are carried forward instead of a column for the intermediate step. `join(wf["j2"], wf["third"])` then has `#r`, `#other`, `#third`. Other steps (filter, expand, collapse) stay one hop. A `join` of more than two steps is a convenience on top | owner, 2026-11-01 |
| T8 | **The same source reached twice.** `join(wf["r"], wf["filtered"], on=…)`: the direct `#r` and the `#r` carried from `filtered` would clash, as would a self-join | Number them by input order, `#r` and `#r.2`; the header shows which input each came from | owner, 2026-11-01 |
| T5 | **A selection as input is two operations in one step.** `double(wf["r"][0:2])` is a select plus a map, against "one shape verb per step" | The selection is part of the reference, not a verb. The step's lineage points straight at `r` (positions 0, 1), with no hidden step | — |
| T6 | **Binding by name means renames.** A column `price` and a parameter `n` need a rename step first | Keep binding by name, never by type. The refusal offers to insert the rename step | — |
| T7 | Minor: `sort(by="#")` and `collapse(by="#")` are no-ops; a promoted `parent` column can't be joined back to `#` (needs B4); a `"0"` column shown as `var0` | Allow the no-ops; B4 covers the join; the `var<n>` message names the original | — |

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

> **Superseded as a work plan by
> [`docs/core-asks/plan.md`](../core-asks/plan.md)** (2026-11-02):
> the same asks as milestones M0–M6 with IDs L1–L43 and a test for each. The
> table below is kept for its evidence.

Grouped by what they fix. Evidence is a step in `scripts/ui_status`
workflow 06 or 07 (run 2026-11-01) unless stated. Priority: **1** wrong
result with no error, **2** blocks a rule, **3** convenience.

**Rows and `#`**

| # | Ask | Pri | Evidence |
|---|---|---|---|
| A1 | `#` is the row's position, `0..n-1`, in every output | 2 | 07 `filtered`, `sorted`, `distinct`, `expanded`, `collapsed_by` |
| A2 | Every plain integer row form (`[i]`, `[[i, k]]`, `rows[i]`) selects by position, as ranges already do (C7) | 1 | 06 `pick_row`, `pick_list`, `one_cell` |
| A3 | Negative rows (`[-1]`, `[-3:]`), `rows[…]` around any row form, and text row ids retired | 3 | 06 `last_row` |

**Lineage**

| # | Ask | Pri | Evidence |
|---|---|---|---|
| B1 | `#<p>` holds positions in `p`: one (filter, slice, sort, select), a list (collapse, distinct), `"i.j"` (expand) | 2 | 07 `expanded`, `stacked`, `filter_then_expand` |
| B2 | Lineage is not data: `k.view` returns it apart from data columns; whole-step references and `select` exclude it; a tool never receives it. Settings may still name it (`by="#r"`) | 2 | 06 `lineage_as_data`; 07 `first_per_ward`, `joined` |
| B3 | One-to-one steps (map, rename, select columns) don't carry the parent's lineage | 3 | 07 `expanded_n` |
| B4 | `join(child, parent, on="#parent")` matches the child's `#parent` to the parent's `#` | 2 | 07 `parent_data` |
| B5 | Combines are transparent in lineage: a join, stack or zip of a combine carries that combine's lineage columns forward (T4); clashing sources are numbered `#r`, `#r.2` (T8) | 2 | 07 `join_chain` |
| B6 | `join` of more than two steps, `join(wf["a"], wf["b"], wf["c"], on=…)`, with one lineage column per input | 3 | refused: *join() takes 2 positional arguments* |

**Selecting rows by condition**

| # | Ask | Pri | Evidence |
|---|---|---|---|
| C1 | `select(where={…})`: rows by equality on data or lineage columns | 2 | 07 `rows_where_setting` |
| C2 | Conditions in the row slot: `lineage["p"]`, `cols["x"]`, comparisons, `.isin`, `.contains`, `&`, `\|`, `~`; `lineage` reserved like `rows` and `cols` | 3 | 07 `rows_from_parent`, `rows_by_condition` |
| C3 | Columns by position (`cols[0]`, `cols[0:2]`), counting data columns only; one-bracket pairs (`[1:3, cols["n"]]`) | 3 | 06 `one_bracket` |

**Pairing rows across steps**

| # | Ask | Pri | Evidence |
|---|---|---|---|
| D1 | A column argument from a step that **isn't** aligned with the input is refused (join or zip first). Today a filter of the input is paired by id, with a silent null and floats | **1** | 06 `unaligned_step` |
| D2 | `zip_` of steps that don't line up is refused. Today it returns one null row | **1** | 07 `zipped_unaligned` |
| D3 | A column argument from a step that **is** aligned (a map of the input) pairs row by row, as the input's own columns do | 2 | 06 `aligned_step` |
| D4 | A column reference means the same thing whatever the parameter's type: per row in a row-by-row step. Today `k: list` gets the whole column instead | **1** | 06 `own_column_as_list` |
| D5 | A selection as a tool's input, `tool(wf["r"][0:2])`, in Python and JSON (replaces C20's silent ignore) | 2 | 06 `selection_input` |
| D6 | A block argument binds by name when its columns match the parameter names | 3 | R5 |

**Column names and values**

| # | Ask | Pri | Evidence |
|---|---|---|---|
| E1 | Column names are unique strings; unnamed or numeric names become `var<n>`; a clash is refused | 2 | 06 `numeric_names` |
| E2 | A source whose data has a `#`-named key is refused. Today it gives one null row | **1** | H-D3a probe |
| E3 | `total` on mixed columns fails or sums what it can. Today every column is null | **1** | §2.3 |
| E4 | An int column stays int when a value is missing (a warning at least) | 3 | 07 `joined_left` |
| E5 | When an upstream edit removes a column a step binds or picks, that step is re-checked and marked `invalid` at once. Today it's `stale` with no problem until it runs | 2 | M7; run 2026-11-02 |
| E6 | A tool returning a dict gives one column per key. Today the dict stays in one `value` cell | 3 | M6; run 2026-11-02 |

Every ask also goes into
[008-core-changes.md](../core-proposals/008-core-changes.md) with the
probe that shows it, per the core-gap rule in `docs/context.md`.

## 7. The rulebook

Every rule about steps, expressions and data in one place. Each rule says
**where** it applies, **when** it's checked, and its **status** today, with
evidence: a step in `scripts/ui_status` workflow 06 or 07 (run 2026-11-01).

- **Hard** rules are enforced. Breaking one refuses the formula as you type,
  refuses the step when it's declared, or fails the step at run. They're
  never silently reinterpreted.
- **Soft** rules are guidance. Breaking one gives a warning or a UI hint, and
  the step still runs.

When it's checked: **typing** (the app's parser, `operation_formula.py`),
**declare** (core checks the step before running), or **run**.

### 7.1 Terms

| Term | Definition |
|---|---|
| **Workflow** | An ordered list of named steps. A step reads only steps before it |
| **Step** | A name, one expression, and the output it produces |
| **Expression** | One of: `=tool[modifiers](input, arguments)`, a selection `=wf["s"][…]`, or a literal `=7` |
| **Tool** | A function. Its parameters are what it reads |
| **Shape verb** | The modifier that decides how input rows map to output rows (`map`, `filter`, `expand`, `collapse`, `sort`, …). At most one per step |
| **Execution modifier** | `retry`, `timeout`. Changes how a call runs, never the row mapping |
| **Input** | The positional argument: the step (or selection) the step works over |
| **Argument** | A keyword inside `( )`: a value given to the tool |
| **Setting** | A keyword inside `mod.verb( )`: how the verb behaves (`by=`, `columns=`, `initial=`) |
| **Resource** | `res["x"]`: a live object (a model, a folder) a tool uses |
| **Output** | A table: rows × data columns, plus `#` and lineage columns |
| **Row** | One line of an output, addressed by its position |
| **Data column** | A named column of values. The only kind a tool or reference reads |
| **Cell** | One value at (step, row position, data column), with one state: known, pending, running, failed, null, absent, stale |
| **`#`**, written `#<step>` | A row's **placement**: its position in its own step's output, `0` to `n-1`. Step `split` names it `#split` (R14) |
| **Lineage column** `#<p>` | For each row, the placement(s) of the parent step `p`'s rows it came from, as they were when this step ran. References only, never the parent's data |
| **Row id** | Core's internal identity for a row, kept through filters and sorts (today `3`, `3.0`, `A`). Equivalent to the chain of lineage placements back to the source. **Never shown or written**; core uses it to align rows and to notice when a placement now points at a different row (T1) |
| **Index** | Avoided as a word in the UI and docs: pandas uses it for the row label, core today for the row id. Say **placement** (or row number) for `#<step>`, and **row id** for core's identity |
| **Reference** | `wf["s"]`, optionally with a selection: names cells of an earlier step |
| **Selection** | Rows (by position) × columns (by name): a rectangle |
| **One-to-one step** | Output row `i` comes from input row `i`, and only from it (map, rename, group labels, select columns) |
| **Aligned** | Steps A and B are aligned when A is B, or one reaches the other through one-to-one steps only. Row `i` of A then means row `i` of B |

### 7.2 Hard rules

**Steps**

| ID | Rule | Where | When | Today |
|---|---|---|---|---|
| H-S1 | Step names are unique, and a step reads only earlier steps | workflow | declare | MATCHES |
| H-S2 | One expression per step, with at most one shape verb | expression | typing | MATCHES |
| H-S3 | Every output is a table; a single value is a 1 × 1 table | output | run | MATCHES |

**Expressions**

| ID | Rule | Where | When | Today |
|---|---|---|---|---|
| H-E1 | The only reference is `wf["name"]`, optionally with a selection. A bare name or a string is never a reference | everywhere | typing | MATCHES |
| H-E2 | The input is written once, as the positional argument. Every verb except `source` and `sweep` needs one | `( )` | typing | MATCHES |
| H-E3 | Settings are literals: no reference, no resource. A setting **may** name a `#` column (`by="#r"`, `sort(by="#")`): reshaping reads lineage (owner, 2026-11-01) | `mod.verb( )` | typing | MATCHES (07 `back_to_parent`) |
| H-E4 | An argument is a literal, a resource, or a reference to data cells | `( )` keywords | typing | MATCHES |
| H-E5 | **Same text, same data.** What a reference passes depends only on what's written, never on a parameter's type, run state or anything else hidden (R11) | references | declare | **FIX**: 06 `own_column_as_list` |
| H-E6 | Every spelling of a selection is accepted and saved as written (R6) | selections | typing | **FIX**: 06 `one_bracket`, `last_row` |

**Data**

| ID | Rule | Where | When | Today |
|---|---|---|---|---|
| H-D1 | `#` is the integers `0` to `n-1`, where `n` is the step's row count | every output | run | **FIX**: 07 `filtered`, `sorted`, `distinct`, `expanded`, `collapsed_by` |
| H-D2 | Column names are unique strings, never numbers. Unnamed or numeric names become `var<n>`; a duplicate is refused | every output | run | **FIX**: 06 `numeric_names` |
| H-D3 | `#` and `#<p>` are never data. Reshaping verbs may read them through settings (H-E3); a tool never receives them; a selection or a whole-step reference never includes them. The one way out is an explicit rename to a data name (R12) | every output, tool calls, selections | typing, declare | **FIX**: lineage shows as data columns everywhere (06 `lineage_as_data`). The rename MATCHES (07 `lineage_to_data`) |
| H-D3a | **The `#` prefix is reserved for lineage.** A data column can't be named or renamed to start with `#` | every output | typing, run | rename MATCHES (*"names starting with '#' are core's id columns"*); a source with a `#n` key **FIX**: one null row, no error |
| H-D4 | A step that isn't one-to-one has one `#<p>` per parent. Each holds positions in `p`: one position (filter, slice, sort, select), a list (collapse, distinct), or `i.j` (expand) | non-one-to-one outputs | run | **FIX**: values are row ids, and `i.j` is in `#` (07 `expanded`, `stacked`, `filter_then_expand`) |
| H-D5 | A failure is never shown as a value. A missing pair, a failed call or an impossible sum is refused or marked failed, never a silent null | every cell | run | **FIX**: 06 `unaligned_step`, 07 `zipped_unaligned`, `total` (§2.3) |

**References and selections**

| ID | Rule | Where | When | Today |
|---|---|---|---|---|
| H-R1 | Row selectors are positions, as in a Python list: `[i]`, `[i:j]`, `[[i, k]]`, `[-1]` | selections | typing | **FIX**: `[i]` and lists are ids (06 `pick_row`, `pick_list`) |
| H-R2 | Columns are selected by name with `cols[…]`. A plain `["name"]` is refused, with the fix | selections | typing | MATCHES |
| H-R3 | A selection is one rectangle. Cells that don't form one are several references | selections | typing | MATCHES |
| H-R4 | A reference reads the referenced step's current output. When it changes, every step reading it goes stale | references | declare | MATCHES |
| H-R5 | **`#` is what rows are counted by.** `[2]` is the row whose `#` is 2. The `#` column itself is never selected | selections | typing | **FIX** (H-R1) |
| H-R6 | **Selections cover data only.** `wf["s"]`, a row, a block: data columns, never `#` or lineage | selections, references | declare | **FIX**: 06 `lineage_as_data` |
| H-R7 | **Column positions count data columns only.** `cols[0]` is the first data column; adding or dropping lineage never shifts it | selections | typing | **FIX**: `cols[0]` isn't parsed yet |
| H-R8 | **A selection step has its own `#` and lineage.** `=wf["s"][0:2]` gives `#` 0, 1 and `#s` pointing back | selection steps | run | **FIX**: today it keeps `s`'s ids |
| H-R9 | **Equivalent forms select the same cells** (§7.6a). Different text for the same cells is fine; the same text for different cells is not (H-E5) | selections | typing | partly; see §7.6a |
| H-R10 | **A header selects its column's values, never its name.** Column names reach the step only through settings (`by=`, `columns=`); a tool that needs them takes the whole table as a `DataFrame` | grid, selections | typing | MATCHES |
| H-R11 | **A condition goes in the row slot and chooses rows.** It can't stand alone, go in the column slot, or be passed to a tool | conditions | typing | **FIX**: not parsed |
| H-R12 | **A condition reads only the step it selects from:** `wf["s"][cols["n"] > 3]` tests `s`'s own `n`. Testing another step's values means a `join` first (H-M3) | conditions | typing | **FIX**: not parsed |
| H-R13 | **A condition is a closed set of operations:** `==`, `!=`, `<`, `<=`, `>`, `>=`, `.isin([…])`, `.contains(x)` (for list lineage), `&`, `\|`, `~`, brackets, and literals. No function calls and no other names: the parser reads it, it's never evaluated as Python | conditions | typing | **FIX**: not parsed |
| H-R14 | **`lineage["p"]` must name a step the rows came from.** After an expand, `lineage["r"] == 3` means parent row 3 (the `i` of `i.j`); after a collapse use `.contains(3)` | conditions | typing, declare | **FIX**: not parsed |
| H-R15 | **A condition that matches no rows fails the step**, naming the condition. It's re-checked on every run, so it follows the rows it describes when their positions change | conditions | run | **FIX**: not parsed |

**Mapping: what data reaches the tool**

| ID | Rule | Where | When | Today |
|---|---|---|---|---|
| H-M1 | The input's data columns bind to the tool's parameters **by name**. Never by type; a missing name is refused, naming the columns there are | input | declare | MATCHES (§2.3, Q1) |
| H-M2 | What a reference argument passes is fixed by its kind (§7.5) | arguments | declare | partly; see §7.5 |
| H-M3 | Row `i` of one step is paired with row `i` of another **only** when they're aligned. Otherwise it's refused, pointing to `join` or `zip_` | arguments, combines | declare | **FIX**: aligned refused (06 `aligned_step`); not aligned paired silently (06 `unaligned_step`) |
| H-M4 | `zip_` needs aligned steps; `join` pairs rows by a column's values | combines | declare | **FIX**: 07 `zipped_unaligned` |

### 7.3 Soft rules

| ID | Rule | Where | How it shows |
|---|---|---|---|
| S-1 | **Pass values, not names.** A tool should read data through its parameters, not take a column or step name to look up itself (R10) | tool authoring | a catalog warning on a `str` parameter named like `column`, `col`, `field` |
| S-2 | Reference a one-cell or one-column step whole, `wf["s"]` | arguments | the step's header says "1 cell" or "1 column"; hover shows what passes |
| S-3 | A row-by-row step should read rows from one step. Several aligned steps work, but an explicit `join` / `zip_` step first is clearer | arguments | a hint when a step pairs rows from more than one step |
| S-4 | A position reads a different row if the source's rows change. Prefer referencing steps whose order is fixed | selections | a warning on a position into a filter, expand or collapse output |
| S-5 | Types stay put: an int column doesn't become float because a value is missing | outputs | a warning on the column (07 `joined_left`: `pop` 1 → 1.0) |
| S-6 | A grid pick that isn't one rectangle writes nothing and says why | picking | the status bar |
| S-7 | Hover on any reference shows the cells it covers and what the tool gets (a value, a row's value, a list, a table) | formula bar | hover |
| S-8 | **The grid shows the three regions apart** (R12): `#` pinned left; lineage in its own collapsed band; data after. Each data header is marked: read by the tool (with the parameter it binds to), produced by this step, or passed through | grid header | always |
| S-9 | **Clicking a lineage cell highlights the parent rows** it points to; it never writes a reference | grid | click |

### 7.4 How rows map, step by step

Output row `i`, its `#`, and where it came from. Evidence: workflow 07.

| Step | Rows | Output row `i` is | `#` | Lineage | Today |
|---|---|---|---|---|---|
| `source` | 0 → n | row `i` of the data | `0..n-1` | none | MATCHES |
| `sweep` | 0 → product of the lists | combination `i` | `0..n-1` | none | MATCHES |
| `map` | n → n | the tool on input row `i` | `0..n-1` | none: one-to-one | MATCHES |
| `group` | n → n | input row `i` plus its key | `0..n-1` | none | MATCHES |
| `rename`, `select` / `drop` columns | n → n | input row `i` | `0..n-1` | none (Q7: carry the parent's?) | `#` carried from parent: **FIX** |
| `filter` | n → m ≤ n | the `i`-th kept row | `0..m-1` | `#p` = its position in `p` | **FIX** |
| `slice`, row selection | n → m | the `i`-th selected row | `0..m-1` | `#p` = position | **FIX** |
| `sort` | n → n | the `i`-th in the new order | `0..n-1` | `#p` = position | **FIX** |
| `distinct` | n → k | the first row of key `i` | `0..k-1` | `#p` = list of positions | **FIX** `#` |
| `collapse` (no key) | n → 1 | the tool over all rows | `0` | `#p` = all positions | MATCHES |
| `collapse(by=…)`, `gather` | n → k | the tool over group `i` | `0..k-1` | `#p` = list of positions | **FIX** `#` |
| `expand` | n → total items | item `j` of parent row `i`'s cell | `0..N-1` | `#p` = `"i.j"` | **FIX** |
| `stack(a, b)` | n + m | a's rows, then b's | `0..n+m-1` | `#a`, `#b`, empty on the other's rows | **FIX** `#b` values |
| `join(a, b, on=)` | by match | a matched pair | `0..k-1` | `#a`, `#b` | MATCHES (sources only) |
| `zip_(a, b)` | n + n → n | row `i` of a beside row `i` of b; only if aligned | `0..n-1` | none if aligned | aligned MATCHES; unaligned **FIX** |
| undo an expand | N → n | one row per parent | `0..n-1` | `#p` = list | MATCHES: `collapse(by="#r")` (H-E3) |
| bring a parent's data to its children | N → N | child row `i` with its parent's data columns | `0..N-1` | the child's | **FIX**: `join(wf["split"], wf["r"], on="#r")` is refused, *"'r' does not have '#r'"*. Should match the child's `#r` to the parent's `#` |

### 7.5 What a tool call receives

For each kind of value inside `( )`, what the tool gets on each call.

| Argument | Row-by-row step (`map`, `filter`, `expand`) | Group step (`collapse`) | Whole-table / `source` / `sweep` | Today |
|---|---|---|---|---|
| literal | the same value every call | same | same | MATCHES |
| `res["x"]` | the live object every call | same | same | MATCHES |
| one cell, or a 1 × 1 step | the value, every call | same | same | MATCHES (06 `one_cell`), but its row is an id (H-R1) |
| one column, **aligned** with the input | row `i`'s value | **OPEN** (Q8) | refused: no rows to pair | own column MATCHES; another aligned step **FIX** (06 `aligned_step`) |
| one column, **not aligned** | refused: join or zip first | refused | refused | **FIX**: paired silently (06 `unaligned_step`) |
| a whole column, as a list | **OPEN** (Q5) | **OPEN** (Q5) | the list | **FIX**: today it depends on the type (06 `own_column_as_list`) |
| one row | refused | refused | refused | MATCHES |
| a block or whole step | only if the parameter takes a `DataFrame` (the whole block every call), or its columns are named like the parameters and it's aligned (bound by name, row by row) | same | `DataFrame` only | `DataFrame` to verify; by-name **FIX** |

### 7.6 What can be written where

| Element | Input | Argument | Setting | Whole expression |
|---|---|---|---|---|
| `wf["s"]` | yes | yes (§7.5) | no | no: refused, write `wf["s"][:]` to copy |
| a selection `wf["s"][…]` | yes, as shorthand (R7; **FIX**) | a cell, an aligned column, or a block under §7.5 | no | yes: a select step |
| `res["x"]` | no | yes | no | no |
| a literal | no | yes | yes | yes: a 1 × 1 source |
| a column name as text (`"n"`) | no | discouraged (S-1) | yes (`by=`, `columns=`) | no |
| `#`, `#<p>` | no | no | yes, in reshaping verbs (`by=`, `on=`) | no |
| a condition (`lineage["p"] == 3`, `cols["n"] > 15`) | only in a selection's row slot | only in a selection's row slot | as `select(where=…)` | only in a selection's row slot |

### 7.6a Equivalent forms

Each line selects the same cells. The **canonical** form is what a grid pick
writes and what the hover shows: rows first, then `cols[…]`, two brackets.
Every form listed is accepted and saved as the user wrote it. Anything not
listed is refused with the canonical form as the fix.

| Selects | Canonical | Also accepted | Today |
|---|---|---|---|
| the whole step | `wf["s"]` (as input or argument) | `wf["s"][:]`; as a whole expression only `wf["s"][:]` (a copy) | MATCHES |
| one row | `wf["s"][2]` | `wf["s"][[2]]`, `wf["s"][2:3]`, `wf["s"][rows[2]]` | `[2]`, `[[2]]`, `rows[2]` parse but read ids: **FIX**; `[2:3]` MATCHES |
| the last row | `wf["s"][-1]` | `wf["s"][rows[-1]]` | refused: **FIX** |
| a run of rows | `wf["s"][1:3]` | `wf["s"][rows[1:3]]` | `[1:3]` MATCHES; `rows[1:3]` refused: **FIX** |
| scattered rows | `wf["s"][[0, 2]]` | `wf["s"][rows[[0, 2]]]` | both parse but read ids: **FIX** |
| one column | `wf["s"][cols["n"]]` | `wf["s"][cols[["n"]]]`, `wf["s"][cols[0]]` (by position) | names MATCH; positions refused: **FIX** |
| several columns | `wf["s"][cols[["a", "b"]]]` | `wf["s"][cols["a":"b"]]` when they're adjacent (names inclusive); `wf["s"][cols[0:2]]` (positions, half-open) | names MATCH; positions **FIX** |
| a cell | `wf["s"][2][cols["n"]]` | `wf["s"][cols["n"]][2]`, `wf["s"][2, cols["n"]]`, `wf["s"][cols["n"], 2]`, `wf["s"][rows[2], cols["n"]]` | two brackets MATCH (row is an id: **FIX**); one bracket refused: **FIX** |
| a block | `wf["s"][0:2][cols[["a", "b"]]]` | the same orders and one-bracket forms as a cell | as for a cell |
| a selection as a whole step | `=wf["s"][0:2][cols["n"]]` | `=identity[mod.select(rows={"start": 0, "stop": 2}, columns=["n"])](wf["s"])` | MATCHES |
| rows from a parent row | `wf["split"][lineage["r"] == 3]` | `=identity[mod.select(where={"#r": 3})](wf["split"])` | refused: **FIX** |
| rows from several parent rows | `wf["split"][lineage["r"].isin([1, 3])]` | `select(where={"#r": [1, 3]})` | refused: **FIX** |
| rows by a data value | `wf["r"][cols["ward"] == "A"]` | `select(where={"ward": "A"})` | refused: **FIX** |
| rows by a combined condition | `wf["r"][(cols["n"] > 15) & (cols["ward"] == "A")]` | none: `where=` takes equality only; anything richer is written as a condition | refused: **FIX** |
| matching rows, some columns | `wf["split"][lineage["r"] == 3][cols["value"]]` | `select(where={"#r": 3}, columns=["value"])` | refused: **FIX** |

**Not equivalent, by design:**

| Form | Why it's different or refused |
|---|---|
| `wf["s"]["n"]` | Refused: a plain bracket is always rows. The fix: `wf["s"][cols["n"]]` |
| `wf["s"]` as a whole expression | Refused: a reference isn't a step. The fix: `wf["s"][:]` |
| `wf["s"][rows["A"]]` | Retired: text row ids (R1). The fix: the row's `#` |
| `[-1]` vs `[3]` on a 4-row step | Same cells today, different tomorrow: `[-1]` follows the last row as rows change, `[3]` stays at position 3. Both are allowed; they mean different things |
| `cols["a":"c"]` vs `cols[0:2]` | Names are inclusive, positions half-open (as pandas `.loc` / `.iloc`). The hover shows the resolved names |

### 7.6b How the selection rules fit together

1. A reference names **data**: rows by `#`, columns by name or data position.
2. Lineage is never selected. It's read by reshaping settings, shown in the
   grid, or promoted by one explicit rename.
3. Any listed spelling is fine; the pick and the hover always show the
   canonical one, so two people reading the same step see the same thing.

### 7.7 Answers (owner, 2026-11-01)

| | Answer | Status |
|---|---|---|
| Q5 | A row-by-row step over cells that hold lists broadcasts the tool over each list's items (with `auto`) | **Not what core does.** `double` (`n: int`) on a `gather` step, with `auto`, implicit or `map`: refused, *"double() declares n: int, but 'g' has n as object"*. Today the spelling is expand → map → collapse(by="#…"). Open: whether `auto` should broadcast, which is a verb chosen by type (R9, H-E5) |
| Q6 | Settled by H-E3: `collapse(by="#r")` stays, since a setting may name a `#` column | MATCHES |
| Q7 | One-to-one steps don't carry lineage; the user can trace further back on request (the inspector) | **FIX**: today they carry it (07 `expanded_n`) |
| Q8 | A `collapse` groups by `#` columns or by data columns; with no key it collapses the whole selection to one row. An aligned column argument follows the same groups | to probe |

## Progress

| Date | Item | Done | Confirmed |
|---|---|---|---|
