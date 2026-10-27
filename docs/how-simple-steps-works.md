# How Simple Steps works: the components, as built

> Reviewed against the code on 2026-10-23 (app on core `86170a3`). Companion
> to [why we are building this](why-we-are-building-this.md), which says what
> each person needs. This doc says what exists today for each of them, and
> where the code still contradicts the goals.
>
> Each component gets a status:
> - **built:** it exists and fits the goals;
> - **partly:** it exists but is incomplete;
> - **missing:** a goal needs it and nothing provides it;
> - **contradicts:** it works against a stated goal.
>
> The deep references stay where they are: [object model](system_design/10-object-model.md),
> [data flow and storage](system_design/11-data-flow-and-storage.md),
> [core and app](system_design/12-core-and-app.md), the
> [user guide](usage_docs/user/01-concepts.md) and the
> [developer guide](usage_docs/developer/01-build-an-app.md).

## The shape in one picture

```
 USER            browser UI ── grid · formula bar · fx panel · inspector · console · chat
                     │ HTTP / SSE
 MAINTAINER      app.py ──► App(tools, resources, loaded, agent, workspace)
                     │ simple-steps run app.py
                 server (src/SIMPLE_STEPS) ── API · sessions · kernels · storage · agent
                     │ core_bridge.py (the only place core's gaps are patched)
 ENGINE          simple-steps-core ── Operation · Modifier · Workflow · Output · tools
                     ▲
 DEVELOPER       my_tools.py ── @simple_step_tool · @simple_step_resource
```

Two layers sit inside the server.

**The new layer** follows the vision:
- core's syntax;
- `kernels.py` running one core `Workflow` per open workflow;
- the `/api/agent/propose` agent;
- the `docs/usage_docs/` guides.

**The old layer** predates core and still runs beside it:
- the `=op.map(…)` syntax and `step1.col` references;
- `engine.py`'s orchestrators and `OPERATION_REGISTRY`;
- `eval_engine`, `step_proxy` and `helpers`;
- packs;
- the LangGraph chat;
- the root `usage_docs/` and most of `README.md`.

Every shipped example uses only the new layer. Most of the contradictions
below come from the old layer still being reachable.

---

## 1. The user

### What they touch

| Component | What it is | Code | Status |
|---|---|---|---|
| **Starting the app** | `simple-steps run app.py` opens a browser tab | `cli.py` | built. A user still needs Python and pip to do this; see [§3](#3-the-maintainer) |
| **Workflow tabs and the File menu** | one tab per open workflow; new, save, save as, rename | `WorkflowTabs`, `MenuBar`, `SaveModal` | built |
| **Steps** | one column per step, left to right; header, toolbar, formula row, panels | `OperationColumn`, `StepToolbar` | built |
| **Formula bar** | the step's one-line expression, and its truth | `FormulaEditor` | built. Autocomplete writes a different form from the fx panel ([123](dev_plan/123-tool-picker-discrepancy.md)) |
| **Formula panel (fx)** | pick a tool, fill its inputs, add modifiers; rewrites the formula bar. It edits a step's **operation**, never a tool's code | `ToolEditor` | built. The component's name is misleading; `OperationEditor` or `FormulaPanel` would say what it does. This is also where a developer's own components would go: a custom input for their tool's arguments (a date picker, a file chooser). That doesn't exist yet |
| **The grid (Data panel)** | the step's output as cells, first 50 rows | `DataOutputGrid` | partly. It doesn't show core's per-cell states (failed, stale, staged) yet ([124](dev_plan/124-core-009-integration.md) phase 3) |
| **Selection and inspector** | pick cells, rows or columns; see them up close; the selection popover | `gridSelection.ts`, `SelectionInspector` | partly. Phases 4–5 of 124 |
| **Cell viewer** | the full value of an image, figure, table or dict cell | `CellViewer`, `/api/cell` | built |
| **Running** | ▶ runs a step; Run runs all of them; progress; the console log | `/api/run`, SSE `/api/progress`, `ConsoleView` | built |
| **Out-of-date marks** | editing a step marks the steps after it as stale | `/api/workflow/sync`, kernels | built |
| **Environment panel** | every tool and resource, with its description, inputs and a starter formula | `EnvironmentExplorer`, `/api/environment` | built |
| **Resources menu** | create a resource (a database, a model) for this workflow | `ResourcesMenu`, `/api/resources/declare` | built |
| **Explorer** | the workspace's projects and workflows | `FileTree`, `/api/projects` | built |
| **Workspace file editor** | read and edit text files in the workspace | `WorkspaceFileEditor`, `/api/files/write` | built. Acceptable, because the workspace is data. It's only dangerous while the server imports `.py` files from the workspace ([§5](#5-contradictions-with-the-goals-ranked) #1) |
| **Settings** | where results are kept (memory or parquet), and **eval mode** | `Sidebar`, `/api/settings` | **contradicts**: eval mode turns the formula bar into a live Python `exec()`. Decided: remove it |
| **User Docs panel** | `docs/usage_docs/` inside the app | `DocsPanel` | built |
| **Agent chat** | see [§4](#4-the-agent) | `ChatSidebar` | built |

### The step expression: the general form and its exceptions

The general form is **`tool[modifiers](input, arguments)`**:

```
=with_tax[mod.map(name="total"), mod.retry(times=2)](wf["items"], rate=0.1)
 tool     one shape verb, then execution modifiers    input       arguments
```

| Part | Allowed |
|---|---|
| tool | a registered tool's name, `identity`, or a resource's method: `res["db"].lookup` |
| modifiers | at most one **shape verb**, plus any **execution modifiers** after it |
| input | at most one `wf["step"]`, naming an **earlier** step |
| arguments | literals only (`1`, `"a"`, `[1, 2]`, `{"k": "v"}`, `True`), or `res["name"]` |

The shape verbs are `source`, `map`, `filter`, `expand`, `collapse`, `group`,
`table`, `sweep` and `widen`. The verbs that run no tool are `select`,
`drop`, `rename`, `sort`, `slice` and `distinct`. The execution modifiers are
`retry`, `timeout` and `try_except`.

**The exceptions to the general form,** as the parser accepts them today:

| Exception | Example | Why it exists |
|---|---|---|
| No brackets: the verb is inferred | `=scale(wf["readings"])` | `-> bool` filters, `(acc, x)` collapses, `-> list` expands, anything else maps |
| No input: a source | `=to_rows[mod.source()](data='…')` | the first step makes a table from nothing |
| No input: a sweep | `=grid_cell[mod.sweep(model=["a","b"])]` | runs every combination of the settings |
| A bare literal | `=[3, 1, 2]`, `=7`, `={"x": 1}` | a one-cell source |
| `identity` as the tool | `=identity[mod.sort(by="n")](wf["x"])` | verbs that reshape without computing |
| Built-in reducers | `=count[mod.collapse()](wf["x"])` | `count`, `total`, `gather`, `first`, `last` |
| **Combines**, the only way to read several steps | `=join(wf["a"], wf["b"], on="city")`, `stack`, `zip_` | a normal step reads one input |
| A resource's method as the tool | `=res["sale"].sale_price[mod.map()](wf["items"])` | tools that live on a resource |
| `mod.auto()` | `=scale[mod.auto()](wf["x"])` | re-infer the verb on every run |

**What a formula can't contain today, and why.** Core was run on
2026-10-24 to check each of these (a probe on `simple-steps-core` `86170a3`).
Only one restriction is fundamental. The others are either a security
boundary or the app's parser lagging behind core.

| Restriction | Where it becomes a problem | Core (run) | Verdict |
|---|---|---|---|
| **A reference to a later step** | Steps run in order, so a later step has no output yet when this one runs. Allowing it would also allow cycles | refuses: "input 'later' comes after 's'; a step can only read earlier steps" | **Never.** Fundamental |
| **Part of a step**: rows, a column, or a cell. Core writes these as `wf["r"][0:2]`, `wf["r"][cols["n"]]` and `wf["r"][0][cols["w"]]` | Only in being stable: a position picks *whatever is now at that position*. After a re-sort, `wf["srt"][0]` picked a different row. That breaks "keeps pointing at the same data when it shifts" | **supports it**, as its own step (`wf["part"] = wf["r"][0:2]`) and as an argument (`weight=wf["r"][0][cols["w"]]`). As a tool's *input* it's refused: "make it its own step" | **Allowed (C1).** The app's parser refuses it today, so the gap is ours, not core's. **Decided (2026-10-25):** a selection picks rows by their id, and the id is the frame's index (the default index unless a tool sets one), so it follows the row through a sort. The owner is updating core for this ([008 K19](core-proposals/008-core-changes.md#k19-a-column-argument-pairs-per-row-by-type)) |
| **A whole column as an argument** (`weight=wf["r"][cols["w"]]`) | Should pair row *i* with row *i*: the tool runs on cells, and the parameter's type says how to feed it. An `int` parameter given a column gets one value per row; a `list` parameter gets the whole column | Doesn't do this today. Untyped, every row gets the whole list (`n * [10, 20, 30]` repeats the list). Typed `int`, it refuses with "join first", and the output is `None`. The working route is two steps: `zip_(wf["r"], wf["w"])`, then the tool | **Decided (2026-10-25): per-row by type.** Needs core: [008 K19](core-proposals/008-core-changes.md#k19-a-column-argument-pairs-per-row-by-type). Rows pair by their index (the row id), not by position, so a sort upstream doesn't mispair them. The owner is updating core |
| **A step as a modifier setting** (`mod.sort(by=wf["r"])`) | Modifier settings decide the output's *shape*. If they depend on data, a step's shape can't be known before it runs: no preview, no staging, and harder staleness | the form is accepted, but the value is type-checked: "by= … holds DataFrame; it must be str or list" | Possible later, if a selection yields the right type (a cell holding a column name). Not needed now |
| **A computed argument** (`weight=len("abc")`, `name=str.upper("ada")`) | In a Python script, Python works it out before core sees it, so it's harmless there. In the **formula bar**, working it out means *running code*: `str.upper` and `os.remove` have the same shape. This is the "UI never executes Python" boundary | fine in Python (core receives `3`) | **Not in the formula bar,** except for what the catalog provides. If something is worth computing, it should be a catalog tool, so its result is a step you can see |
| **A name that isn't `wf`, `res`, `mod`, a tool or `cols`** (`pd`, `np`, `math.pi`, `len`) | Each name is a door to code: `pd.read_csv` reads any file | — | The rule is really **"only names in the catalog"**. A constant or a safe function the maintainer wants becomes a catalog entry, not a hole in the grammar |

**Two forms are still accepted, but neither is an exception.** They are the
old syntax, `=ss_map(fn="op", url=step1.url)` and `=op(x=step2.col)`, and eval
mode's raw Python.

---

## 2. The developer

### What they write

```
my_app/
├── my_tools.py     functions and classes: the library
├── app.py          App(tools=[my_tools], …): optional showcase app
├── runme.py        optional: checks the saved workflows headlessly
└── workspace/projects/<project>/*.simple-steps-workflow   optional example workflows
```

| Component | What it is | Code | Status |
|---|---|---|---|
| **`@simple_step_tool`** | registers a function with core *and* with the UI's catalog. Its signature and docstring are the contract: inputs, types, defaults, the `Args:` text, the return type, and the inferred verb | `decorators.py`, `core_bridge.py` | built |
| **`@simple_step_resource`** | declares a class users can create. Its `__init__` settings become the form; its methods decorated with `@simple_step_tool` become `res["x"].method` tools | `core_bridge.py`, `resources.py` | built |
| **`Loaded(Type, …)` and `env("VAR")`** | a ready-made resource with settings locked or read from the environment, so secrets never go into a workflow file | `resources.py` | built |
| **`App(...)`** | the composition root: `tools`, `resources`, `loaded`, `agent`, `workspace`, `title`, `host`, `port`. `App(tools=[m]).serve()` is a complete app | `application.py` | built. One `App` per process, and the server is configured at import time |
| **Running it** | `python app.py` or `simple-steps run app.py` | `cli.py` | built |
| **The Python twin** | each formula is valid Python: `wf["x"] = tool[mod.map()](wf["y"])` with `simple_steps_core.grid` | core | built |
| **The checker** | `Example(app.py).check(project, workflow, expect=…)` runs a saved workflow the way the UI does | `example_check.py` | built |
| **Examples** | `basic`, `dummy_llm`, `plotly_charts`, `image_processing`, `agent_demo`, `bad_examples`, each with tools, app, workflows, a twin and checks | `examples/` | built. All 12 shipped workflows use core syntax |
| **Custom cell types** | how a value is drawn: image, figure, table, dict | `cell_types.py` | built |

### What they still see but shouldn't

| Component | Why it's confusing | Status |
|---|---|---|
| The package exports `step`, `StepProxy`, `map_each`, `apply_to`, `filter_by`, `expand_each`, `val`, `col`, `raw` | the old "steps as Python variables" model. `SIMPLE_STEPS/__init__.py`'s own docstring teaches it as the main usage | contradicts |
| `@simple_step` and `register_operation` | deprecated aliases. Both are still exported, and `src/SIMPLE_STEPS/README.md` and some docstrings still teach `@simple_step` | contradicts |
| `operation_type="dataframe"` on a tool | the old way to say "whole table"; `mod.table()` now says it in the formula | partly |
| Packs, the `packs/` and `ops/` folders, `/api/loader`, `load-ops` | tool discovery from folders; "pack" is a retired word | contradicts |
| `README.md` (661 lines) and the root `usage_docs/` | teach `=ss_map(…)`, `step1.url` and `@simple_step` | contradicts |

---

## 3. The maintainer

### What they configure and run

| Component | What it is | Code | Status |
|---|---|---|---|
| **The app definition** | `app.py` with `App(...)`: which libraries, resource types, ready-made resources and agent | `application.py` | built |
| **Per-user tool sets** | different tools or resources for different kinds of user | — | **missing**: one `App` serves everyone the same catalog |
| **Users and sign-in** | who someone is, and what they may open | — | **missing**: there's no authentication. A session is an anonymous cookie |
| **Sessions** | one browser connection, through the `ss_session` HttpOnly cookie; isolates results between connections | `session.py` | built, but not every endpoint uses it ([§5](#5-contradictions-with-the-goals-ranked)) |
| **Kernels** | one workflow, live, per session (`MAX_LIVE = 1`). Put away to disk when another opens, after `IDLE_SECONDS`, and at shutdown; restored without recomputing | `kernels.py` | built |
| **Deploying** | `--host`, `--port`, `--no-browser`; desktop mode (`pywebview`) | `cli.py`, `cli_local.py` | partly. No guidance for hosting beyond one machine |
| **Commands** | `simple-steps`, `-local`, `-dev`, `-bootstrap`, `-build` | `pyproject.toml` | partly. Five entry points, and overlapping ones (`--desktop` flag vs `simple-steps-local`) |

### Where data lives

| Data | Where | Lifetime | Status |
|---|---|---|---|
| Workflows (formulas, resource settings, step notes) | `<workspace>/projects/<project>/<name>.simple-steps-workflow` | saved by the user | built |
| Live outputs | the kernel's core `Workflow`, in RAM | while the workflow is active | built |
| A copy of every run's result | `engine.DATA_STORE[session][ref]`, in RAM; parquet under `.simple_steps_cache/<session>/` if `result_store=parquet` | **never freed** | contradicts "airtight": memory grows with every run |
| Put-away kernels | `.simple_steps_cache/<session>/kernels/<hash>.json` | until overwritten | partly. Kept relative to where the server started, keyed by browser session, not by workflow |
| Current workspace and recent workspaces | `~/.simple_steps/state.json` | across launches | built. Switching workspace needs a restart |
| Agent configuration (model, temperature, **system prompt override**) | `agent_config.json` beside `projects/` | until changed | contradicts: any user can rewrite the agent's instructions |
| Settings (result store, eval mode) | in the server process | until restart | contradicts: global for every user, and changeable from any browser |

The fixes for the storage problems are already designed in
[11 — target](system_design/11-data-flow-and-storage.md#target-shaped-like-jupyter-server).

---

## 4. The agent

| Part | Today | Code | Status |
|---|---|---|---|
| **What it sees** | each tool's name, signature and first docstring line; resources; every step's name and formula, with a **sample of its data** | `agent/scope.py` | built |
| **What it produces** | a proposal: add, change and remove, each a formula, plus a reply | `agent/proposals.py` | built |
| **The checks before the user sees anything** | every formula compiles, reads only earlier steps, uses only real tools and the workflow's resources. Failures go back to the model a couple of times; whatever is still wrong is shown with its problem | `proposals.check_step` | built |
| **What the user does** | reads the proposal, unticks changes, applies it, runs it | `ChatSidebar`, `AgentProposal` | built |
| **Running steps** | never | — | built: it can't |
| **The model** | a local Ollama model; set with `App(agent=Agent(model=…))` or `OLLAMA_MODEL` | `agent/model.py` | partly. The settings panel lists other providers, but only Ollama is used |
| **The LangGraph chat** | `/api/agent/chat` and the WebSocket `/chat/stream`: a LangGraph graph with its own prompts and catalog. **It will be the agent users use** (owner, 2026-10-24), as a later layer. Today the chat pane uses `/propose` instead | `agent/graph.py`, `agent/prompts.py` | partly. Two agents for now. When LangGraph takes over, it has to keep the guarantees `/propose` gives: the same catalog (`App`'s, §7 item 11) and `proposals.check_step` on every formula |
| **Chat history** | where conversations are kept | — | missing. Where to store it is undecided. Chat is part of a session (the active construction of a workflow) |

The design meets the goal: the agent's only output is a list of formulas,
and the checks hold every formula to the same grammar as a user's. The
remaining risk is the server around it ([§5](#5-contradictions-with-the-goals-ranked)).
A formula can't run code, but the server's other endpoints can.

---

## 5. Contradictions with the goals, ranked

Each one is measured against [why we are building this](why-we-are-building-this.md),
including its [What is acceptable](why-we-are-building-this.md#what-is-acceptable)
section.

| # | What | Against which goal | Evidence | Proposal |
|---|---|---|---|---|
| 1 | **The server imports Python from the workspace.** `POST /api/projects/{id}/load-ops` imports every `.py` file in a project folder. The pack loader discovers `packs/` and `ops/` in the workspace. `App()` with no tools scans the workspace's top-level `*.py`. By default, the workspace is `app.py`'s own folder. Since the browser can write files there (`/api/files/write`, with no session check), anyone who can reach the server can run Python on it. Read from the code; not run | nothing in the workspace is ever imported as code | `main.py:519`, `main.py:681`, `pack_loader.py`, `application.py` | **Decided:** tools come only from `App(tools=…)` and the standard set, fixed at boot. Remove `load-ops`, workspace discovery and the no-tools scan. The workspace is a mount the app defines, never its code folder (as the examples already do with `workspace="workspace"`). Saved sessions move there too, from `.simple_steps_cache` in the server's start-up folder |
| 2 | **Eval mode**: a Settings switch turns the formula bar into a Python `exec()`, for every user of that server | no runtime path runs Python a user typed | `settings.eval_mode`, `eval_engine.py`, `engine.run_operation` §2b and its fallback | **Decided:** remove it. The console already uses `safe_formula`, which allows only calls to registered tools |
| 3 | **Six execution paths in one function.** `run_operation` tries, in order: kernel, core alone, passthrough, eval, a single core op, then the legacy orchestrators | one execution path | `engine.py:743-997` | Keep the kernel path; remove the rest, starting with the four that the shipped examples never reach |
| 4 | **Four formula parsers** on the server (`formula_parser`, `safe_formula`, `operation_formula`, `eval_engine`) and three in the browser (`formulaParser.ts`, `formulaParts.ts`, `consoleParser.ts`). The autocomplete and the fx panel disagree | one syntax, one parser | [123](dev_plan/123-tool-picker-discrepancy.md) | One parser, `operation_formula`; the browser asks the server, or one TypeScript port is tested against it |
| 5 | **Four tool registries**: `OPERATION_REGISTRY`, `operations.DEFINITIONS`, the pack loader, and core's `grid.catalog()` | one registry | `decorators.py`, `operations.py`, `pack_loader.py` | `App(tools=…)` → core's catalog, and nothing else |
| 6 | **Results stored twice and never freed** | airtight; robust | [11 — what's wrong](system_design/11-data-flow-and-storage.md#whats-wrong-with-it) | Keeping results in memory is fine for now; storage may change when the app scales (owner, 2026-10-24). The leak is separate: every run adds a copy that is never freed, so a long session grows without bound even at small scale. The fix is 11's target: the kernel holds outputs, and the browser reads by step and version |
| 7 | **Global, per-process settings and agent config that any browser can change**, including the agent's system prompt | the maintainer controls the app | `/api/settings`, `/api/agent/config` | **Decided** for the agent: maintainer only, in `App(...)`. Settings: the same, with users getting read-only views |
| 8 | **No users and no per-user tool sets** | the maintainer configures what each kind of user gets | — | Needs a design doc. It's the biggest *missing* piece, not a bug |
| 9 | **Two agents** | one clear agent | `agent/graph.py` vs `agent/proposals.py` | LangGraph stays: it is the future agent. Make it one agent by having the graph produce its proposals through `proposals.py`'s scope and checks, so there's one catalog and one set of checks |
| 10 | **The old programming model is still public**: `step`, `map_each`, `@simple_step`, packs, `=ss_map` in the README | one way to do each thing | `__init__.py`, `README.md`, root `usage_docs/` | Stop exporting them, then delete them. Rewrite the README from the developer guide |

Items 1 and 2 are security problems, not tidiness, and both are now decided.
Neither needs core, and neither touches the shipped examples. That makes them
the safest place to start.

---

## 6. One home for each kind of doc

Today there are 12 doc locations. A proposed map:

| Question | One place |
|---|---|
| Why does this exist, and for whom? | `docs/why-we-are-building-this.md` |
| What are the components, and what's their state? | this doc |
| How does it work inside? | `docs/system_design/10–12` |
| How do I use it, or build on it? | `docs/usage_docs/user/` and `docs/usage_docs/developer/` (also in the app) |
| What are we changing next? | `docs/dev_plan/` (active plans only) |
| What do we need from core? | `docs/core-proposals/` |

Retire or fold in:
- the root `usage_docs/`;
- `docs/introduction.md`;
- `system_design/01–08`;
- `core-adoption-status.md` and `simple-steps-core-updates.md` (both stale);
- the old-syntax parts of `README.md`.

---

## 7. Second pass (2026-10-24): more holes

The baseline still holds: `pytest` shows 1 failure (`test_select_cell`),
and preflight passes all three checks.

### Holes in the code

| # | What | Against | Evidence | Proposal |
|---|---|---|---|---|
| 11 | **`App(tools=…)` doesn't limit what a formula can run.** With `App(tools=[scale])`, the agent sees 1 tool, a formula can run 26, and the Environment panel lists 57. Every decorated function in every imported module can be run; listing one tool from a module offers the whole module. The developer guide says the opposite: "only those (plus the built-ins) are offered" | the maintainer chooses the tools; the agent and user see the same scope | **run**: a probe with `examples/basic`. `grid_runner._tools()` and `environment.describe_environment()` read all of `OPERATION_REGISTRY`; only `agent/scope.tool_ids()` reads `App.tool_ids` | One catalog, built from `App(tools=…)` plus the standard set, used for running, the palette, the Environment panel and the agent |
| 12 | **The server loads `app.py` from the workspace.** `main.py` does `_APP = _load_app(_WORKSPACE)`. The workspace is chosen before the app: an env var, then `~/.simple_steps/state.json` (which the browser sets through `POST /api/workspace/open`), then the current folder. So `simple-steps` with no arguments runs whichever `app.py` the browser last pointed at | the workspace is defined *by* the app, and holds no code | `main.py:65-66`, `file_manager._resolve_workspace_root`, `main.py:401`. Read, not run | Invert it: the app file is the entry point (`simple-steps run app.py`), and `App(workspace=…)` names the workspace. Remove `workspace/open` and the recents list, or make them maintainer-only |
| 13 | **Settings choose the engine**: `engine: legacy \| grid`, beside `eval_mode` and `result_store`. All are global to the process, and any browser can change them, without a session | one execution path; the maintainer controls the app | `settings.py`, `POST /api/settings` | Remove `engine` along with the legacy path. `result_store` moves into `App(...)` |
| 14 | **Two sets of standard tools.** `operations.py` defines `select_columns`, `drop_columns`, `rename_columns`, `sort_by`, `filter_rows`, `group_by`, `aggregate`, `pivot`, `merge_steps`, `select_rows` and `select_cell`. Each duplicates a core verb or combine (`mod.select`, `mod.sort`, `mod.filter`, `join`, …). **The one known failing test is in one of these legacy duplicates** | one way to do each thing | `operations.py:234-524`; the failure in `test_tabular_selection.py::test_select_cell` | Keep only the standard tools that core doesn't cover (`to_rows`, `load_csv`, `literal`, …). The failing test goes with `select_cell` |
| 15 | **Arguments arrive as text on the old path,** and the main source tool takes JSON in a string: `to_rows(data='{"item": [...]}')`. The grammar allows real literals (`{"k": "v"}`), so the first step every user sees teaches the wrong form | arguments are literals | `engine.coerce_config_to_signature`; the developer guide §4 | `to_rows(data={"item": [...]})`, or a plain literal step |
| 16 | **Two kinds of output store.** `RAW_STORE` keeps dicts, scalars and lists unwrapped, beside `DATA_STORE`'s tables. This contradicts "a step's output is always a table" (the 1×1 rule) | data is always a table | `engine.py:23`, `save_raw_value`; `SHIM(core §G)` | Raw values become 1×1 tables at the boundary. Ties to item 6 |
| 17 | **Endpoints without a session check**: 26 of 35, including `files/write`, `settings`, `resources/declare`, `workspace/open`, `load-ops` and `debug/registry`. Workflows and projects are shared by everyone on the server | airtight; users isolated | the route list in `main.py` | Decide what's per user and what's shared (concept question C5), then check the session on everything per-user. Drop `debug/registry` outside dev mode |
| 18 | **Renaming a step doesn't update references to it.** Formulas refer to steps by name (`wf["readings"]`), but a rename only changes the label. Every later step that read the old name now reads a step that doesn't exist | references are the only wiring, so they must survive edits | `useWorkflow.updateStep`: no reference rewrite. Read, not run | Rename rewrites `wf["old"]` → `wf["new"]` in later steps, or refuses while references exist |
| 19 | **Sessions vs tabs**: `session.py` says two tabs "get distinct sessions" and, in the same sentence, that they share the cookie and so share state. With `MAX_LIVE = 1` kernel per session, two tabs on different workflows keep putting each other's kernel away | robust | `session.py` docstring, `kernels.MAX_LIVE` | Key kernels by workflow, as doc 11's target proposes, and fix the docstring |
| 20 | **Two step-status models.** The UI has `pending \| running \| completed \| error \| paused \| stopped`; core has `completed`, `stale`, `staged` and `invalid`, plus per-cell states. The UI maps one onto the other | one object model | `models.ts:1`, `kernels.summary` | Core's states, plus the UI's two run controls (`paused`, `stopped`) |

### Concepts that disagree

These need your decision before more features land.

| # | Question | What disagrees |
|---|---|---|
| C1 | **Can a formula reference part of a step?** | Why-doc: a reference is "a step's output, or a selection of it (a column, a row, a cell)". Spec 014 writes `wf["weights"][0][cols["w"]]`, and `expression.ts` displays it. The user guide says part of a step is *refused* ("make the part its own step with `mod.slice`"), and the parser refuses it |
| C2 | **Does a step have an identity apart from its name?** | Formulas and core name steps. The UI and the run request use ids (`step-…`) and map them to names on every call. The file saves names. Renames (item 18) are where this bites |
| C3 | **Which copy of a workflow is the truth?** | Three exist: the file (saved), the browser's copy (sent whole with every run and sync), and the kernel (outputs). Unsaved edits live only in the browser. Saved outputs are keyed by the browser cookie, so they're orphaned when the cookie goes |
| C4 | **"Session": what is saved with a workflow?** | Why-doc: the workspace holds "workflows, and the sessions saved with them". Code: put-away kernels live in `.simple_steps_cache/<cookie>/`, outside the workspace and unrelated to the workflow file. The object model says *session* = a browser connection; core's `Session` is a user's area. Three meanings |
| C5 | **What is per-user, and what is shared?** | Projects and workflows are shared by everyone on a server; results are per cookie; settings and agent config are global. There's no notion of a user. Your maintainer "manages multiple users" |
| C6 | **Vocabulary that's still split** | *pipeline* vs *workflow*: `PipelineFile`, `/pipelines`, about 100 uses. *operation* vs *tool*: `/api/operations`, `OperationColumn`, `OPERATION_REGISTRY`. *label* vs *name*. *formula* vs *expression*: the file says `expression`, the UI says `formula`. *project* vs *workspace* |
| C7 | **Phases vs real work** | `context.md` says IMPL, and 124's next gate needs a TESTS pass. Every cleanup above touches a test somewhere. The phase rules either need a cleanup mode, or each item needs a short TESTS pass |

**Status of C1–C7:** all decided on 2026-10-24, and recorded in the why-doc's
[What is acceptable](why-we-are-building-this.md#what-is-acceptable) and
[Words and what they mean](why-we-are-building-this.md#words-and-what-they-mean).
- C1: selections are allowed, and must stay stable and reproducible.
- C2: a step's id is its position.
- C3: the kernel is the truth.
- C4: a session is an active construction of a workflow.
- C5: apps are shared; isolation is deployment work, but planned for.
- C6: *workflow*; *operation* = a tool with its modifiers, arguments and
  data; *expression* = *formula*.
- C7: a `cleanup` phase.

---

## 8. Removing legacy: what each piece does, and what it would cost

The grid model is the main model, and legacy goes. This is what each legacy
piece still does, so nothing important is lost by accident. Each row needs
your confirmation before it's removed.

**Cost:**
- **none:** nothing reaches it, or it's already decided;
- **replace first:** the new path needs a small addition before this can go;
- **decide:** the cost lands on someone, and you choose.

| # | Legacy piece | What it still does | Reached from | Cost | Replaced by |
|---|---|---|---|---|---|
| L1 | **Eval mode**: `eval_engine.py`, `settings.eval_mode`, `engine` §2b and its fallback | runs typed Python | the Settings switch | none (decided) | — |
| L2 | **The engine switch**, `settings.engine: legacy \| grid` | picks the old or the new path | `/api/settings`, `/api/modifiers` | none | the grid only |
| L3 | **Tool loading at runtime**: `pack_loader.py`, `packs/` and `ops/` discovery, `/api/loader`, `/api/projects/{id}/load-ops`, the no-tools workspace scan | imports `.py` from the workspace | server start-up and two endpoints | decide: booting with no `app.py` would offer only the system tools | `App(tools=[modules])` |
| L4 | **Old-syntax formulas**: `=op(x=step1.col)`, `=ss_map(fn=…)`. Covers `formula_parser.py`, `orchestrators.py`, `orchestration_ops.py`, the op-id-and-config dispatch in `run_operation`, and `coerce_config_to_signature` | runs workflows saved before core's syntax | no shipped example; tests (`test_orchestrators`, `test_step_mode`, `test_formula_alignment`, `test_formula_switching`, …) | **decide:** users' old workflow files stop running. Options: a one-time converter, or a clear "written in the old syntax" error | core's syntax |
| L5 | **Whole-table tools whose table isn't the first parameter** (`f(n, data: DataFrame)`), routed to the legacy orchestrator by `SHIM(core §C17)` | binds the table by type | any such developer tool | **replace first:** these tools break without it | bind by type inside `core_bridge.py`, still tagged `SHIM(core §C17)`, until core does it |
| L6 | **Raw values**: `RAW_STORE`, `save_raw_value`, `SHIM(core §G)` | keeps a dict, scalar or list unwrapped, and shows it as one value | `/api/data` and `/api/cell` (`main.py:1018`, `:1064`) | replace first: the grid and cell view must read it as a 1×1 table | a 1×1 table holding the value (the data-is-a-table rule) |
| L7 | **The console's expressions**: `safe_formula.py` | the console evaluates read-only expressions over step data | `/api/console/eval` | replace first | `operation_formula`, run as a preview in the kernel, which keeps "no code" |
| L8 | **Steps as Python variables**: `step_proxy.py`, `helpers.py` (`step`, `map_each`, `apply_to`, …), exported from the package | a scripting API. Also, **calling a decorated tool in Python returns a `StepProxy`**: the decorator's wrapper uses it | the package's public API; `decorators.py:103`, `:243` | **decide:** anyone scripting this way. Calling `with_tax(3.0)` in plain Python changes from a proxy to a plain result | the Python twin, `wf["x"] = tool[mod.map()](wf["y"])` (developer guide §5) |
| L9 | **Standard tools that duplicate core**: `select_columns`, `drop_columns`, `rename_columns`, `sort_by`, `filter_rows`, `group_by`, `aggregate`, `pivot`, `merge_steps`, `select_rows`, `select_cell` | the same jobs as core's verbs | no shipped example (they use only `to_rows` and `literal`); the failing `test_select_cell` | decide, per tool. Several ways to write the same thing is fine, as in pandas (owner, 2026-10-24). The problem is several *implementations* that can disagree: `select_cell` is broken while `mod.select` works, and these tools take text (`columns="a,b"`) where the grammar has lists. Keep any spelling as a system tool, but **implement it on core's verb**, so there's one behaviour | core's verbs, with these as thin system tools on top where a second spelling helps |
| L10 | **Per-step grid runs outside a kernel**: `grid_runner.run_canonical_step`, `run_grid_step` | runs one step in a throwaway workflow | `run_operation`, when the request lacks the workflow's steps | replace first: every caller sends the workflow, as the UI already does | the kernel |
| L11 | **Endpoints the UI never calls**: `/api/parse_formula`, `build_formula`, `format_formula`, `infer_verb`, `debug/registry` | old formula round-trips | two tests, and `tests/fixtures/switch_sweep.py` | none for the UI | — |
| L12 | ~~The second agent~~ **Not legacy** (owner, 2026-10-24): the LangGraph chat is the future agent. Not removed; merged with `proposals.py`'s scope and checks (§5 item 9) | — | — | — | — |

### Tangles to cut first

Legacy and new code are woven together in four places. Removing pieces in
the order above won't work until these are separated:

1. **`grid_runner.py` is half old, half new.** `kernels.py` imports from it,
   and it also holds L10 and calls `engine.coerce_config_to_signature` (L4).
   Split it into what the kernel needs and what goes.
2. **`models.StepConfig` parses every formula with the legacy parser**
   (`models.py:203`), and **`example_check.py` does too** (`:98`). Both must
   move to `operation_formula` before L4 can go.
3. **The decorator returns `StepProxy`s** (L8). `@simple_step_tool` has to
   become a plain registration that leaves the function callable as itself.
4. **`OPERATION_REGISTRY` is the base of everything**: 19 files, legacy and
   new. It isn't removed; it becomes the catalog (§7 item 11), and the
   legacy readers go as their pieces do.

### Suggested order

1. **Decided, and nothing uses them:** L1, L2, L11.
2. **The tangles** above: no behaviour change, only moving code to its new
   home.
3. **Replace first:** L5, L6, L7, L10.
4. **Your calls:** L3, L4, L8, L9.

Each step, done in the `cleanup` phase: `pytest` stays at 1 failure, or
drops to 0 when `select_cell` goes; preflight passes; `runme.py` passes
every example.
