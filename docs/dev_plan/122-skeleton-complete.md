# 122 — What "skeleton complete" means

> Status: **draft for discussion**, 2026-10-06, against core `66afce2`.
> Revised 2026-10-07: resource syntax, type matching and app defaults (§1.3,
> §2); D2 and D3 decided.
> **Progress 2026-10-07:** core built slices 1–2 (`a799d0e`) and the app adopted
> them: S2.2 (class and method decorators), S2.3 (`res["…"]` in formulas), and
> the `resources` section in files and runs (defined resources only). See
> `examples/all_orchestrations/projects/demo/resources.simple-steps-workflow`.
> Sections 1–4 are the four things to add; §6 lists the decisions to settle
> before building them. Everything else is in §7 (later) and §8 (cleanup).

After the skeleton, the remaining work is fixing bugs and cleaning up small
features. The skeleton is complete when these four exist and work together:

| # | piece | in one line | owner |
|---|---|---|---|
| **S1** | **One object model** | Every component an app is built from (tools, resources, workflows, sessions, storage, agent, renderers) is a named, swappable object, composed in one `app.py` | app (core supplies the parts) |
| **S2** | **Resources** | Objects a workflow uses, such as an LLM, a database or a file system. Each is created from literal arguments, *defined* in the workflow or *loaded* from the deployment, and the methods its developer marks are tools | core + app |
| **S3** | **The agent** | Reads the current scope and proposes an updated list of expressions. The user accepts and runs them, and the loop continues | app |
| **S4** | **Custom data types in cells** | A cell can hold an image, a Plotly figure, a nested table…, shown as a summary that opens a viewer | app (core: storage) |

**In plain terms:**

- A **tool** is a Python function a user can put in a step.
- A **resource** is an object tools work *with*, such as an LLM or a
  database. You create one with a few settings, like `Claude(model=…)`.
- Some tools **belong to** a resource: they're its methods, such as
  `res["db"].query(…)`. Other tools just **need** a resource of the right
  kind: `summarize` works with any LLM you hand it.
- A **session** is one user's open workflow, with its results and its live
  resources.
- The **app** wires all of this together, and every part has a sensible
  default, so a developer only configures what's different about their
  deployment.
- The **agent** suggests steps. The user decides what to keep and runs it.

Dependencies: **S1 decides where S2–S4 live**, so it comes first. S2 and S4
are independent of each other. S3 comes last, because the agent needs the
tool and resource catalog (S2) and must know what a cell holds (S4).

---

## 0. Where things stand (verified by running, 2026-10-06)

- **Core has two object models.** The *engine* side
  (`simple_steps_core.App`, `AppConfig`, `Session`, `SessionManager`,
  `Resource`, `ResourceSpec`, `ResourceContainer`, `MediaAsset`,
  `MediaStore`, `CodecRegistry`, `ToolUI`, `Guardrails`, `Stage`) already
  has most of S1, S2 and S4. The *grid* model, which this app actually runs
  on (`grid_runner.py`), has **none of them**:
  `[n for n in dir(grid) if 'resource'|'session'|'media'|'codec' in n]` is empty.
  Core's 006 §2.1 says the engine's resource design is to be *ported*, not
  reinvented.
- **The app runs one step at a time** in a throwaway `grid.Workflow`
  (`run_formula`), so no long-lived object owns a workflow, its resources or
  its outputs. Session state is a cookie (`session.py`) plus a ref store in
  `engine.py`.
- **The agent exists but predates the grid model.** `agent/` is a LangGraph
  graph (`gather_context → reason → respond`). Its prompt
  (`agent/prompts.py`) teaches the old formula syntax
  (`=fetch_youtube_videos(...)`, the legacy `map`/`dataframe` modes), and
  its proposals come back as chats or changes to the workflow, that the user can accept or regect
- **Cells are text.** `/api/data` sends `display_value: str(value)` for
  every cell (`main.py` ~787–822). A dict shows as its Python repr, and an
  image or a figure has no way to appear at all.
- **The console already has an edit vocabulary.** `WorkflowCommand`
  (`frontend/src/types/commands.ts`) is `set | add | remove | rename | run |
  preview`. That covers exactly what an agent needs to propose (§3.3).

---

## 1. S1 — One object model

### 1.1 The goal

A developer installs `simple-steps`, writes their tools and resources in their
own repo, and serves them. Deployments differ — a laptop, a desktop window,
a shared team server, embedded in someone's existing service — so every
component that varies by deployment must be **an object you pass in**,
not a behaviour hard-coded in `main.py`.

### 1.2 The components

| component | what it owns | today | varies by deployment? |
|---|---|---|---|
| **App** | the composition root: one of each component below, plus config | `main.py` module globals; `settings.py`; three CLIs | — it *is* the configuration |
| **ToolRegistry** | the tools a deployment exposes, with contracts parsed from signatures and docstrings | core's `REGISTRY` + `decorators.OPERATION_REGISTRY` + `pack_loader` (three tiers) | yes: which packages, which namespaces, frozen or not | 
| **ResourceRegistry** | resource *types* (classes) and *loaded* instances provided by the deployment | `simple_step_resource` → core `ResourceSpec`; not wired to the grid | yes: credentials, endpoints, which LLM |
| **Workspace** | where workflow files live and how they are listed, read and written | `file_manager.py` (folders under `projects/`), `workspace_state.py` | yes: local folder, git repo, S3, a database |
| **Workflow** | an ordered list of `(name, expression)` plus defined resources; the saved artifact | `.simple-steps-workflow` JSON (format 2) | no: one format everywhere |
| **Session** | one user's live working area: a workflow being edited, its run outputs, its resource instances | cookie identity (`session.py`) + ref store (`engine.py`) | yes: in-memory, persisted, shared |
| **SessionManager** | creating, finding, expiring and isolating sessions | implicit | yes: single user vs. many |
| **Store** | step outputs and large cell payloads (media), addressed by ref | `engine.save_dataframe` / parquet per session | yes: memory, disk, object storage |
| **Identity** | who the user is, and what they may see | none (a session cookie only) | yes: none, local user, SSO |
| **Agent** | proposes expression edits from scope (§3) | `agent/` (LangGraph) | yes: model, provider, on/off, which skills |
| **TypeRegistry** | Python type → how to store it, summarize it in a cell, and view it (§4) | none | partly: built-ins fixed, developer types added |
| **Docs** | the catalog a user and the agent read: tools, resources, examples, skills | `/api/operations` (from docstrings) | yes: which skills and examples ship |

### 1.3 What composing it looks like (sketch, not a final API)

**Everything has a default.** The smallest app is the developer's tools and
nothing else:

```python
# app.py — in the developer's repo
from SIMPLE_STEPS import App
import my_tools

App(tools=[my_tools]).serve()
```

A deployment overrides only what differs:

```python
from SIMPLE_STEPS import App, DiskStore, Agent
from my_tools import image_tools, stats_tools
from my_resources import ClinicalDB, Claude

app = App(
    tools=[image_tools, stats_tools],
    resources=[ClinicalDB, Claude],              # resource types users may create
    loaded={"db": Loaded(ClinicalDB, url=env("DB_URL"), api_key=env("DB_KEY"))},
    store=DiskStore("/srv/simple-steps/data"),   # override: shared disk
    agent=Agent(model="claude-opus-5-5", skills="./skills"),
)
app.serve()                                      # or app.desktop(), or mount app.api
```

| setting | default when not given |
|---|---|
| `title`, `host`, `port` | `"Simple Steps"`, `127.0.0.1`, `8000` (core's `AppConfig` defaults) |
| `tools` | the built-in tools only (verbs, `identity`, `count`, …) |
| `resources`, `loaded` | none |
| `workspace` | `FolderWorkspace("./workflows")`, next to `app.py` |
| `sessions` | `MemorySessions()`: one user, in memory, no login |
| `store` | `DiskStore("./.simple-steps/data")`, per session |
| `identity` | none: anyone who can reach the port is the user |
| `agent` | off unless an API key is present; then `claude-opus-5-5` |
| `types` | the built-in cell types (§4.2) |
| `freeze` | `False` locally, `True` when served to others (no new tools at run time) |

Settings can also come from environment variables or a `simple-steps.toml`,
so the same `app.py` runs on a laptop and on a server unchanged.

Every CLI (`simple-steps`, `-dev`, `-local`) becomes "find the `app.py`,
or build a default App, then serve it". This replaces item 5 of
`docs/core-adoption-status.md`, which is still not started.

### 1.4 What to build

- **S1.1** An `App` object in this package that owns the components in §1.2
  and builds the FastAPI app from them. `main.py`'s globals move onto it.
- **S1.2** An interface for each component that varies by deployment, with
  the current behaviour as the default implementation (`FolderWorkspace`,
  `MemorySessions`, `DiskStore`). Same behaviour, now swappable, and
  `App()` with no arguments reproduces today's app exactly.
- **S1.3** A long-lived `Session` that holds a `grid.Workflow` across runs,
  so resources, outputs and staging persist instead of being rebuilt for
  every step (`run_formula` today). This is also what core 006 §2.4 asks:
  *"resources may be the reason it grows a session owner."*
- **S1.4** One reference document, `docs/object-model.md`, written from the
  code once S1.1–S1.3 exist.

**Ask of core:** decide whether `App` / `Session` / `ResourceContainer`
(engine) are lifted free of the engine for the grid, or whether the app owns
those layers and core stays at `Workflow`. Either way works for the app; it
needs to know which.

---

## 2. S2 — Resources

### 2.1 The model

A **resource** is an object a workflow uses that is not data, such as an LLM
client, a database connection, an external file system or an MCP server.

- **It is created from literal settings only:** `Claude(model="claude-opus-5-5")`,
  `ClinicalDB(url="postgres://…")`. It never takes a table or a step, so it
  can always be rebuilt from how it was declared.
- **It is either defined or loaded.**
  - *Defined*: created in the workflow from its settings, and saved with
    the workflow. Opening the workflow elsewhere rebuilds it.
  - *Loaded*: provided ready-made by the deployment (`App(loaded=…)`),
    referenced by name. This is where credentials live, so **secrets are
    never saved in a workflow**.
- **Methods marked as tools are bound tools**: `query` on a database,
  `complete` on an LLM. They always act on their own resource. **Only
  marked methods are tools.** `connect()`, `close()` and other helpers stay
  ordinary Python (§2.4).
- **Other tools need a resource without belonging to one (unbound tools)**:
  `summarize(text: str, llm: LLM)` works with *any* LLM. The parameter's
  type says what kind of resource fits, and **only that kind is accepted**.

### 2.2 How it looks in a formula

```
res["claude"] = Claude(model="claude-opus-5-5")     # define a resource
```

**A bound tool is reached through its resource**, just as you'd call a
method on an object:

```
=res["db"].query(sql="select * from visits")                     # verb inferred
=res["db"].lookup[mod.map()](wf["visit_ids"])                    # with modifiers
```

**An unbound tool takes the resource as an argument**, after the input:

```
=summarize[mod.map()](wf["notes"], res["claude"])                # by position
=summarize[mod.map()](wf["notes"], llm=res["claude"])            # by name
```

- Given by position, a resource fills the tool's parameter **whose type
  matches it**, so its position doesn't matter. If two parameters take the
  same kind of resource, the formula must name them (`llm=…`).
- **Types must match.** If `claude` is a `Claude` and the parameter wants an
  `LLM`, that works only if `Claude` is a kind of `LLM` (a subclass, or
  something that implements the same methods). Passing a `ClinicalDB` where an `LLM` is
  wanted is a **declaration error**, shown as you type and before anything
  runs. The type is known from how the resource was declared, so the check
  doesn't need the resource to be loaded.
- A resource that is declared but **not loaded or not healthy** (its
  service is down, its credentials are missing) is a **run-time** status on
  the step: *"resource `db` is not loaded"*.
- So a developer who wants "any LLM" writes a small base type (`class LLM:
  def complete(self, prompt: str) -> str`) and has `Claude`, `GPT`, etc.
  implement it.
- The rule from 120 becomes: **`wf["…"]` is a table, `res["…"]` is a
  resource, everything else is a literal.**

### 2.3 Spec vs. container: the two objects core already has

Core's engine has both, and both are needed. One describes a *kind* of
resource; the other holds the *live instances*:

| | **ResourceSpec**: the recipe | **ResourceContainer**: the pantry |
|---|---|---|
| what it is | the definition of one kind of resource: how to build it, how to check it's healthy, and the tools bound to it | one session's set of live resources, by name |
| how many | one per resource type, for the whole app | one per session |
| holds | a factory, a health `check`, a description, its bound tools | the actual objects: `{"db": <ClinicalDB>, "claude": <Claude>}` |
| when it acts | at startup, registering the type and its tools | on first use, building an instance lazily (verified: not loaded until `get`) |
| in this plan | lives in the app's **ResourceRegistry** | lives in each **Session** |

Running core confirms the roles. A `ResourceSpec("kv", factory=…)` with
one `@spec.tool("get_key")` registers the tool as `kv-get_key`, and
`spec.install(container)` puts `kv` in the container, built only when first
read.

**Two things core does differently from this plan:**

1. **Core's engine matches by name, not by type.** A tool's `Resource()`
   parameter is filled from the container key with the same name
   (`operations/registry.py:188`). The *grid*, though, already checks a
   bound object against the parameter's annotation at declaration
   (`llm=DB()` where `llm: LLM` is refused), so type matching (§2.2) can build
   on that check.
2. **Core hides resources** (006 §2.1–2.2): they're injected by name, never
   shown, never saved. This plan makes them **visible, chosen per step, and
   saved when defined**. The reasons come from
   `WHY_WE ARE_BUILDING_THIS.md`: users don't trust what they can't see,
   and the agent has to be able to propose *which* resource a step uses.

**Ask of core**: written up as [`core-proposals/006-mvp-requests.md`](../core-proposals/006-mvp-requests.md)
(R1–R5), checked against core `66afce2`. In short: resource types built from literals
only; marked methods as bound tools (`res["db"].query`); typed resource parameters
on unbound tools, checked at declaration; a resource reference in operation
JSON (`{"$res": "claude"}`) resolved at run; and a workflow-level list of
defined resources in `to_json`.

### 2.4 Where resources are defined and loaded

Three places, one per person involved:

| what | who | where | when it's built |
|---|---|---|---|
| **Type**: the class, its settings, its bound tools | developer | their Python, next to their tools | registered at startup |
| **Loaded instance**: comes with credentials, shared by the deployment | deployment | `app.py` (`App(loaded=…)`), secrets from environment variables | on first use, per session |
| **Defined instance**: the user's own settings | user | the workflow's `resources` section, from the UI or a formula | on first use, per session |

**Types live with the tools.** Tools are found by scanning the workspace's
`tools.py` (or the packages passed to `App(tools=…)`), and resource types come
from the same place. `simple_step_resource`, today a function that groups
tools, also decorates a class:

```python
# tools.py — the developer's repo
@simple_step_resource
class ClinicalDB:
    """Read-only access to the study database."""
    def __init__(self, url: str, api_key: Secret):    # settings: literals only
        ...
    @simple_step_tool                                  # marked: a bound tool
    def query(self, sql: str) -> pd.DataFrame:
        """Run a read-only query."""
        ...

    def close(self) -> None:                           # not marked: not a tool
        ...
```

The class is the whole contract: the constructor is the settings form, the
**methods marked `@simple_step_tool`** are the bound tools, and their
docstrings are their help text.

**Which methods are tools is always explicit.** A method is a tool only when
the developer marks it with `@simple_step_tool`, the same decorator as any
other tool. Everything else (`close`, `connect`, `_retry`, helpers) is plain
Python:

- users and the agent see **only marked methods**: in the catalog, the
  Resources menu, and the formula bar's suggestions;
- `res["db"].close()` in a formula is refused with *"close is not a tool of
  ClinicalDB; its tools are: query"*;
- tool code can still call any method. An unbound tool like `summarize`
  calls `llm.complete(...)` whether or not `complete` is marked, because marking
  controls what can go in a *step*, not what Python can call.
A setting annotated `Secret` accepts only a pointer (`"env:DB_KEY"`, or the name
of a loaded resource), never a value, so a secret can't be typed into a
workflow.

**Loaded instances live with the deployment.** The deployment gives the
*settings*, not a finished object, so a user can adjust them and the workflow
can record what was used:

```python
App(tools=[my_tools],
    loaded={"db": Loaded(ClinicalDB,
                         url=env("DB_URL"), api_key=env("DB_KEY"),
                         locked=["url"])})        # settings users may not change
```

Credentials stay here, never in a workflow file and never in the agent's
context. `Secret` settings are always locked; `locked=` locks others.

**Defined instances live in the workflow.** The user creates one in the
toolbar's Resources menu, or in the console with
`res["claude"] = Claude(model="claude-opus-5-5")`. It's saved in the
workflow's `resources` section.

**Where resources appear in the UI: a dropdown in the workflow toolbar.**
A resource belongs to the workflow, not to a step, so it lives in the toolbar
that acts on the whole workflow (Run / Pause / Stop / Clear / Logs), as a
closed **Resources (n) ▾** menu: always in view, never in the way while
someone builds steps.

```
[▶ Run] [⏹] [Clear] │ [Resources (3) ▾] │            ● Online   [Logs]
                      ┌───────────────────────────────────────┐
                      │ ● db    FakeDB()          used by regions  ✎ × │
                      │ ● llm   FakeLLM(model="fake-1")  not used  ✎ × │
                      │ 🔒 study ClinicalDB (loaded)              × │
                      │ + New resource                          │
                      └───────────────────────────────────────┘
```

- **The menu creates and changes resources.** Each row shows the resource as
  the formula that creates it (`FakeLLM(model="fake-1")`) and which steps use
  it. ✎ edits that formula; **+ New resource** takes a name and a definition,
  with the app's resource types as one-click templates. The backend checks a
  definition with core before it is saved, so a bad setting never reaches the
  file.
- **Steps only use resources.** A step formula that tries to create one,
  `=res["x"] = Claude(…)`, is refused: *"a step can use a resource but not
  create one. Create it from the Resources menu…"*.
- **The console matches the menu.** `res["x"] = Type(…)` creates or changes
  a resource and `del res["x"]` deletes one: the same commands the menu
  emits, so a session's transcript replays (118).
- **A resource a step uses can't be deleted.** The menu says which steps use
  it, the way core refuses to remove a step that others read.
- **When a resource needs attention** (its type isn't in this app; later: a
  loaded one is missing, or the deployment's settings differ from
  `as_loaded`) the button shows a red dot instead of a separate notice.
- **The sidebar's Session Manager stays the developer's view:** which
  resource types and tools the app offers (`GET /api/resources`). The toolbar
  menu is *this workflow's* resources.

**When an instance is built:**

- **Not when a workflow opens.** Opening a file never connects to a database
  or calls an LLM.
- **On first use**, when a step that refers to it runs. Core's
  `ResourceContainer` already works this way (verified: not loaded until
  `get`).
- **Once per session**, so users never share state by accident. A type
  can be marked `shared=True` (a connection pool, say) to have one instance
  for the whole app.
- **Closed when the session ends** (`ResourceContainer.aclose()`).
- **Health-checked** when the Resources menu opens and before a step runs.
  A failure shows on the step: *"resource `db` is not loaded"*.

### 2.4a Every resource a workflow uses is saved in it

Whether a resource was loaded, loaded and then adjusted, or defined by hand,
**the workflow records it**. A workflow file then says exactly what it ran
with, and opening it elsewhere knows what to ask for:

```jsonc
"resources": {
  "claude": {"source": "defined", "type": "Claude",
             "settings": {"model": "claude-opus-5-5", "temperature": 0},
             "secrets":  {"api_key": "env:ANTHROPIC_API_KEY"}},

  "db":     {"source": "loaded", "type": "ClinicalDB",
             "as_loaded": {"url": "postgres://study"},   // non-secret settings, when saved
             "overrides": {"timeout": 30}}               // what the user changed
}
```

| `source` | built from | saved |
|---|---|---|
| `defined` | the saved `settings`, with secrets from their pointers | everything except secret values |
| `loaded` | the deployment's settings for that name, plus the saved `overrides` | the type, the non-secret settings as they were (`as_loaded`), and the user's `overrides` |

- **Changing a loaded resource** writes an override, never a copy. The
  deployment's settings still apply underneath, so a credential rotation
  doesn't break the workflow. Locked and `Secret` settings can't be
  overridden.
- **When the deployment's settings differ from `as_loaded`** (say the
  model changed from one release to the next), the Resources menu shows the
  difference when the workflow opens. Nothing changes silently in either
  direction.
- **Opening the workflow where that name isn't loaded**: the type and the
  non-secret settings are known, so the panel asks the user to supply the
  rest. The workflow then saves it as `defined`, or the deployment loads it.
  Steps that use it still declare; they report *"resource `db` is not
  loaded"* only if run.
- **A defined resource can't take a loaded resource's name.** To adjust a
  loaded one, the user changes it, which saves an override. Otherwise a
  workflow could quietly swap the deployment's database for its own.
- The `source` / `as_loaded` / `overrides` record replaces the separate
  `requires` section suggested earlier: one list says both what a workflow
  needs and how it was configured.

### 2.5 What to build

- **S2.1** (core) the grid-side resource model above, porting
  `ResourceContainer` / `ResourceSpec` where they fit
  ([`core-proposals/006-mvp-requests.md`](../core-proposals/006-mvp-requests.md) R1–R4).
- **S2.2** `simple_step_resource` as a class decorator (§2.4): constructor
  literals = settings, methods marked `@simple_step_tool` = bound tools
  (unmarked methods are never exposed), docstrings = their contracts, `shared=` for one app-wide instance. The current function form
  keeps working for tool groups.
- **S2.2a** A `Secret` setting type that accepts only `"env:…"` pointers or
  a loaded resource's name, refused at declaration otherwise.
- **S2.2b** `App(loaded=…)` taking `Loaded(Type, **settings, locked=[…])`,
  and an `env("NAME")` helper. Instances are built lazily per session (one per
  app when `shared`), health-checked, and closed with the session. A defined
  resource with a loaded resource's name is refused.
- **S2.2c** The workflow's `resources` section (§2.4a): every resource used,
  with `source`, `settings` / `secrets` for defined ones and `as_loaded` /
  `overrides` for loaded ones. Show differences from `as_loaded` on open, and
  ask for a missing loaded resource instead of failing.
- **S2.3** `res["…"]` in `operation_formula.py`: the bound form
  `res["x"].tool[…](…)` and the argument form `tool[…](wf["…"], res["x"])`,
  compiled to `{"$res": …}`, with the type check from §2.2. `is_canonical`
  must also recognize `res[`: today `=res["db"].query(sql=…)` has no `wf[` or
  `mod.`, so it isn't detected as core syntax and goes to the old parser
  (*"res['db'].query is not a tool"*).
- **S2.4** The toolbar's **Resources menu** (§2.4). **Built 2026-10-07**
  (`ResourcesMenu.tsx`): list with definitions and users, add from a name +
  `Type(…)` with type templates, edit, delete refused while used, a red dot
  for an unavailable type, the console's `res["x"] = …` / `del res["x"]`, and a
  step formula that tries to create one refused. **Still to do:** loaded
  resources with overrides (needs core slice 3), `res["` suggestions in the
  formula bar (needs editor completions), clicking a `res["…"]` in a formula
  to open it (needs U4 chips), and health checks (after the MVP).
- **S2.5** The example: add a resource to `examples/all_orchestrations`
  (e.g. a toy key-value store with `get`/`put` methods, plus one unbound
  tool), and pin it in `check.py`.

---

## 3. S3 — The agent

### 3.1 What it does

The agent **proposes; the user disposes.** On each turn it reads the scope,
then returns an updated list of expressions. It never runs a step, never
creates a tool, and never edits the workflow without the user accepting the
change. After the user runs the steps, the agent sees the results, and the
loop continues.

### 3.2 What it reads (the scope)

| input | source |
|---|---|
| the task, in the user's words | the chat |
| the tool and resource catalog: names, signatures, types, docstrings, guardrails | the `ToolRegistry` / `ResourceRegistry` (S1) |
| the current workflow: each step's expression, its status, its problems and warnings | the `Session` (S1.3) |
| what the outputs look like: columns, row counts, a few sample cells (summaries for custom types) | the `Store` + `TypeRegistry` (S4) |
| errors from the last run, per row | `metrics.row_errors` |
| related sessions or workflows | the `Workspace` (search by name or by the tools they use) |
| **skills**: developer-written playbooks ("how we analyse a clinical image set") | a folder the App names (`Agent(skills=…)`) |

### 3.3 What it returns

A **proposal**: an ordered list of `WorkflowCommand`s, the same vocabulary
the console uses, minus `run` and `preview`:

```json
{"summary": "Load the images, measure each one, join the metadata, then plot.",
 "commands": [
   {"kind": "add", "name": "files", "after": null},
   {"kind": "set", "target": "files",
    "formula": "=list_files[mod.source()](folder=\"/data/study\")"},
   {"kind": "set", "target": "metrics",
    "formula": "=measure[mod.map()](wf[\"files\"], model=res[\"seg\"])"}
 ]}
```

**Every proposed formula is compiled and checked before the user sees it**
(`compile_formula` + core's `check`). A proposal that doesn't compile, or
that names a tool or resource outside the catalog, goes back to the agent with
the error rather than being shown as valid. That makes it **fail-safe**:
whatever the agent writes, the worst it can produce is a rejected
suggestion.

### 3.4 What the user sees

The proposal shown as a diff of the step list (added, changed, removed),
which can be accepted per step or all at once. Accepted steps are staged,
not run. The user runs them, and the agent's next turn includes the results.

### 3.5 What to build

- **S3.1** Rewrite `agent/prompts.py` for core syntax, `res["…"]`, and the
  proposal schema. Retire the legacy modes from the prompt.
- **S3.2** Structured output: the agent returns the proposal JSON (tool
  use / structured output), not prose with formulas inside.
- **S3.3** The validation loop in §3.3, server-side.
- **S3.4** Scope assembly (§3.2) from S1's objects, with a size budget
  (sample cells, not whole tables).
- **S3.5** The diff/accept UI in `ChatSidebar`, applying accepted commands
  through the same path as the console.
- **S3.6** Skills: a folder of markdown playbooks the App points at. They
  are listed in the agent's context and read when relevant.
- **Default model:** `claude-opus-5-5`, configurable through the existing
  `agent_config.json`. Keep the provider-agnostic LangGraph layer, or drop
  it if structured output is simpler without it (decide in S3.2).

---

## 4. S4 — Custom data types in cells

### 4.1 The model

A cell holds a Python value. The **TypeRegistry** maps a value's type to three
things:

| | what | example for an image |
|---|---|---|
| **store** | how the value is kept and handed to the next step | bytes in the media store, by content hash; the next step gets the image object back |
| **summary** | what the grid cell shows | a thumbnail and "512×512 PNG" |
| **viewer** | what opens when the cell is clicked | full-size image, zoom |

`/api/data` sends `{type, summary, ref}` instead of `str(value)`. The grid
draws the summary, and the viewer fetches the full value by `ref` when the
cell is opened, so a column of images doesn't load every full image.

### 4.2 Built-in types for the skeleton

| type | summary | viewer |
|---|---|---|
| text, numbers, booleans | the value (as today) | — |
| dict / list | `{3 keys}` / `[12 items]` | collapsible JSON tree |
| DataFrame in a cell | `table 40×3` | nested grid |
| image (PIL, ndarray, `MediaAsset`) | thumbnail | full image |
| Plotly figure | small static preview or icon | interactive plot (`plotly.js`) |
| file path | file name and size | open/download |
| anything else | `repr`, truncated | full `repr` |

A developer registers their own type with the same three parts. The fuller
version, with input UIs, guardrails and custom methods, is in §7.

### 4.3 What to build

- **S4.1** `TypeRegistry` with the built-ins above.
- **S4.2** Values stay real objects in the session (`Store` keeps the object,
  or a ref to its bytes). Display never goes back into data: a later step
  reads the image, not its thumbnail.
- **S4.3** `/api/data` returns `{type, summary, ref}`, and a new endpoint
  returns a cell's full value for its viewer.
- **S4.4** Cell renderers and viewers in `DataOutputGrid`.
- **S4.5** Example tools that return an image and a Plotly figure, in the
  example workflow and in `check.py`.

**Ask of core:** port `MediaAsset` / `MediaStore` / `CodecRegistry` to grid
outputs, so `to_json` can save a workflow whose outputs include media. The
rendering stays in the app.

---

## 5. Order of work

1. **S1.1–S1.3**: `App`, swappable components, a long-lived `Session`. No
   user-visible change. `check.py` and the tests must stay green throughout.
2. **S4.1–S4.4**: types in cells. Independent of core, and immediately
   visible.
3. **Core 007 (resources)**: write it, then core builds S2.1.
4. **S2.2–S2.5**: resources in the app, once core has S2.1.
5. **S3**: the agent, once the catalog includes resources and cells have
   summaries.
6. **S1.4**: the object-model doc, written from what was built.

Steps 2 and 3 can run in parallel.

---

## 6. Decisions to settle first

| # | question | recommendation |
|---|---|---|
| D1 | Does core own `App`/`Session` for the grid, or does the app? (§1.4) | **The app owns them**; core stays at `Workflow` + resource types. Fewer moving parts across two repos. |
| D2 | Are resources visible and chosen per step, or injected invisibly (core 006)? (§2.3) | **Decided 2026-10-07: visible**, written out in the formula. |
| D3 | How is a resource referenced? | **Decided 2026-10-07: `res["x"]`.** Bound tools are `res["x"].tool(…)`; unbound tools take `res["x"]` as an argument (§2.2). |
| D3a | Does a resource have to match the parameter's type? | **Decided 2026-10-07: yes**, checked at declaration. Subclasses and same-method types count as a match. |
| D4 | Can a defined resource hold a secret? | **No.** It names an environment variable or a loaded resource. |
| D5 | What is a skill? | A markdown playbook in a folder the App names. No code, no tools of its own. |
| D6 | Does the agent see real data? | **Summaries and a few sample cells**, never whole tables, and nothing from resources unless a step already output it. |
| D7 | Multi-user in the skeleton? | **The interfaces support it** (S1.2), but only the single-user implementation ships. Shared sessions and identity are §7. |

---

## 7. Later (after the skeleton)

- **Type hints and docstrings** feeding staging and the agent (core 006 §1 is
  mostly built; the app shows parameter docs for only 65% of parameters).
- **Templates for developer-defined tools and resources**: input UIs,
  guardrails, interactive output representations, their own methods. Core's
  engine has `ToolUI` and `Guardrails` to port.
- **Stages**: group consecutive steps into one named idea that runs as a
  unit (core's engine has `Stage`).
- **Cleaner syntax**, and calls inside calls (core P0).
- **Parallel execution**, across rows and across independent steps; other
  compute backends.
- **MCP servers as resources**, so their tools appear as bound tools.
- **Identity, shared sessions and permissions** for team deployments (D7).
- **Hardening**: an airtight run path and fail-safe operations whatever an
  agent proposes, beyond §3.3's validation.

## 8. Cleanup (bugs and small features)

Tracked here so they don't get lost. Not part of the skeleton:

- `test_select_cell` (`KeyError: 0`); the two frontend tests with incomplete
  `services/api` mocks (`App.test`, `MainLayout.test`).
- Core: a failed row turns an integer column to float (`100.0`), which needs
  a request filed with core. Also the `over=[a, b]` `TypeError` (core 005 K11).
- 121's open UI items (U2 cells/blocks, U4 chips, U5, U6, U9) and backend
  items A3–A5 (remove the string guessing; references by name; migrate saved
  workflows).
- Core asks C5, C6, C9 and C11 (121 §3), with C5 and C11 first: wrong results.
- `check.py` compares stored outputs but not what the UI shows. Add a
  rendered-view comparison.
- Stale docs: `docs/core-adoption-status.md` (last verified 2026-09-30) and
  `docs/dev_plan/README.md` (its summary still describes `step1["col"]`).
