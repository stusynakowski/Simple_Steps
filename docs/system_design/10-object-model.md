# Object model

> As built on 2026-10-23, app on core `86170a3`. What each object is, who owns
> it (core or this app), and how one becomes the next. Companion docs:
> [data flow and storage](11-data-flow-and-storage.md),
> [core and app: the separation](12-core-and-app.md).

## In one line

A **workflow** is an ordered list of **steps**; each step is **one expression**
(a formula) that core turns into an **Operation**, runs in a **Workflow**, and
answers with an **Output** — a table of results plus a state for every cell.
The app keeps the formulas in a file, runs them in a **kernel** on the server,
and shows each Output as a **grid** in the browser.

## Session, kernel, kernel manager

Three words, one meaning each (owner, 2026-10-23):

```
session (a user's browser connection)
  └─ kernel (one workflow, live)
       ├─ core grid.Workflow — every step declared
       └─ every output, with its version and what it read; bookkeeping
kernel manager: which kernels are live; puts the others away to disk
```

| Word | Means | Not |
|---|---|---|
| **session** | a user's browser connection (the `ss_session` cookie); owns its kernels and its resources' live objects. Matches core's `Session` (a user's area), not Jupyter's | a workflow |
| **kernel** | **one workflow, live** — what a step is run *in*. Put away and brought back exactly, nothing recomputed. The term is Jupyter's | a process (yet), or a place arbitrary code runs |
| **kernel manager** | the policy: which kernels are live per session (`MAX_LIVE`), culling idle ones, where they're kept on disk | — |

The saved workflow file is the *recipe*; the kernel is the recipe being
cooked, with its results so far. Code: `src/SIMPLE_STEPS/kernels.py`
(`Kernel`, and the manager's functions).

## The chain, from text to screen

```
 formula text            "scale[mod.map("modifiers": [{"kind": "map", …}]), mod.name(\"score\")](wf[\"readings\"])"      app: a step's `expression`
      │  operation_formula.compile_formula     (the app parses; core only prints:
      │                                          Operation.to_source() → text)
      ▼
 Compiled                tool, verb, input, arguments, reads, resources            app
      │  .operation(...)
      ▼
 operation dict          {"tool_id": "scale", "input": {"$ref": "readings"},       core's saved form
                          "arguments": {})
      │  grid.Operation.from_dict(…, tools)
      ▼
 Operation               tool + modifier stack + input + arguments                 core
      │  wf["score"] = operation
      ▼
 Step                    Operation + Output (+ problems, warnings)                  core
      │  wf.run("score")
      ▼
 Output                  data (results) · states (per cell) · meta                 core
      │  store → ref, then /api/data → Cell[]                (today; see doc 11)
      ▼
 Cell[] / grid           value, display_value, cell_type, preview                  app
```

## Core's objects (`simple_steps_core.grid`)

Read-only here; described as the app uses them. Checked by running core, per
`docs/context.md`.

| Object | What it is | Key parts |
|---|---|---|
| **Workflow** | The graph: named steps in declaration order, plus resources | `wf[name] = …` declares; `run(step)`, `preview(step)`, `cell(step, row, col)`, `version(step)`, `arg_changes(step)`, `remove`, `rename`, `define(res, Type, …)`; `to_dict()` (steps only), `to_session_dict()` (steps + outputs), `Workflow.from_dict()` |
| **Step** | One node: **an Operation and an Output, always both** | `operation`, `output`, `problems` (why it can't run), `warnings`; `status` rolls up from its cells |
| **Operation** | What a step does — data, not code | `tool_id`, `modifiers` (stack), `input` (the step it reads), `arguments` (literals or references); `to_dict()` / `from_dict()` (saved form), `to_source()` (the formula text) |
| **Modifier** | One layer of the stack: a verb or a wrapper | `kind` (`map`, `filter`, `expand`, `group`, `collapse`, `select`, `sort`, `source`, `table`, `auto`, `retry`, `timeout`, `breaker`, `try_except`, …), `params` (literals only) |
| **Tool** | A Python function core can run | registered with `@tool` (the app's `@simple_step_tool` wraps it); `builtin_tools()` (`identity`, `count`, …) |
| **StepRef / selection** | A reference to a step, or part of one | `wf["r"]`, `wf["r"][1:3]`, `wf["r"][cols["n"]]`, `wf["r"][cols["#"]]` (row numbers), `wf["r"].header` (column names) |
| **ResRef / ResourceDecl** | A resource a step uses (an LLM client, a model) | declared by type and settings; the live object is supplied at run time |
| **Combiners** | Operations over several steps, no tool | `zip_` (pair rows by their link), `join` (by a key column), `stack` |
| **Output** | What a step produced | `data` (results, indexed by row link), `states` (one per cell), `meta` (`version`, `read`, `stale`, `stale_reason`, `auto`, `plan`, …), `notes` (row → error, cause, caught) |

### The grid

In core's vocabulary ([core's `grid-model.md`](../../external/simple-steps-core/docs/grid-model.md)),
**the grid is a step's results table: the DataFrame in `Output.data`.** It is
not a class of its own — it's the data part of an Output, with one state per
cell beside it:

```
Workflow ─ Step ─┬─ Operation      what to run
                 └─ Output ─┬─ data    ← THE GRID: rows × columns of results
                            ├─ states  one state per cell, the grid's shape
                            └─ meta    version, what it read, stale, plan, …
```

- **Tidy.** Core aims for a tidy table: each column a variable, each row one
  observation (a unit the tool ran on), each cell one value. Every step's
  output is a grid whatever its tool returns; the verb decides the shape
  (`expand` turns a list into rows, `map` gives one result per row). Hence the
  app's rule that a step's data is always a dataframe.
- **Shape** is a grid's rows × columns — what verbs change from step to step.

The word is used three ways:

| Usage | Means |
|---|---|
| **a grid** | a step's results table, `Output.data` (above) |
| **`simple_steps_core.grid`** | the *module* with core's newer model (`grid.Workflow`, `grid.Step`, …). Core holds two models during its migration: `Workflow` imported from the package top is the **older engine's** class — so this repo always writes `grid.Workflow` |
| **`grid(value)`** | a function that lifts any value (a table, a list) into an `Output`, so a chain can start from raw data in Python |

In the app, "the grid" is also what a step's Data panel draws
(`DataOutputGrid`): the browser's view of that step's grid, its first 50 rows.

> Core's vocabulary table still lists a **ledger** beside the grid. That's out
> of date: core 009 replaced it with per-cell `states` and `notes` (below).

### Rows and columns

- **`#` — the row number**: 0…n-1 down every step's grid, its own, even after a
  filter, sort or expand. What users see and reference (`rows[…]`, `cols["#"]`).
- **The row link** (the Output's index, `id` in previews): which input row each
  row came from. Internal — `zip_`, cell inputs and staleness use it; the UI
  never shows it.
- **Columns** are named (the name is the id) and numbered 0…m-1 (`cols[1]`).
- **Results only**: a `map`, `group` or `expand` step's grid holds only its
  result column; inputs are put beside it with `zip_`.

### States

| Level | Values | Meaning |
|---|---|---|
| **Cell** | `known`, `maybe`, `pending`, `blocked`, `failed`, `invalid` | mildest first; a row's state is its worst cell's |
| **Step** (`step.status`) | `staged`, `completed`, `stale`, `failed`, `invalid` | `staged`: declared, not run · `stale`: ran, but something it reads changed since (`meta["stale_reason"]`: `updated args`, `input r changed`, `r is stale`) · `failed`: has failed or blocked cells · `invalid`: has problems, can't run |

**Versions**: every Output carries a content hash of its data (`version`) and
the versions it read (`read`). Staleness is computed from these; re-running
with an identical result leaves readers fresh.

## The app's objects (this repo)

| Object | Where | What it is |
|---|---|---|
| **App** | `application.py` | The composition root of one Simple Steps application: its tools, resource types, ready-made resources, workspace, cell types, agent |
| **Tool registration** | `decorators.py`, `core_bridge.py` | `@simple_step_tool` → a core tool plus the UI's catalog entry; `simple_step_resource` for resource types. `@simple_step` is a deprecated alias |
| **Workflow file** | `<workspace>/projects/<project>/<name>.simple-steps-workflow` | JSON, `format_version: 2`: `id`, `name`, `meta`, `resources`, and `steps: [{name, expression, meta}]` — **formulas only, no data** |
| **Workflow / Step (UI)** | `frontend/src/types/models.ts` | The browser's copy: per step `id`, `label` (the name), `formula`, `status`, and run results — `outputRefId`, `outputRows`, `outputColumns`, `output_preview` (first 50 rows as cells), `warnings`, `uncaughtFailed`, `staleReason` |
| **Compiled formula** | `operation_formula.py` | Formula text in core's syntax → tool, verb, input, reads, resources → an operation dict |
| **Kernel** | `kernels.py` (`Kernel`) | One workflow, live on the server: its core `Workflow` with every step declared, each step's last Output, and bookkeeping (step id → name, formulas, problems). Kept per (session, workflow); put away to disk and restored without recomputing |
| **Stored output** | `engine.py` `DATA_STORE` / `RAW_STORE` | A copy of an Output's data under an opaque `ref`, which the browser reads by. Raw values (a `step` tool's dict or scalar) live in `RAW_STORE` |
| **Cell** | `cell_types.py` → `Cell` in `models.ts` | What the grid draws: `row_id`, `column_id`, `value`, `display_value`, and for typed values (image, figure, table, dict) `cell_type`, `summary`, `preview` |
| **Cell view** | `/api/cell` → `CellViewer` | A typed cell's full value: the whole image, the interactive figure, the full table |
| **Selection / inspector** | `gridSelection.ts`, `InspectorContext.tsx` | What the user picked in a grid (cells, rows, columns, the index), and the windows that show it up close. UI only; a selection becomes a core reference only when written into a formula |

### Older objects, staged for removal

Still in the tree for formulas in the app's older syntax (`=op.map(…)`):
`formula_parser.py`, `OPERATION_REGISTRY`, the orchestrators in `engine.py`,
and the per-step grid path in `grid_runner.py`. A workflow written in core's
syntax doesn't touch them. See `docs/cleanup-map.md`.

## Names that mean different things

| Word | In core | In the app |
|---|---|---|
| *grid* | a step's results table (`Output.data`); also the module `grid` and the function `grid(value)` | what a step's Data panel draws: the first 50 rows of that table |
| *workflow* | the live `grid.Workflow` | the saved file, and the browser's copy |
| *step* | `grid.Step` (Operation + Output) | a column on screen; its formula and its last result |
| *id* | the row link (internal) | a step's id (`step-…`), distinct from its name |
| *session* | core's older engine: `Session`, a user's area with its resources and workflows (not yet on the grid model) | a user's browser connection; owns its kernels (doc 11 proposes keying kernels by workflow path) |
| *kernel* | — (ask C33: a grid `Session` holding per-workflow kernels) | one workflow, live on the server |
