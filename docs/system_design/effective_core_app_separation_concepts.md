# Effective core / app separation: concepts

> Written 2026-11-15, app on core `dbaf4c7` (1.0.2). Every claim about core
> below was checked by running core at that pin, not by reading its docs.
> This page states the principle and the interface; the ownership table and
> history are in [12-core-and-app.md](12-core-and-app.md), which predates
> core's `Catalog`, `Kernel` and `formula()` and should be brought in line
> with this page.

## 1. The partition

**Core decides what a workflow means and what its results are. The app
decides how people write, run, see and keep them.**

The test, unchanged from doc 12: *if a script, a notebook or the agent would
need it to get the same results, it belongs in core. If it's about how this
app shows, stores or edits them, it belongs here.*

### The rule that makes the test checkable

> **The app holds no per-step fact that core doesn't also hold.**

Any `Dict[step_name, …]` kept on the app side is either a duplicate of
something core already knows, or the mark of a gap in core. Either way it is
a finding: delete it, or ask core for it.

### What the app is for

The app adds only these, and nothing about a workflow's meaning:

| App concern | Where |
|---|---|
| Transport: HTTP, SSE | `main.py` |
| Identity: sessions | `session.py` |
| Hosting a kernel: key, lock, last used, where snapshots go | `kernels.py` |
| Live resources: building objects, settings, secrets | `resources.py` |
| Assembling the catalog from decorators, plus UI extras | `catalog.py`, `decorators.py` |
| Presentation: cell views, the formula panel, the grid | `cell_types.py`, `frontend/` |
| The agent's conversation | `agent/` |

## 2. The interface

The app talks to core through **the top-level API only**: names in
`simple_steps_core.__all__`. Within that, it needs these verbs:

| Purpose | Surface |
|---|---|
| Build | `Catalog(tools, resource_types)`, `k.define(name, type, **settings)` |
| Edit | `k[name] = formula(text)`, `k.insert`, `k.move`, `k.rename`, `k.remove` |
| Run | `k.run(name)`, `k.run_all()`; `k.on_change(cb)` reports what changed |
| Read | `k.view(step, rows)`, `k.cell(step, row, column)`, `step.status`, `k.needs_run()`, `k.validate()` |
| Save | `k.spec` / `Kernel.from_spec`; the app's additions in `extras` |
| Describe | `catalog.describe()` |

Anything outside this surface goes through
[`core_bridge.py`](../../src/SIMPLE_STEPS/core_bridge.py), tagged
`SHIM(core §X)` and recorded in
[`008-core-changes.md`](../core-proposals/008-core-changes.md).

### Where the surface is breached today

| Where | Reaches | Status |
|---|---|---|
| `core_bridge.py` | `simple_steps_core.catalog`, `.values`, `.workflow`, `k.workflow` | tagged shims (C32, C34, C37): intended |
| [`example_check.py:310`](../../src/SIMPLE_STEPS/example_check.py#L310) | `simple_steps_core.verbs.grid` | **untagged leak** |

**Proposed guard:** a preflight check that fails on any
`simple_steps_core.<submodule>` import outside `core_bridge.py`. One line,
standard library only, in keeping with preflight's rules.

## 3. Where the line is wrong today

### 3.1 Core can't hold a step whose text didn't parse

The app keeps `Kernel.problems` (step → parser's reason) and overrides the
step's status to `invalid` in
[`kernels.py:45`](../../src/SIMPLE_STEPS/kernels.py#L45),
[`kernels.py:390`](../../src/SIMPLE_STEPS/kernels.py#L390) and a separate
branch of `view()`.

Run at the pin: assigning text directly stores it as a **string literal**:

```python
k["bad"] = 'dbl[mod.map()](wf["nope"])'
k.step("bad").state      # 'completed'
k.step("bad").problems   # ()
```

**Ask of core:** declare a step from text, storing it as an invalid step with
the `FormulaError` as its problem. Then the app's problems dict goes, and
`summary()` becomes a plain reshaping of `step.status`.

### 3.2 Duplicates the app can delete now

No core change needed:

| App code | Already in core |
|---|---|
| `_literal_value` ([`kernels.py:241`](../../src/SIMPLE_STEPS/kernels.py#L241)) | `formula()` returns `7`, `[1, 2]`, `"text"`, `{"x": 1}` as values |
| `resources_of` (walks the AST again) | `Operation.resources` (`['db']` for `res["db"].q[mod.map()](wf["s"])`) |
| Version before/after diff in `run_step` ([`kernels.py:500-505`](../../src/SIMPLE_STEPS/kernels.py#L500-L505)) | `k.on_change` emits `{"action": "run", "changed": [...], "removed": [...]}` |

### 3.3 A rule about results lives in the app, twice

"A source that failed has no output" is at
[`kernels.py:508`](../../src/SIMPLE_STEPS/kernels.py#L508) and
[`grid_runner.py:136`](../../src/SIMPLE_STEPS/grid_runner.py#L136). Any front
end needs it, so it belongs in core's `Output`. **Ask of core.**

### 3.4 Two read paths for outputs

`run_step` stores frames under refs (`engine.py`'s parquet store, read by
`/api/data`); `view()` reads `k.view` directly. When the grid reads only
`k.view`, the ref store and most of `engine.py` go.
[Doc 11](11-data-flow-and-storage.md) already plans this.

### 3.5 `sync()` is generic, hosted in the app

`sync()` makes a kernel match a list of `{id, name, formula}`: renames,
removes, inserts, moves, and leaves unchanged steps alone. Any front end that
edits a kernel needs this. Two clean ways out:

- **Recommended:** the frontend sends edits that map one-to-one onto kernel
  verbs (set, insert, move, rename, remove). `sync()` disappears.
- Or ask core for `k.apply(spec)`.

### 3.6 The app's step id belongs in extras

Core's `step.id` can't replace the app's id. Run at the pin, it is a content
hash: unchanged when a step is re-declared the same, but **changed by a
rename**. The app's stable id is a legitimate UI fact. It should move from
the side map `Kernel.ids` into `step.spec.extras["simple_steps.ui"]`.

*Not yet checked:* that extras survive a rename and a re-declare.

### 3.7 Known gaps, correctly shimmed

C32 (output store), C34 (public `check_modifier` / `shape_verbs`) and C37
(`_plain` on arrays) are in `core_bridge.py` and need nothing new.

## 4. What stays in the app, deliberately

- Catalog assembly and UI extras under `simple_steps.ui`.
- Live resource objects and their settings and secrets.
- Kernel hosting and the snapshot policy.
- Cell rendering (images, figures, tables).
- Editor helpers in `operation_formula.py` (`spans`, `to_parts`,
  `format_parts`) for the two-column formula panel. `to_parts` and
  `format_parts` should build from `Operation.to_dict()` and print with
  `to_source()`, so the app never parses Python itself. Only character spans
  for highlighting need the AST.

## 5. Order of work

Each step is small, and each behaviour change is confirmed by the owner before
it lands.

1. **App-only deletions** (§3.2).
2. **Draft the asks** for §3.1 and §3.3 into `008`, with the probe output.
3. **Frontend sends edits**, not the whole step list (§3.5).
4. **Preflight import guard** (§2).
5. **Bring doc 12 in line** with this page.
