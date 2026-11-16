# 137 — UI components for tools, resources and data

**Status:** proposed (2026-11-16), app at `4375715`, core 1.0.2 (`dbaf4c7`).
The owner's ask: UI components for tools, resources and data, built soon,
**with the tools as they are**. Dev plan [136](./136-consolidation-plan.md)
I9 / P7; builds on [131](./weekend_developments/131-explore-widgets.md)
(explore widgets) and [126](./126-formula-ui.md) (argument inputs).

**The constraint.** A tool's code doesn't change, and core doesn't change.
Everything a component needs is **declared beside** the tool, resource or
value, in what the app already owns: the decorators' `extras["simple_steps.ui"]`
(core keeps it, K21) and `cell_types.register_cell_type`.

**The UI rules that apply** (owner): the grid stays plain and gets marks,
not buttons; controls live on the selection popover and in panels; icons are
Material Symbols, never emoji.

---

## 1. Today (read 2026-11-16)

| Area | What exists | What's missing |
|---|---|---|
| **Data** (a cell's value) | `cell_types.py`: a value gets a **cell type** with a summary (the grid's text), an optional preview, and a **view** of one of five kinds: `image`, `plotly`, `table`, `json`, `text`. `CellViewer.tsx` draws each kind; Plotly is lazy-loaded. A developer adds a type in Python with `register_cell_type` | A view can only be one of the five kinds. A float matrix isn't an image (131). Custom interactive views (a viewer with its own controls) have no kind. A full image is sent as a base64 `data:` URL inside JSON (see 138 for the size problem) |
| **Tools** (arguments) | `@simple_step_tool(name, category, operation_type, description)`; the palette sends each parameter's `type` (`string`, `number`, `boolean`, `list`, `object`, `dataframe`), default, `choices`, and whether it's a resource (`catalog.palette`). The formula panel draws an input per type | No way to say "this number is a slider from 0 to 1", "this string is a colour / a workspace file / a column of the input / a date". A tool's result has no say in how it's shown |
| **Tools** (explore) | 131 proposes an Explore category: tools run on a pick inside the selection inspector, whose tools row has a slot reserved for them (`SelectionInspector.tsx`) | Not built |
| **Resources** | `@simple_step_resource` (no options). `ResourceColumn.tsx` gives every resource the same panel: Load / Refresh / Clear, status, its defining formula, the steps that use it | A resource's settings can't name an input widget (a password, a file, a choice). A resource can't show what it holds (a database's tables, a model's info, a folder's files) |

## 2. The design: one mechanism, three attach points

A **component** is a named renderer the frontend already has, chosen by a
declaration in Python. There is one set of renderers, and three places that
pick from it:

```text
                      ┌───────────── built-in renderers (in the bundle) ─────────────┐
                      │ inputs:  text · number · slider · select · checkbox · colour │
                      │          · date · file · column · code                       │
                      │ views:   image · plotly · table · json · text · matrix · html│
                      └──────────────────────────────────────────────────────────────┘
                           ▲                       ▲                       ▲
 @simple_step_tool(ui={args: {…}, result: …})   @simple_step_resource(ui={…})   register_cell_type(…)
        a tool's arguments, and its result      a resource's settings and panel  a value in a cell
```

### 2.1 Data: cell types gain two view kinds

| Kind | For | How |
|---|---|---|
| **`matrix`** | 2-D numeric arrays (float, int, bool) | a colour-mapped image with a scale; display only, the value is unchanged (131 §matrix) |
| **`html`** | a developer's own interactive view | the cell type's `view` returns `{"kind": "html", "html": "…"}`; the viewer shows it in a **sandboxed iframe** (`sandbox="allow-scripts"`, no same-origin, no network beyond the app's own CDN list), so a custom view can't read the app or the session |

`html` is the escape hatch that keeps custom components out of the
frontend build: a developer writes Python (and, if they like, a page of
HTML and JS), and needs no rebuild of `frontend_dist`. Everything common is
a built-in kind instead.

**Example, unchanged tool:**

```python
@simple_step_tool(category="Imaging")
def segment(image: np.ndarray) -> np.ndarray: ...      # the tool, as is

register_cell_type(CellType("mask", matches=is_mask, summary=mask_summary,
                            view=lambda m: {"kind": "matrix", "values": …, "palette": "binary"}))
```

### 2.2 Tools: argument widgets and result hints

The decorator gains one optional argument, `ui`, stored in
`extras["simple_steps.ui"]` with what's there now. The function is
untouched:

```python
@simple_step_tool(category="Imaging", ui={
    "args": {
        "threshold": {"widget": "slider", "min": 0, "max": 1, "step": 0.01},
        "colormap":  {"widget": "select", "options": ["grey", "viridis"]},
        "mask_path": {"widget": "file", "pattern": "*.png"},
        "channel":   {"widget": "column"},        # pick a column of the input step
    },
    "result": "matrix",                          # how a result cell is shown, when its type can't tell
})
def threshold_image(image: np.ndarray, threshold: float = 0.5, ...) -> np.ndarray: ...
```

| Widget | Writes into the formula |
|---|---|
| `text`, `number`, `checkbox`, `date`, `colour` | a literal: `threshold=0.42` |
| `slider` | a literal, within `min`/`max` |
| `select` | a literal from `options` (or core's `choices`, already sent) |
| `file` | a workspace path literal, from the file explorer's picker |
| `column` | a column reference: `channel=wf["s"][cols["red"]]` |
| `code` | a literal string, in a small Monaco editor |

**Rules:**
- A widget only **writes formula text**: every change is visible in the
  formula bar, and typing the formula by hand gives the same result (R-A,
  134). A widget never holds state the formula doesn't.
- An unknown widget name, or one that doesn't fit the parameter's type, is
  a **warning in the catalog** when the tool is declared, and the panel falls
  back to the type's default input. A tool never fails to show.
- With no `ui`, everything is as today.

### 2.3 Explore tools on a pick (131)

Built as 131 proposes: an **Explore** category of ordinary tools (`plot`,
`heatmap`, `matrix_image`, `describe`, `value_counts`), run on the
inspector's pick, **outside any step**, and shown in the inspector's
frame through the same view kinds. "Make it a step" (131 E5) comes later.
Their arguments use §2.2's widgets.

### 2.4 Resources: settings widgets and a panel

`@simple_step_resource` gains the same optional `ui`:

```python
@simple_step_resource(ui={
    "settings": {"password": {"widget": "secret"}, "path": {"widget": "file"}},
    "panel": "tables",           # a method of the class that returns a view payload
})
class ClinicalDB:
    def __init__(self, url: str, password: str): ...
    def tables(self) -> pd.DataFrame: ...       # an existing method, not a tool
```

| Part | Shows |
|---|---|
| **settings** | the resource's constructor settings, each with its widget; `secret` never echoes the value and keeps it out of saved files (008 R3/R4) |
| **panel** | the result of the named method, **called only when the resource is loaded and the panel is opened**, shown with a view kind (here a `table`); refreshed by the panel's Refresh. With no `panel`, the panel is as today |

The method must already exist on the class (the class is unchanged); it
runs off the event loop like any other call (138 N0).

**Where it's kept** (run 2026-11-16): core's `resource(cls)` takes no
`extras`, unlike tools. The app keeps a resource's `ui` in its own registry
(`resources.register_type`), which `simple_step_resource` already goes
through, so **no core change is needed**. Core's plan agrees that UI lives
in the app, named in extras and never hashed (core plan §4).

## 3. What changes, file by file

| Where | Change |
|---|---|
| `decorators.py`, `core_bridge.simple_step_resource` | accept `ui=…`, check it, store it in `extras["simple_steps.ui"]` |
| `catalog.palette`, `/api/resources` | send `ui.args` per parameter, `ui.result`, and the resource's `ui` |
| `cell_types.py` | the `matrix` kind (and its numeric-array type); the `html` kind |
| `ToolEditor.tsx` (the formula panel's Arguments column) | one input component per widget, chosen by `ui.args`, else by type |
| `CellViewer.tsx` | `matrix` and `html` renderers |
| `SelectionInspector.tsx` | the tools row runs Explore tools (131) |
| `ResourceColumn.tsx` | settings widgets; the panel's view |
| `docs/usage_docs/` | one developer page: "Giving a tool, a resource or a value its own UI" |
| `src/SIMPLE_STEPS/examples/` | one example using each attach point, checked by `runme.py` |

Every `frontend/src` change is followed by `python -m SIMPLE_STEPS.build_frontend`.

## 4. Phases

| Phase | What | Done when |
|---|---|---|
| **C1** | Argument widgets (§2.2): `ui.args` end to end, the ten widgets, the fallback and the catalog warning | each widget edits a shipped example tool's formula, and the formula typed by hand gives the same panel |
| **C2** | Data views (§2.1): `matrix`, then `html` in a sandboxed iframe; `ui.result` | a float array shows as a matrix; an `html` view runs its own script but can't read `document.cookie` of the app |
| **C3** | Explore tools on a pick (§2.3, 131's phases): plots first | a block of two columns plots as a scatter in the inspector, with nothing written to the workflow |
| **C4** | Resource settings and panel (§2.4) | a database example shows its tables when loaded; a secret setting is never saved in the workflow file |
| **C5** | The developer page and the example | `runme.py` passes with the new example |

C1 and C2 are independent and can go in parallel. C2's image-heavy views
use 138's image endpoint (B3) once it exists; until then, today's `data:`
URL.

## 5. Decisions for the owner

1. **Custom components as sandboxed `html`** (recommended: no frontend
   rebuild for a developer's component, and isolated from the app), or a
   frontend plugin system (developers ship React components, and the bundle
   is rebuilt)?
2. **The widget list** (§2.2): the ten, or more to start (a range, a
   multi-select, a map)?
3. **Resource panel** as a named method of the class (recommended: the
   class is unchanged), or a separate function given to the decorator?
4. **`ui.result`**: needed, or is the cell type always enough?
