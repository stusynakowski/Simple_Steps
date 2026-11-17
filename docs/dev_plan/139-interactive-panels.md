# 139 — Interactive panels for tools, resources and data

**Status:** proposed, **deferred** (2026-11-17). Design only; nothing here is
scheduled. App at `306448e`, core 1.0.2 (`dbaf4c7`); core's `core-handover`
branch (`ffec708`) read for what it adds. Extends
[137](./137-ui-components.md) (it replaces 137's resource "panel = a named
method", §2.4, and gives 137 C3's Explore tools a general form) and depends
on [138](./138-runs-and-big-data.md) (the job runner). Related:
[131](./weekend_developments/131-explore-widgets.md) (explore widgets),
[129](./weekend_developments/129-multi-user-hosting.md) (hosting).

**The owner's ask.** Developers can give their own tools, resources and data
an **interactive panel**, defined as a Python function (in the spirit of a
Streamlit script) and attached when they decorate. A user works in the panel
**before** anything becomes a step: talk to a language model, browse a
mounted filesystem or a database, try a tool on a sample of loaded data until
its arguments are right, then add it to the workflow.

---

## 1. Use cases

| # | Attached to | The user wants to | The panel needs |
|---|---|---|---|
| U1 | a resource: a **language model** | send prompts, read answers, settle a system prompt and temperature, then use them in a step | chat elements; the live resource; scratch state (the history) |
| U2 | a resource: a **mounted filesystem** | browse folders, preview a file, pick a set of files, then load them as a step | a tree or list; previews (image, table, text); "use these" → a step |
| U3 | a resource: a **database** | list tables, run a query, see the rows, then make the query a step | a code input; a table view; a slow call that can be cancelled |
| U4 | a **tool** | try it on a few picked rows, move a slider, see the result at once, then add it as a step with those arguments | the pick as a sample; a way to run the tool on it that behaves as a step will; "add as step" |
| U5 | **data** (a cell type) | look at a value in a richer way than its view: page a big image, adjust contrast, inspect a model object | the value, loaded on demand (core's `k.value`); view elements |
| U6 | **data** (a pick, any type) | plot, describe or count the picked block without making a step (131's Explore tools) | the pick as a frame; plot and table views |

U4 to U6 are the same mechanism: a panel run on a pick. U1 to U3 are the
same mechanism: a panel run on a live resource.

## 2. What is fixed (verified by running, 2026-11-17)

| Fact | Consequence |
|---|---|
| Core's `extras` hold **literals only**: `_checked_extras({"simple_steps.ui": {"panel": print}})` raises `TypeError` (core 1.0.2 and `core-handover`) | the panel **function** can't be stored in core. The app keeps it in its own registry; extras may carry only a literal flag such as `{"panel": true}` |
| Core's `resource(cls)` takes **no extras** (signature `(cls)`) | a resource's panel lives entirely in the app's registry (`resources.register_type`, which `simple_step_resource` already goes through). No core change |
| Core has **no call to run a tool outside a step** | trying a tool on a sample needs a scratch kernel (§5.3), or a core ask (§9, Q6) |
| The app holds live resources per session (`resources.live_resource(session_id, name, declaration)`), built on first use and **shared** by every caller in the session | a panel and a running step can use the same instance at once (§7.4) |
| Core's `k.value(step, row, column)` (on `core-handover`) loads one cell's value; bulky values are `MediaHandle`s until then | U5 loads only the cell the panel opens |
| The app is **always async** (138): every run is a background job, and a long call never stalls the app | a panel's code runs as a job, never on the event loop |

## 3. Design principles

1. **The formula stays the truth.** A panel is a workbench beside the
   workflow. Nothing done in it changes the workflow, except through one
   explicit action that **writes formula text** through the normal edit path
   (§6). Undo, the formula bar and the saved file see that edit like any
   other.
2. **Panels are temporary.** A panel's state lives while it's open (or for
   the session; §9 Q4) and is never saved in the workflow. Secrets typed into
   a panel never reach a file.
3. **A developer writes Python only.** No frontend build, no JavaScript, for
   everything the built-in elements cover. A custom element is a sandboxed
   escape hatch (§4.4), not the norm.
4. **A panel never blocks the app.** Each interaction is a job: off the event
   loop, cancellable, one at a time per panel, with its progress shown.
5. **A panel costs nothing until opened.** No code runs, no resource loads,
   no value is fetched until the user opens the panel.
6. **The UI rules hold.** The grid gets no new buttons. Panels open from the
   pick popover, the formula panel and the resource column. Icons are
   Material Symbols.

## 4. The developer's API

### 4.1 Attaching a panel

One optional argument on each of the three existing declarations:

```python
@simple_step_tool(category="Imaging", panel=tune_threshold)
def threshold_image(image: np.ndarray, threshold: float = 0.5) -> np.ndarray: ...

@simple_step_resource(panel=chat)
class LLM: ...

register_cell_type(CellType("volume", matches=is_volume, summary=..., view=...,
                            panel=inspect_volume))
```

A panel is a plain function `panel(ui, ctx) -> None`. It is checked when it is
attached: it must take exactly `(ui, ctx)` and must not be `async def` (138
N3). A bad panel is a **warning in the catalog**, and the tool, resource or
type still works without it.

A panel can also be declared apart from the thing it serves, for a library
whose code can't be edited:

```python
register_panel("tool", "threshold_image", tune_threshold)
```

### 4.2 The run model

The function runs **top to bottom on every interaction** (the Streamlit
model). Each `ui.*` call both declares an element and returns its current
value; the app keeps the values between runs by the element's **key** (its
label, or `key=` when two elements share a label).

```python
def tune_threshold(ui, ctx):
    t = ui.slider("threshold", 0.0, 1.0, value=0.5, step=0.01)
    ui.view(ctx.run(threshold=t))                 # the tool on the sample
    if ui.button("Add as step"):
        ui.add_step(threshold=t)
```

Slow work goes in a **form**: its inputs don't trigger a run until submit.

```python
def query(ui, ctx):
    with ui.form("Query"):
        sql = ui.code("SQL", language="sql", value="select * from visits limit 100")
    if ui.submitted("Query"):
        ctx.state["rows"] = ctx.resource.query(sql)
    if "rows" in ctx.state:
        ui.table(ctx.state["rows"])
        if ui.button("Make this a step"):
            ui.add_step(formula=f'query({ctx.name!r}, sql={sql!r})')
```

`ui.cache(fn, *args)` keeps the result of a pure call across runs, keyed by
its arguments (so a rerun after a slider move doesn't refetch a table list).

### 4.3 The elements

A small, fixed set, drawn by components the frontend already has or that
137 adds. Every element takes `key=` and `help=`.

| Group | Elements | Returns |
|---|---|---|
| **Inputs** | `text`, `number`, `slider`, `select`, `multiselect`, `checkbox`, `colour`, `date`, `file` (workspace picker), `column` (a column of the sample), `code` (Monaco), `secret` (never echoed, never logged) | the current value |
| **Actions** | `button`, `form` / `submitted` | `True` on the run the click caused |
| **Outputs** | `view(value)` (the value's own cell type), `table`, `image`, `plotly`, `matrix`, `json`, `text`, `markdown`, `progress`, `error`, `html` (§4.4) | `None` |
| **Layout** | `columns(n)`, `tabs(names)`, `expander(label)`, `divider` | context managers |
| **Chat** | `message(text, role=)`, `chat_input(label)` | the submitted text, once |
| **Hand-off** | `add_step(...)`, `set_settings(...)` (§6) | `None` |

The input widgets are the same set, with the same names, as 137 §2.2's
argument widgets, so a developer learns one list.

### 4.4 Custom elements

For what the set doesn't cover (a 3-D viewer, a map, a custom canvas), two
options; §9 Q2 decides.

- **A. `ui.html(page, data=…)`**: the developer's HTML and JS in a
  **sandboxed iframe** (`sandbox="allow-scripts"`, no same-origin). It talks
  to the panel only by `postMessage`: it receives `data`, and may send back one
  value, which `ui.html` returns on the next run. It can't read the app, the
  session or its cookies.
- **B. anywidget**: accept an [anywidget](https://anywidget.dev) object (an
  ES module plus synced traits), the standard that Jupyter and marimo share.
  Developers can reuse existing widgets. It costs a host for the anywidget
  protocol in the frontend, and still needs the iframe for isolation.

### 4.5 What the panel can reach: `ctx`

| Member | For | Notes |
|---|---|---|
| `ctx.kind`, `ctx.name` | `"tool"`, `"resource"` or `"data"`, and the tool, resource or cell type's name | |
| `ctx.resource` | the **live instance** (resource panels) | built on first use, as a step would; the panel shows the build error if it fails |
| `ctx.sample` | the pick, as a small DataFrame (tool and data panels) | capped (§9 Q5); bulky cells stay handles until `ctx.value(row, column)` loads one with core's `k.value` |
| `ctx.value(row, column)` | one full value | loaded on demand |
| `ctx.run(**args)` | the tool (tool panels) run on `ctx.sample` with these arguments, **as a step would run it** (§5.3) | returns the result frame; a failure is shown as the step's problem would be |
| `ctx.state` | a dict that lasts between runs of this panel | temporary (principle 2) |
| `ctx.progress(i, n)`, `ctx.cancelled` | progress and cooperative cancel for a slow loop | the same signals as a run (138) |
| `ctx.workspace` | the workspace path, for the file element and resource panels | read-only listing; the panel's code can do what a tool can |

`ctx` gives **no** handle to the kernel or the workflow. The only way to
change the workflow is the hand-off (§6).

## 5. The runtime

```text
 browser                               server (app)                             core
 ───────                               ────────────                             ────
 PanelView ──open {kind,name,pick}──▶ PanelHost.open ─▶ PanelSession
          ◀──── tree v1 ───────────── run panel(ui, ctx) as a job ──ctx.run──▶ scratch kernel
 user moves slider
          ──event {key, value, v1}──▶ PanelSession.event ─▶ queue; cancel stale run
          ◀──── tree v2 ───────────── rerun as a job
 "Add as step"
          ──event {key:"Add…"}──────▶ rerun → ui.add_step(...) → formula text
          ◀──── edit proposal ──────
 the normal edit path (formula bar) ──────────────────────────────────────────▶ the workflow
```

### 5.1 Panel session

`PanelSession` (one per open panel, per user session) holds: the panel
function, the element values by key, `ctx.state`, the pick it was opened on,
and a version number. `PanelHost` creates, finds and closes sessions, and
closes idle ones after a timeout.

### 5.2 Runs are jobs

Each run of the panel function is a job on 138's runner: in a worker thread
(a worker process once 129's kernel hosts exist), never on the event loop.
Per panel, **one run at a time**; an event that arrives during a run marks
it stale (`ctx.cancelled` becomes true) and queues one rerun with the latest
values, so a dragged slider costs at most two runs, not one per pixel. Panels
and workflow runs share the runner's limits, so a busy panel can't starve the
workflow, nor the reverse (§9 Q3).

### 5.3 Trying a tool: the scratch kernel

`ctx.run(**args)` must behave as the step will, or "add as step" surprises the
user. So it doesn't call the Python function directly; it builds a
**throwaway kernel** with the same catalog: a literal step holding
`ctx.sample`, and one step applying the tool with `args`, then runs it and
returns the result. This uses core's own argument checks, row mapping,
modifiers and problems, and needs no core change. The workflow's kernel is
never touched.

Open points, to settle by running: how a live resource is given to the
scratch kernel (it must be the session's instance, not a second one), and the
cost of building a kernel per run (cache one per panel, and only replace the
sample step). A core call for a one-off run (131's ask) would replace this;
§9 Q6.

### 5.4 The wire format

A run produces a **tree of elements** as JSON; the frontend draws it. Only
changed subtrees need sending later (an optimization, not v1).

```json
{"panel": "p7", "version": 12, "state": "done",
 "elements": [
   {"key": "threshold", "type": "slider", "label": "threshold",
    "min": 0, "max": 1, "step": 0.01, "value": 0.42},
   {"key": "view-1", "type": "view", "value": {"kind": "matrix", "src": "/api/media/…"}},
   {"key": "Add as step", "type": "button"}]}
```

An event from the browser: `{"panel": "p7", "version": 12, "key": "threshold",
"value": 0.5}`. Events carry the version they were made against, so a late
event from an old tree is dropped. Large values (images, tables) are sent as
references to the media endpoint (138 B3) and paged tables (138 B4), never
inline. Transport: the same as run progress in 138 (POST for events, the
server-sent event stream for trees); no second channel.

### 5.5 Errors

An exception in the panel function shows **in the panel**, in place of the
element that raised, with the traceback folded; the rest of the tree from the
last good run stays. A panel never takes down the app, the workflow or
another panel. A slow run shows `progress` and a Stop.

## 6. The hand-off: from panel to workflow

| Call | Panels | Produces |
|---|---|---|
| `ui.add_step(**args)` | tool | `tool(wf["<picked step>"], **args)` as a new step after the pick's step |
| `ui.add_step(formula="…")` | any | that formula as a new step |
| `ui.set_settings(**s)` | resource | the resource's definition with these settings (`LLM(model="…", temperature=0.2)`) |

The hand-off is a **proposal**: the app shows the formula in the formula bar,
and the user confirms it (Enter) as if they had typed it; core checks it as
usual. Arguments are written as literals, a `column` input as a column
reference. A value that can't be a literal (an object, a frame) can't be
handed off; that is the developer's signal to make a tool return it instead.

## 7. Placement, trust and concurrency

### 7.1 Where panels open

| Kind | Opens from | Shows in |
|---|---|---|
| tool | the formula panel, a **Try** tab beside Arguments (the tool's panel, else a generic one built from its argument widgets) | the formula panel |
| resource | the resource column, when the resource is loaded | the resource's panel |
| data | the pick popover (Explore), and a cell's viewer for a cell type with a panel | the pick inspector frame |

A panel can be popped out into its own window or tab (the session is on the
server, so two views of one panel stay in step).

### 7.2 Trust

A panel function runs with the same rights as a tool: it is the developer's
own code, installed like their tools. Nothing new is trusted. The new surface
is the browser side, and it stays closed: built-in elements are drawn by the
app's components from data (never as raw HTML), and custom HTML only runs in
the sandboxed iframe. Under multi-user hosting (129) a panel runs in its
user's kernel host, like their steps.

### 7.3 Secrets

`ui.secret` values are kept in the panel session only, never in a tree sent
back except as "set", never logged, never in a hand-off formula (a secret
setting is handed off as a reference to the resource's secret store, 008
R3/R4).

### 7.4 One resource, two users

A panel and a running step may use the same live resource at once (§2). The
default is to share it; a resource class that isn't safe for that declares
`panel_lock=True`, and the app then serializes the panel's calls with the
steps' calls on that instance. §9 Q7.

## 8. Alternatives considered

| Question | Option | For | Against |
|---|---|---|---|
| **Run model** | **rerun top to bottom** (proposed) | simplest to write; matches the owner's "like a Streamlit form"; no callbacks to wire | reruns everything; needs `form` and `cache` for slow work |
| | callbacks (`on_change=fn`) | runs only what changed | developers must manage state and order; easy to get wrong |
| | reactive cells (marimo-style) | precise, efficient | a dependency analysis of the developer's code; far more to build |
| **Elements** | **our own small set** (proposed) | one look with the app; drawn from data; secure; no extra server | we build and keep about 25 components |
| | embed real Streamlit / Gradio / Panel | rich, familiar to developers | a second server and process per panel, an iframe around it, its own state and theme; fights principle 1 and 4 |
| | ipywidgets | large ecosystem | needs a Jupyter comm layer in the app; heavy |
| **Where the function lives** | **the app's registry** (proposed) | works today; core needs no change | the app owns another registry |
| | core extras | one place | refused: extras are literals only (§2), by design |
| **Trying a tool** | **scratch kernel** (proposed) | behaves exactly as a step | a kernel per panel; the resource hand-over to settle |
| | call the function directly | trivial | skips core's checks, row mapping and modifiers; results differ from the step |
| | a core one-off run | cleanest | a core ask; waits for core |

## 9. Decisions for the owner (later)

1. **Run model**: rerun with `form` and `cache` (recommended), or callbacks?
2. **Custom elements**: sandboxed `ui.html` (recommended to start), anywidget,
   or both?
3. **Limits**: panels and workflow runs sharing one runner with a cap each
   (recommended), or separate pools?
4. **Panel lifetime**: closed panel forgets its state (recommended), or
   state kept for the session (a chat history survives closing)?
5. **Sample size** for `ctx.sample`: the pick as it is, capped at 1,000 rows
   (recommended), or a setting?
6. **Trying a tool**: scratch kernel now (recommended), or ask core for a
   one-off run first?
7. **Shared resources**: shared by default with an opt-in lock
   (recommended), or a separate instance per panel?
8. **Generic Try tab** for tools with no panel (built from argument widgets
   and the sample): yes (recommended), or only for tools that declare one?

## 10. Requirements

| ID | Requirement |
|---|---|
| REQ-PNL-001 | A tool, a resource and a cell type each accept an optional `panel(ui, ctx)` function at declaration; `register_panel` attaches one afterward |
| REQ-PNL-002 | A panel with the wrong signature, or `async def`, is a catalog warning; the thing it serves still works |
| REQ-PNL-003 | No panel code runs, no resource loads and no value is fetched until a panel is opened |
| REQ-PNL-004 | A panel run never runs on the event loop; while it runs, every other request is answered at once |
| REQ-PNL-005 | Per panel, one run at a time; an event during a run cancels it cooperatively and queues one rerun with the latest values |
| REQ-PNL-006 | Element values persist across runs by key; `ctx.state` persists for the panel's lifetime |
| REQ-PNL-007 | `ctx.run(**args)` returns what the same tool step with those arguments would produce on the sample, including its problems |
| REQ-PNL-008 | A panel can't change the workflow except through a hand-off, which shows a formula for the user to confirm |
| REQ-PNL-009 | Panel state is never written to the workflow file or the session folder; secrets are never sent back, logged or saved |
| REQ-PNL-010 | Custom HTML runs only in a sandboxed iframe with no same-origin access |
| REQ-PNL-011 | An exception in a panel shows in the panel, keeps the last good elements, and affects nothing else |
| REQ-PNL-012 | Bulky values reach the browser by reference (media endpoint, paged tables), never inline in a tree |

Tests map these to `TEST-PNL-*` when the plan is built.

## 11. Phases (when scheduled)

Prerequisites: 138 N0 (handlers off the event loop) and N2 (the job runner,
progress and cancel); 137 C1 (the input widgets) and C2 (the `matrix` and
`html` views).

| Phase | What | Done when |
|---|---|---|
| **P1** | Runtime: `PanelHost`, `PanelSession`, the rerun loop, the element tree, events, `PanelView` with inputs, actions, outputs and layout | a resource panel with a text input and a markdown output reruns on typing; the app stays responsive while a panel sleeps 10 s |
| **P2** | Resource panels: `ctx.resource`, chat elements, `form`, `cache`, `set_settings` | the LLM and database examples (U1, U3) work end to end |
| **P3** | Tool panels: the scratch kernel, `ctx.sample`, `ctx.run`, `add_step`, the Try tab | U4: a threshold slider on picked rows, then "Add as step" gives a step whose result matches the trial |
| **P4** | Data panels: cell-type panels, Explore on a pick (absorbs 131 and 137 C3) | U5 and U6 |
| **P5** | Custom elements (§9 Q2), the developer page "Giving a tool, a resource or a value its own panel", an example per kind checked by `runme.py` | the examples pass |

Rough size: P1 and P2 about a week; P3 to P5 about a week more.
