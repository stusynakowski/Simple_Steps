# Specification: Output state and wiring in the grid

How a step's grid shows **what state its output is in** and **what maps to
what** — which cells a selection was made from, which cells use it, and how
rows line up across steps. Built on core's step output model
([core 009](../../external/simple-steps-core/docs/core-proposals/009-step-output-model.md),
pin `b9f66d5` or later): results only, row ids shared between steps, a state
per cell, data-hash versions.

The working mockup is the "Cell State Mockup" artifact. It predates §8 (the
selection popover) and still shows the earlier double-click strip.

Implementation order: [dev_plan/124](../archive/dev_plan/124-core-009-integration.md).
Core integration comes first; this spec builds on it.

## The problem

While orchestrating, a person asks three questions. Every requirement below
exists to answer one of them quickly, without hiding the data.

1. **Did my orchestration work as expected?** Did the map, filter, expand or
   group do what I meant, to the rows I meant? (§2, §4.3, §8)
2. **Did I get the output for every cell?** Which cells ran, which failed,
   which never ran, and why? (§4)
3. **When I change something, what consequences didn't I consider?** What
   goes out of date, what breaks, what changes shape, before I run it? (§4.4)

The app can show that a cell **ran without error**, not that its value is
**correct**; correctness needs an expectation (core's `mod.expect`, the
examples' checks) and is out of scope here.

## 0. Principles

1. **The data is just the data.** Nothing is added to the grid's rows or
   columns to explain it.
2. **The grid gets no new controls.** State is said by marks on what is
   already on screen: cells, row numbers, column headers, step headers, the
   run icon and the status line. Controls live only on the **selection
   popover** (§8), which exists only when asked for.
3. **Quiet at rest.** A current, healthy workflow looks like plain data.
   Marks appear only when they are true. Wiring appears only when asked for:
   from the popover's toggles, or while a formula is being edited.
4. **Each visual channel has one meaning** (§3), so marks can stack on a
   cell without contradicting each other.
5. **Argument values are never shown as if they were output.** Expressions
   name *where* an input comes from, not its value.

## 1. Words

| Word | Means |
|---|---|
| **step** | one formula and its output grid |
| **cell** | one value of a step's output, at a row and a column |
| **selection** | a cell, row, column, block, scattered picks, or the whole table |
| **row id** | the name tag a row carries; shown in the row-number column |
| **reference** | a formula's `wf["…"]` part, optionally narrowed to rows, columns or a cell |
| **argument** | the parameter a reference is passed as (`n`, `weight`, `input`) |
| **wiring** | the references between steps, and the cells they connect |
| **popover** | the framed, enlarged view of a selection (§8) |

## 2. Row ids: how rows map between steps

**A row id is a name tag.** Every row of every step wears one. Two rows in
different steps belong together when they wear the **same tag**, or when
one tag is the **child** of the other (`1.0` is a child of `1`). That is the
whole of row mapping; nothing is matched by position or by value.

What each kind of step does with the tags:

```
map / filter / sort / select — keeps the tags it reads
  readings        score = score(n)          big = filter(score)
  [0] SF  1   →   [0] 1.5               →   (0 dropped)
  [1] NYC 2   →   [1] 3.0               →   [1] 3.0
  [2] LA -1   →   [2] failed            →   [2] blocked
  [3] SF  3   →   [3] 4.5               →   [3] 4.5
  "score row 1 came from readings row 1" because both wear tag 1.
  A filter leaves gaps in the tags; it never renumbers.

expand — makes child tags
  readings        items = expand(n)
  [1] NYC 2   →   [1.0] 0
              →   [1.1] 1               both children of 1
  [2] LA -1   →   (no children)

collapse / source / table / sweep — make new tags
  readings        totals = collapse(by=city)
  [0] SF          [SF]  4               new tags: the group key
  [3] SF   ─┘
  [1] NYC  →      [NYC] 2

a single value (a one-cell reference) — no tags involved
  weights [0] w=2  →  every row of score   (broadcast: one value, all rows)
```

Consequences the UI relies on:

- Any result cell can find its input cells through the tag alone. Nothing
  about the input is stored with the result.
- A step that reads two others row by row (`zip_`) pairs them by tag. If a
  tag has no partner, core fails the step rather than dropping the row.
- Positions (0, 1, 2…) are what a person clicks and what a saved selection
  remembers; tags are what keeps rows lined up when an earlier step
  re-runs.

## 3. Visual channels

| Channel | Means | Never used for |
|---|---|---|
| **Shade** (a data cell's fill) | the cell's **state** (§4) | selection, wiring, index |
| **Box** (an outline around cells) | **selection** (dark, §6) and **wiring** (step colour, §7) | state |
| **Moving dashed line** | **flow** between the popover and the cells it came from or feeds (§8) | anything at rest |
| **Mark and weight** (corner mark, dot, bold, greyed text) | **recency**: just ran, changed, out of date (§4) | wiring |

Row numbers and column headers are not data cells: they may be shaded to
show the active row and column (§6).

## 4. Output state

### 4.1 Cell states

- **REQ-VIS-001:** each data cell is drawn from core's per-cell state
  (`wf.preview`, `wf.cell`), as follows. A cell carries exactly one shade;
  recency marks are added on top.

| State | Shade and border | Shows |
|---|---|---|
| current (`known`) | none | the value |
| staged (`pending`) | light blue, grey dashed border | the type it will give (`float`), never an invented value |
| staged, may be filtered out (`maybe`) | paler blue, lighter dashed border | the type |
| failed | faint red | the error's kind (`ValueError`) |
| blocked (an input cell failed) | red border, no fill | `blocked` |
| invalid (the step can't run) | the step shows one placeholder row with the reason | — |

- **REQ-VIS-002:** a staged step whose row count isn't known yet shows one
  placeholder row at the bottom with core's marker text (`‹rows unknown — …›`,
  `‹0–4 rows — …›`). A step that may have more columns shows one placeholder
  column (`‹+ maybe more columns›`).

### 4.2 Recency marks

- **REQ-VIS-003:** values produced by the step's most recent run are
  **bold** until the next run of any step, or until the user selects
  something in another step.
- **REQ-VIS-004:** a cell whose value differs from the step's previous run
  gets a small blue **dot**. The dot means *changed* wherever it appears: on
  a cell (its value changed) or on an argument (its input changed,
  REQ-VIS-025). The previous value is shown in the popover header as
  "Was …". The dot clears when the step next runs or when an input changes.
- **REQ-VIS-005:** a cell of an **out-of-date** step (something it read has
  changed since it ran) keeps its value, gets a **grey corner mark**, and
  its text is slightly greyed. Out-of-date data is never hidden or deleted.
  Its state line says only that an input changed and to re-run; it does not
  name the argument, so the output is never mistaken for the argument.
  *Which* argument changed is shown on the argument (REQ-VIS-025).
- **REQ-VIS-006:** the grey is darker on a step whose own input changed and
  lighter on steps that are out of date only because an earlier step is.

### 4.3 Step state

- **REQ-VIS-007:** the step header shows the step's state in a few words:
  `staged`, `ran`, `ran · 1 failed`, `ran · 3 changed`, or `out of date`.
  An out-of-date header carries the same grey corner mark.
- **REQ-VIS-008:** the step's existing run icon answers "will re-running do
  anything?": dimmed when nothing it reads has changed, full strength with a
  small grey dot when something has, full strength when it has never run.
- **REQ-VIS-009:** the header's status text also gives the step's **mapping
  shape** when rows don't map one to one: `filter · 4 → 3 rows, 1 dropped`,
  `expand · 4 → 7 rows`, `collapse · 4 → 2 groups`. A one-to-one step says
  nothing. Before a run it gives what core's plan knows
  (`filter · 4 → 0–4 rows`). For `auto`, the verb shown is the one core
  chose.

### 4.4 Consequences of an edit, before running

While a formula is being edited, the edited step is declared again in the
session's core workflow on each change (nothing runs), and the effect on
later steps is previewed:

- **REQ-VIS-015:** every later step that reads the edited step, directly or
  further down, shows a light preview of the out-of-date mark on its header.
- **REQ-VIS-016:** a later step that core would now refuse (a column it
  reads is gone, a shape no longer fits a parameter) gets a red outline on
  its header; hovering it puts core's problem text in the status line.
- **REQ-VIS-017:** a later step whose mapping shape would change previews
  the new shape in its header (`top · 4 → 1 rows`).
- **REQ-VIS-018:** Esc removes every preview; Enter saves the formula and the
  previews become the real marks of §4.2 and §4.3.

## 5. Hover, click, and the caret

| Gesture | Result |
|---|---|
| **hover** a cell, row number, header or corner | a subtle highlight, and one status line: `score · row 2, value = ValueError · failed` |
| **click a cell** | opens it in the selection inspector, in place (§8); nothing stays selected (owner, 2026-10-22) |
| **click a row strip or header; drag; Shift/⌘-click** | selects: a bold box in the step's colour, with a small header tab, as in Excel (§6) |
| **click the selection's header tab** | opens the selection in the inspector, in place (§8); the selection is let go |

- **REQ-VIS-010:** a plain click on a cell opens that cell in the
  inspector, in place; any other selection opens from its header tab
  (REQ-VIS-040). Opening the inspector lets the selection go. A click never
  shows wiring by itself. *(Changed 2026-10-22, owner: a click used to only
  select.)*
- **REQ-VIS-014:** **the caret rule.** The caret is the text cursor in the
  formula bar. Only while it is there (a formula is being typed) does a
  click on data **pass a reference** into the formula (§7.2), as in Excel.
  Without a caret, a click only selects. The popover and its wiring need no
  formula at all.

## 6. Selection

- **REQ-VIS-011:** what a click selects:

| Click | Selects |
|---|---|
| a cell | that cell |
| an index cell | that index cell |
| the strip left of a row | the row |
| a column header | the column |
| the `index` header | the index column |
| the top of the row strip, beside the header row | the whole table |
| drag | a block |
| Shift-click | extends to a block from the last pick |
| ⌘/Ctrl-click | adds or removes a cell, row or column |

- **REQ-VIS-061:** a column means the **entire column** and a row the
  **entire row** (owner, 2026-10-22). The grid loads only the first rows of
  a step, so a column, the whole table or the index opened in the popover
  fetches every row of the step (up to a cap, saying `first N of M rows`
  past it). A row already has every column.
- **REQ-VIS-012:** a selection is drawn as **one bold box around its
  perimeter, in the step's colour**, as in Excel (owner, 2026-10-22;
  replaces the neutral dark outline). A column's box includes its header, a
  row's its index cell. The active cell's row index and column header are
  shaded. A small **header tab** in the same colour sits on the box's
  top-left edge and names the selection (`row 1, n ▾`); clicking it opens
  the selection popover (REQ-VIS-040).
- **REQ-VIS-013:** the status line describes the selection in one line
  (`readings · rows 1–2 × city–n · 2×2`).
- **REQ-VIS-057:** **the index is a column of its own**, headed `index`,
  and each index value is a cell of its own (owner, 2026-10-22): click it
  to select it, Shift/⌘ to extend or add, open it in the popover.
  Selecting rows moves **outside the cells**, to a thin strip left of the
  table: the strip beside a row selects the row, and its top, beside the
  header row, selects the whole table. Columns are selected by their
  header, the index column by its `index` header. A row's box and the
  whole table's take in the index cells. Today the index shows the grid's
  row positions; core's row ids (which can be strings like `1.0` after an
  expand) replace them with dev_plan 124 phase 1d. A formula can't
  reference the index yet: while one is being edited, index clicks do
  nothing. *(Replaces the split corner of 2026-10-21.)*

## 7. Wiring

### 7.1 How wiring is drawn

- **REQ-VIS-020:** **inputs** (what a selection was made from) are boxed in
  the **source step's colour**, labelled with the **argument name** as a
  small tab on the box's top edge. Only the cells actually used are boxed:
  for a selected row, the input row with the same tag; for a broadcast
  argument, its single cell.
- **REQ-VIS-021:** **outputs** (later cells that use the selection) are
  boxed in the **selected step's colour**, labelled with the argument they
  read it as. When a whole column of a later step uses it, the label sits
  on that column's header.
- **REQ-VIS-022:** "what uses this" is computed by the app from each step's
  formula references plus row ids; nothing extra is stored.
- **REQ-VIS-058:** **every output cell can be traced to the exact input
  cells that produced it** (owner's condition for accepting results-only
  steps, 2026-10-21). Rows come from row ids (core's `wf.cell(...).inputs`);
  columns and argument cells come from the saved formula (a parameter binds
  to the column of its name; an argument reference is saved with its rows
  and columns). The app joins the two, so this holds even where core's
  `inputs` lists only the main input (ask C27).
- **REQ-VIS-059:** **a setting makes orchestration explicit.** With it on,
  every step shows what actually ran instead of `auto`, in the expression
  (`score[mod.map(), mod.breaker(after=5)](wf["r"])`, marked as auto's
  choice) and in the visuals (the mapping shape and the modifiers auto added).
  With it off, `auto` is shown as written, its choice on hover. It changes
  only what is shown, never what is saved.
- **REQ-VIS-055:** **colour tells apart whatever there are several of; the
  tab always names the mapping.** Editing a formula (one step, several
  references) boxes each reference in its *source* step's colour; a
  popover's outputs (one selection, several later steps) box each use in the
  *using* step's colour. Every box's tab reads `→ score · n` — the step and
  argument the data is mapped to. Boxed data cells are never tinted: shade
  stays state (§3).
- **REQ-VIS-056:** in the formula bar, each reference chip is filled with its
  source step's colour and labelled with its argument; hovering a chip
  highlights its box in the grid, and hovering a box highlights its chip.
- **REQ-VIS-019:** wiring never covers a cell's content. Boxes are drawn
  inside the cell's edge; labels are tabs on the box's edge.
- **REQ-VIS-025:** an **argument whose input changed** since the step ran
  gets the blue *changed* dot: on its label tab, on its reference in the
  popover header and in the formula bar. The input cell that was edited gets
  the same dot. Output cells only show that they are out of date
  (REQ-VIS-005).
- **REQ-VIS-030:** wiring is shown only (a) from the popover's input and
  output toggles (§8), or (b) while a formula is being edited (§7.2). At
  rest, on hover and after a plain click, the grid is plain.

### 7.2 Passing an argument while editing a formula

- **REQ-VIS-023:** while the caret is in the formula bar, each reference is a
  chip in its source step's colour labelled with its argument, and each is
  boxed over its full range in the grid.
- **REQ-VIS-031:** a click on an earlier step's cell, row number, header,
  block or corner writes that reference at the caret: it replaces the
  reference the caret is in, or fills the empty argument the caret is at.
  Hovering first shows a faint box labelled with the argument it would
  fill (`→ n`).
- **REQ-VIS-032:** the step being edited and later steps cannot be
  referenced; clicks there do nothing. Enter saves; Esc cancels.

## 8. The selection inspector

Opened on demand to see a selection's data up close and, if wanted, how it
connects.

### 8.1 Opening, moving, closing

- **REQ-VIS-040:** the selection's **header tab** (REQ-VIS-012), marked
  with Material Symbols' outlined `frame_inspect` icon, opens the
  **selection inspector in place**: over the selection, an enlarged copy of
  the selected data, carrying every feature (expression, state, inputs,
  outputs). It follows the selection as the page scrolls (owner,
  2026-10-22).
- **REQ-VIS-041:** a large selection (a long column, the whole table) is a
  scrollable grid inside a size cap; a cell with large content (long text,
  an image, a figure, a table) shows it at full size, scrollable.
- **REQ-VIS-044:** the inspector stays open until closed — clicking
  elsewhere leaves it be. **Dragging its header bar pulls it off** into a
  floating window (so several can be compared); a rail button does the same
  and puts it back in place. **Minimizing** sends it to a chip in the steps
  bar (between the steps and the console), in the step's colour: clicking
  the chip puts it back where it was, its × closes it.
- **REQ-VIS-045:** the **header bar** (the pull-off bar) is the step's
  colour and names the step and the selection's rows and columns; clicking
  it expands it to the full expression and state, nothing cut short. Its
  **right end holds the window controls**, as on a cell's display: pull off
  / put back, expand over the window (Esc restores), minimize, close. Its
  **sides are the wiring**: inputs `→ƒ(x)` on the left, outputs `ƒ(x)→` on
  the right (§8.3). The inspector **resizes from its corner**.
- **REQ-VIS-063:** one cell shows **its value alone**, as the cell itself
  (the header already names it). A cell with an **interactive display** (a
  chart, an image, a table) is that display, filling the inspector at
  whatever size it is resized to, with all of the display's own interaction
  (owner, 2026-10-22).
- **REQ-VIS-062:** while a selection is inspected, the grid marks it with a
  **dashed outline and a light shade in the step's colour**, and the
  `frame_inspect` icon on its corner; clicking the icon brings its inspector
  forward (or back from the steps bar).

### 8.2 Header (top edge): what produced this

- **REQ-VIS-046:** the header shows the **expression that produced the
  output**, short: `score(n, weight)`. Clicking it widens the top of the
  frame to the full expression, each reference naming the part this
  selection used: `score(wf["readings"]["n"] · row 1, weight=wf["weights"][0][cols["w"]])`.
- **REQ-VIS-047:** beside the expression, one state line:
  `current`, `staged · will be a float`, `failed · ValueError: negative`,
  `blocked by score[2]`, `out of date · re-run to update`,
  `changed · was 3.0`. A changed argument carries its blue dot inside the
  expression (REQ-VIS-025). Argument values never appear.
- **REQ-VIS-060:** **input values appear only in the popover, always
  labelled as inputs** (owner, 2026-10-21). Core's `wf.cell(...)["inputs"]`
  carries the values read and `wf.arg_changes` what a stale value was
  computed with; the popover's inputs view shows them as
  `input r · n = 2`, and its state line as
  `out of date · computed with weight=1.5 (now 2.0)`. They never appear in
  the grid, the formula bar or the status line.
- **REQ-VIS-048:** for a whole-table selection, the header is step-level:
  the step's expression, status, mapping shape (REQ-VIS-009), what `auto`
  chose, and when it last ran.

### 8.3 Inputs `→ƒ(x)` and outputs `ƒ(x)→` (the side rail)

- **REQ-VIS-042:** the **inputs toggle** on the left edge, when on, boxes the
  cells that were used to produce the selection (REQ-VIS-020) with a
  **checkered, slowly moving border**, and draws a **moving dashed line from
  each box into the frame's left edge**. It answers *what was used to make
  this?*
- **REQ-VIS-043:** the **outputs toggle** on the right edge, when on, boxes
  the later cells that use the selection (REQ-VIS-021) and draws **moving
  dashed lines from the frame's right edge into them**. It answers *what
  does this feed?*
- **REQ-VIS-049:** the toggles **stick**: the next popover opens with the
  same inputs and outputs settings.
- **REQ-VIS-053:** with the system's reduced-motion setting, borders and
  lines are drawn dashed but still.
- **REQ-VIS-054:** a line whose target is under the popover routes around
  it; a box on a cell under the popover is drawn above the popover's
  shadow.

## 9. Defining a selection

- **REQ-VIS-050:** a selection is used either **inline**, as a reference
  passed while editing (§7.2), or **saved as a step**: with a selection
  made, the user types a name into the step-name area beside the formula
  bar (it works like Excel's Name Box) and presses Enter. The new step is a
  core `select` step and keeps its source's row ids.
- **REQ-VIS-051:** a saved selection follows positions (rows 1–2 stay rows
  1–2 after a re-run). Pinning specific rows by id waits on core 009 §3.
- **REQ-VIS-052:** a selection of a step that hasn't run is allowed; its
  cells are staged, and core checks at run that the rows exist.

## 10. What is stored

Nothing per cell is stored to support this spec.

| Shown | Comes from |
|---|---|
| cell states, notes, types, markers | core's output (`states`, `notes`, `plan`) via `wf.preview` / `wf.cell` |
| out of date | core's `meta["read"]` version stamps against `wf.version` |
| "Was 3.0", the change dot | the step's previous output, kept until its next run (one pointer per step) |
| inputs and outputs of a selection | formula references plus row ids |
| toggle settings | the browser, per user |

## 11. Depends on

- **One core `Workflow` per session** in the backend, so staged steps, plans
  and versions exist across steps (today each step runs in a throwaway
  one-step workflow).
- **Row ids kept** in stored outputs (today `reset_index(drop=True)` drops
  them).
- **Per-cell out-of-date** (core 009 step 7). Until it lands, out-of-date is
  per step: editing one input row marks the whole reading column.

## 12. Open questions

1. **Grow in place first?** Instead of opening the popover straight away,
   the open control could first widen the selection's rows and columns in
   the grid, with pulling it off into a popover as a second step.
2. **State shades, or fewer?** Staged and failed could keep their shade
   while `maybe` loses it.
3. **When bold ends** (REQ-VIS-003): on the next run of any step, or when the
   user moves on.
4. **Extra marks for broken and out-of-date wiring** in the popover (a
   failed input, a stale input): to add after the first version.
5. **A broken expectation as a state**: when a step states `mod.expect(…)`
   and its output doesn't meet it.
