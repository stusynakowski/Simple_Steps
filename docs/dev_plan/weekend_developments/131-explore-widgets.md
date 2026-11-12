# 131 — Explore widgets: plot, picture and summarise a selection

> Status: **proposed**, 2026-11-12, app at `654de9b`, core `dbaf4c7`. Every
> "today" and every core fact below was run, not read. Owner's ask: widgets
> in the data explorer to explore, visualise and operate on a step's data
> (plot a selection, show a numpy matrix as an image, …), which are also
> tools.

## Summary

**One implementation per concept: an explore widget *is* a tool.** Each one
is a standard `@simple_step_tool` in a new **Explore** category, written so
it can take a selection of a step, `wf["s"][1:3][cols[["a","b"]]]`, and
return something the grid already knows how to show (a chart, an image, a
small table). The tool can be used in two places:

1. **As a widget**, on the selection inspector's tools row (the slot left for
   it: "a quick plot, image analysis join it later"). Pick a widget and it
   **invokes the tool on that pick, outside any step** (owner, 2026-11-12),
   and shows the result inside the frame. It writes nothing to the workflow;
   its settings are the tool's arguments. This is the feature.
2. **As a step, optionally and later** (E5): **Make it a step** writes the
   call the widget ran, `plot(wf["s"][1:3][cols[["a","b"]]], kind="scatter")`,
   as a new step after the inspected one. It works because the widget *is*
   the tool, so nothing has to be converted. Not needed for the widgets to
   be useful.

A **matrix** cell type also shows a 2-D numeric array (float, int or bool)
as a colour-mapped image in every viewer, with no tool needed. That is
display only; the value is unchanged.

## Today (run 2026-11-12)

| | Found |
|---|---|
| Selection inspector | `SelectionInspector.tsx`: opens from the selection's header tab; docked, floating or minimized to a chip. Its **tools row has two disabled buttons** (Inputs, Outputs), with a comment reserving it for "a quick plot, image analysis" (`:78-88`, `:300-303`). Body: one typed cell gets an embedded `CellViewer`; several cells get a table of the selected cells; whole columns fetch every row, up to 5000 |
| Selection model | `GridSel` (`utils/gridSelection.ts:24-34`): `kind` (`cell`, `block`, `rows`, `columns`, `all`, `cells`, `index`), cell keys, headers. `utils/selection.ts:selectionText()` already writes it as a reference: `wf["s"]`, `[a:b]`, `[[…]]`, `[cols[…]]`; null if not one rectangle |
| Rendering | `/api/cell/{ref}` returns a view of kind `image`, `plotly`, `table`, `json` or `text` (`cell_types.py`). `CellViewer` draws each one and lazy-loads `plotly.js-dist-min`, the frontend's only chart library |
| Matrices | **A float or int matrix is not an image.** Only a `uint8` H×W(×3/4) array is (`_is_image_array`, `cell_types.py:113`). `np.arange(9.).reshape(3,3)` shows as the JSON `array 3×3 float64` |
| Plotting tools | None built in. `examples/plotly_charts` builds figures with Python `plotly`, **already a regular dependency** (`pyproject.toml`; only Pillow is the `media` extra; `cell_types.py`'s docstring calling Plotly optional is out of date) |
| Operate on a selection | No action makes a new step from a selection. Wiring mode places a selection into another step's formula (`placePick`) |
| Plan 130's "a selection as input is refused" | **No longer true.** `/api/parse_formula` accepts `=to_rows(wf["s"][1:3][cols[["a","b"]]])` and `cols["a":"b"]`, `isValid: true`, with rows and columns parsed |

## What core gives (run 2026-11-12, core `dbaf4c7`)

| Need | Core |
|---|---|
| A selection as a tool's input | **Yes.** A tool with a `pd.DataFrame` parameter, given `wf["s"]`, `[1:3]`, `[[0,2]]`, `[cols[["a","b"]]]`, `[cols["a":"b"]]` or `[1:3][cols[["a","b"]]]`, gets exactly those rows and columns. Core picks the `table` verb by itself |
| What a `table` tool returns | **A DataFrame, and nothing else.** A `dict` fails the cell: *"table expects a DataFrame back, got dict"*. (Plan 127 says "a `dict` → one row"; that is wrong.) So a widget returns **a one-row frame holding the chart or image**, `pd.DataFrame({"plot": [figure]})`, or a real table (describe, counts) |
| A column list | `cols[["a","b"]]`. `cols["a","b"]` is refused ("got tuple") |
| A matrix in a cell | Kept as the array: type `ndarray` |
| **Run a formula once without adding a step** | **Not found.** `Kernel` has `run`, `insert`, `remove`, `view` and `cell`; `Workflow.preview` draws an existing step. A preview needs one (D2) |
| **…but insert, run, read, remove leaves no trace** | Run: a step `__explore` = `seen(wf["s"][0:2])` added after two run steps, run, read (`2`), removed. Afterwards `k.to_json()`, `k.needs_run()` (`{}`) and `k.run_id` are identical to before. The only trace: **3 `on_change` events** (insert, run, remove), which the shim mutes |

## Design

### The explore tool contract

An explore tool:

- takes the selection as its **first parameter, typed `pd.DataFrame`** (core
  hands it the whole selection: `table`), plus literal settings with
  defaults, so it runs with no arguments;
- returns **a DataFrame**: one row and one column named after the tool,
  holding the chart or image, or a table that is its result (`describe`);
- leaves the `#` lineage columns out; they are ids, not data;
- lives in `src/SIMPLE_STEPS/explore.py`, category **Explore**, offered by
  every app the way `operations.py`'s tools are;
- has an `Args:` docstring, so the widget's settings are labelled in the
  inspector.

The inspector learns nothing per tool. It lists the Explore category's
tools, and draws each one's settings from the catalog (`/api/operations`)
as the formula panel does.

### The first widgets

| # | Tool | Takes | Shows | Settings |
|---|---|---|---|---|
| W1 | `plot` | any selection | a chart (`plotly` view) | `kind` = line, scatter, bar, hist, box; `x` (default: the row position, or the first non-numeric column); `y` (default: every numeric column) |
| W2 | `heatmap` | a numeric block | a heatmap chart: the selection *as* a matrix, axes are its rows and columns | `colormap`, `vmin`, `vmax` |
| W3 | `matrix_image` | a column of matrices | each cell's matrix as an image, `uint8`, kept as data so later steps can use it | `colormap`, `vmin`, `vmax` (default: each matrix's own range) |
| W4 | `describe` | any selection | count, mean, std, min, quartiles and max per column; for text, count, unique, top and its count | — |
| W5 | `value_counts` | one column | each value and its count, most first, as a table plus a bar chart | `top` (default 20) |

`matrix_image` is a **map** tool, `(m: np.ndarray) -> np.ndarray`, one image
per row, not a `table` one: a column of matrices is already one per row. The
others are `table` tools.

### Charts are Plotly figures (D1, decided)

Plotly is a basic tool everyone has: it is a regular dependency already. The
explore tools build `plotly.graph_objects.Figure`s, which the existing
`plotly` cell type and `CellViewer` draw. A user's own tools do the same.

### The matrix cell type

- `matrix`: a 2-D numeric `ndarray` that isn't already an image (not
  `uint8` H×W×3/4). Bool counts as numeric.
- **summary**: `matrix 64×64 float64 · −1.2…3.4`.
- **preview** (grid thumbnail) and **view** (`image`, plus `range` and
  `colormap` for a legend): colour-mapped with a built-in palette (viridis;
  greys), encoded with the PNG writer `cell_types.py` already has. No
  matplotlib.
- Very large matrices are drawn at most 1024 px on a side (strided); the
  value is untouched.
- 1-D, 3-D (other than images) and object arrays stay `json` as now.

### In the inspector

- **The tools row** gets an **Explore** menu (a `StepMenu`, one entry per
  Explore tool, icons from Material Symbols) and an **Inputs / Outputs**
  pair as before. The grid gets nothing new; everything is on the frame,
  only when asked for.
- Picking a widget turns the frame's body into: **the widget's settings** (a
  compact row of the tool's arguments) above **the result**, drawn by
  `CellViewer` (embedded). Changing a setting re-runs the preview, debounced.
  **Back** returns to the cells.
- The selection is written by `selectionText()`. A selection that isn't one
  rectangle (Ctrl-picked cells) disables the widgets, with the reason on
  hover: "pick one block of cells, rows or columns".
- (E5, optional) **Make it a step** writes `tool(<selection>, <settings>)`
  as a new step right after the inspected step, named after the tool
  (`plot`, `plot2`, …), and runs it.
- A single typed cell keeps opening in `CellViewer` as now; a matrix gets the
  matrix view automatically.

### Previews (D2)

A preview runs `tool(<selection>, <settings>)` against the session's kernel
**without adding a step**: `POST /api/explore` with
`{workflow_key, formula}`, returning `{cell_type, summary, view}` (the same
shape as `/api/cell`) or the error. Rules:

- **Read only.** Nothing is stored and nothing goes stale; the workflow's
  `on_change` listeners don't fire.
- **Bounded.** Previews of more than `EXPLORE_ROWS` rows (default 50 000)
  run on the first `EXPLORE_ROWS`, with a note in the frame. A step made
  from a widget (E5) runs on everything.
- Only **Explore** tools can be previewed, so a preview can never call a tool
  with side effects (`res["workspace"].write`, an LLM).

How (D2, decided): core has no "run this once" call, so a
`SHIM(core §…)` in `core_bridge.py` adds a step with a reserved name at the
end, runs it, reads its view, and removes it, with the kernel's listeners
muted, under the session's lock so nothing else runs in between. Run above:
it leaves no trace. The core ask below replaces it.

### A widget as a step (optional, E5)

If Make it a step is added, the step can stay a widget. A step whose output is **one typed cell** (a
chart, an image, a matrix) shows that cell **full-size in its Data panel**,
drawn by `CellViewer`, in place of a 1×1 grid holding an icon; its settings
are the formula's arguments, edited in the formula panel as for any step. So
a `plot` step reads as the chart, and changing `kind` re-runs and redraws it.
Its output is still a dataframe (one row, one column), so references and
selection treat it like any other step.

### Operating on the data

"Operate" in this plan means what a selection can start, not new data tools:

- (E5, optional) **New step from selection**: writes `=wf["s"][<sel>]` as a
  new step, a copy of just those rows and columns to build on: Make it a
  step with no tool.
- Filters, sorts and the like stay core's built-in verbs and the formula UI's
  job (plan 126). Explore tools never change a step's data.

## Decisions to make

| | Question | Recommended |
|---|---|---|
| D1 | Charts: Plotly | **Decided (owner, 2026-11-12):** Plotly, a regular dependency everyone has; tools return `go.Figure` |
| D2 | How a preview runs without a step | **Decided:** the insert–run–read–remove shim (run: no trace), and a core ask for a one-off run to replace it |
| D3 | Where the widgets live | **The selection inspector's tools row only** (the grid stays plain). Single typed cells keep `CellViewer` |
| D4 | Previews of big selections | Cap at 50 000 rows with a note; a step made from a widget runs on everything |
| D5 | The widget and steps | **Decided (owner, 2026-11-12):** the widget invokes the tool on the pick, outside the step. Making it a step is an optional later feature (E5). `matrix_image` returns **data** (a `uint8` image) so it works as a step too |

## Order of work

| # | Work | Why first |
|---|---|---|
| E0 | **The matrix cell type** (summary, thumbnail, colour-mapped view, legend in `CellViewer`) | stands alone, no core question, immediately useful for numpy results |
| E1 | `explore.py`: `plot`, `describe`, `value_counts`, `heatmap`, `matrix_image`, as tools | the widgets are these tools |
| E2 | **Invoking on a pick**: the D2 shim and `POST /api/explore`; the core ask filed in 008 | the inspector needs it |
| E3 | **The inspector's Explore menu**: settings row, result, Back, disabled-with-reason for non-rectangular selections | the feature |
| E4 | Docs: a user-guide page "Exploring a step's data"; the developer guide's section on writing an Explore tool (the contract above); update 130's out-of-date note | — |
| E5 | *Optional, later:* **Make it a step**, **New step from selection**, and a one-typed-cell step shown full-size | only if wanted once the widgets are in use |

## Requirements and tests

| REQ | Requirement | TEST |
|---|---|---|
| REQ-EXP-001 | A 2-D numeric array (not an image) shows as a colour-mapped image, with its range, in the grid and in viewers; its value is unchanged | TEST-EXP-001 |
| REQ-EXP-002 | Each Explore tool runs as a step on a whole step, a row range, a column list and both together, and returns a DataFrame | TEST-EXP-002 |
| REQ-EXP-003 | `plot` with no settings draws every numeric column against the row position; `kind`, `x` and `y` change it | TEST-EXP-003 |
| REQ-EXP-004 | `#` lineage columns never reach a chart, an image or a summary | TEST-EXP-004 |
| REQ-EXP-005 | A preview stores nothing: no step, no staleness, no change event; a workflow saved after it is unchanged | TEST-EXP-005 |
| REQ-EXP-006 | Only Explore tools can be previewed; anything else is refused with the reason | TEST-EXP-006 |
| REQ-EXP-007 | (E5) Make it a step writes the same formula the widget ran, after the inspected step, and its output equals the widget's (for selections under the cap) | TEST-EXP-007 |
| REQ-EXP-008 | A non-rectangular selection disables the widgets and says why | TEST-EXP-008 (frontend) |
| REQ-EXP-009 | (E5) A step whose output is one typed cell shows it full-size in its Data panel; references to it still see a 1×1 frame | TEST-EXP-009 (frontend) |

## Core asks (for `docs/core-proposals/008-core-changes.md`)

- **A one-off run**: evaluate a formula against the workflow and return its
  output without storing a step or marking anything stale (D2). Evidence to
  attach: the `Kernel` API listing above, and the shim's run (no trace but
  three `on_change` events).
