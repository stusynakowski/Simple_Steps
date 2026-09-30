# Proposal: what core needs before the app can adopt `App`

> **For `simple-steps-core`.** Written against submodule `52092ba`.
> Status: proposal, not agreed. Companion to
> `external/simple-steps-core/docs/app-config.md` and
> `external/simple-steps-core/docs/writing-tools.md`.
>
> Every claim below was run against `52092ba`, not read off the docs.

## The ask

This repo is adopting core as the backend: `App` replaces our `main.py`
bootstrap, `ToolRegistry` replaces `OPERATION_REGISTRY`, `ToolDefinition`
replaces `OperationDefinition`, and `CoreEngine` replaces `engine.py`. Four
things block that, and one is only a wrong type annotation.

## Summary

| | verdict |
|---|---|
| **A. `ToolParam` has no `description`** | **Add it.** Per-argument docs are unreachable today, so no UI can label a form field. The one real modelling gap |
| **B. `description` ignores `__doc__`** | **Fix.** `register_tool` takes the decorator's `description=` and never falls back to the function docstring. Every tool we have documents itself in a docstring |
| **C. `AppConfig` is missing 9 of its 14 designed fields** | **Build the rest.** `cors_origins`, `tool_modules`, `resources` and the ceilings are all in `app-config.md` §2 and absent from the class |
| **D. `register_tool(type=...)` annotation is wrong** | **Annotation-only.** It advertises 3 of the 7 legal values. Runtime accepts all 7 — verified. Cosmetic, but it misleads every author and every type checker |
| **E. `output_schema` is `None` for `DataFrame` / `Series`** | **Add a tabular schema.** Silently empty for the two return types a tabular product uses most — 18 of our 24 built-ins |
| **F. Built-in tool grouping** | **Nothing needed.** Core already settled this with the namespace-only `ResourceSpec`. We adopt its precedent — see §F |
| **G. `ToolDefinition.type` has no `'step'`** | **Add it, or tell us the right member.** `'step'` is this repo's v0.2 *default* type. Registering one raises `literal_error`. Shimmed to `'raw_output'` — found while building the bridge |
| **H. Duplicate tool ids overwrite silently** | **Warn or raise.** Registering an id twice replaces the first with no signal. Two tool modules shipping the same name means last-import-wins, undebuggable |

---

## A. `ToolParam` needs a `description`

### What is there now

```python
class ToolParam(BaseModel):
    name: str
    type_name: str = "Any"
    required: bool = False
    default: Any = None
    kind: Literal["data", "resource"] = "data"
    resource_name: str | None = None
```

Everything a form needs except the words. `ToolDefinition` carries a
`description` for the tool as a whole; a parameter carries none, and
`hasattr(param, "description")` is `False`.

### Why it blocks us

The tool registry panel has to render each argument with its meaning. Our
current model has the field and fills it with a placeholder —
`description="No description provided"` in `decorators.py` — which is exactly
the hole this proposal closes rather than inherits.

There is nowhere else for the text to live. `input_schema` is derived JSON
Schema; its `title` comes from the field name and its `description` is empty
for the same reason.

### Proposed

```python
class ToolParam(BaseModel):
    ...
    description: str = ""     # from the docstring's Args: entry, else ""
```

Populated by §B's parser. Default `""` keeps every existing construction valid,
and `frozen = True` is unaffected.

---

## B. `description` should fall back to `__doc__`

### The behaviour

```python
@register_tool("demo", "Demo tool.", category="X")
def demo(path: str, n: int = 3, fs = Resource("file_system")) -> dict:
    """Do a thing.

    Args:
        path: where to read from.
        n: how many.
    """
```

```
description : 'Demo tool.'          ← the decorator argument
```

The docstring is discarded — body, `Args:` and all. Omit `description=` and
`ToolDefinition.description` is `""`, even though the function documents itself
three lines down.

### Why it matters beyond tidiness

The docstring is where authors actually write. All 17 tools in
`examples/example_server/tools.py` and all 24 in `src/SIMPLE_STEPS/operations.py`
document themselves that way, several with worked `=formula(...)` examples in
the body. A contract derived from signatures but not docstrings throws away the
only prose that exists.

It also feeds the agent layer: `input_schema` is what grounds a tool call, and
an unlabelled schema is an ungrounded agent.

### Proposed

1. `description` falls back to the first paragraph of `fn.__doc__` when the
   decorator argument is omitted. An explicit argument still wins.
2. Parse the `Args:` / `Parameters:` section (Google and NumPy styles — both
   appear in this repo) into §A's `ToolParam.description`.
3. Copy both into `input_schema` / `output_schema` as JSON Schema
   `description` keys, so the derived schema carries the prose too.

Worth stating explicitly: **the parser must not fail a registration.** A
malformed docstring yields empty descriptions, never an import-time error. Tool
registration happens at startup; a docstring typo must not take the server down.

---

## C. `AppConfig` is a third of its design

`app-config.md` is marked "settled design, not yet built," and the class matches
that. Measured:

| field | designed §2 | built |
|---|---|---|
| `title`, `host`, `port`, `storage`, `freeze` | ✓ | ✓ |
| `orchestrators` | — | ✓ (extra, undocumented) |
| `cors_origins`, `root_path` | ✓ | ✗ |
| `tool_modules`, `resources` | ✓ | ✗ |
| `session_ttl_seconds` | ✓ | ✗ |
| `max_concurrency`, `max_cells_per_step`, `max_payload_bytes`, `request_timeout_seconds` | ✓ | ✗ |

### What we need, in order

**`cors_origins`** — first blocker. Our frontend is a Vite dev server on `:5173`
talking to `:8000`; without it every request is blocked by the browser and
`App.serve()` cannot host our UI at all.

**`tool_modules` + `resources`** — the substance of the `app.py` we are writing.
They are what makes tool loading a *declaration* instead of the seven
import-time directory scans in our `main.py`. This is the whole point of the
adoption, and §F depends on it.

**The ceilings** — not needed on day one. Worth noting they are the fields most
likely to be got wrong later, since §1's default-versus-ceiling rule is the one
invariant that stops `AppConfig` rebuilding the config cascade the model
deleted. Building them late is fine; building them as defaults is not.

`orchestrators: bool` is real and undocumented — `app-config.md` §2 should gain
it, since it decides whether `register_orchestrators` runs at construction.

---

## D. `register_tool(type=...)` advertises 3 of 7 values

```python
def register_tool(..., type: Literal["source", "dataframe", "raw_output"] = "raw_output", ...)
```

`ToolDefinition.type` accepts seven:

```
('source', 'map', 'filter', 'dataframe', 'expand', 'raw_output', 'orchestrator')
```

**Runtime is fine.** `register_tool(type="map")` registers and reports
`type='map'` — the decorator argument is a plain parameter and pydantic never
validates it. So this is not a functional blocker, and an earlier read of ours
that called it one was wrong.

It still matters: 18 of the 24 operations we are migrating are `map`, and the
signature tells their authors — and every type checker — that `map` is not a
legal value. Widen the `Literal` to match `ToolDefinition.type`.

---

## E. `output_schema` is empty for the two types we return most

A tool's return annotation becomes `output_schema`, except when it is a pandas
type. Probed across return annotations against `52092ba`:

| `-> ` | `output_schema` |
|---|---|
| `dict` | `{'result': {'type': 'object', …}}` |
| `str` | `{'result': {'type': 'string'}}` |
| `int` | `{'result': {'type': 'integer'}}` |
| `list[str]` | `{'result': {'type': 'array', 'items': {'type': 'string'}}}` |
| `pd.DataFrame` | **`None`** |
| `pd.Series` | **`None`** |
| *(unannotated)* | `None` |

The cause is reasonable — neither is JSON-Schema-able by pydantic — but the
consequence is that the field is blank for most of a tabular product's tools.
Of the 24 built-ins we are migrating, 18 return `DataFrame`.

`None` is also indistinguishable from "author forgot to annotate," which is the
case a UI most wants to tell apart: an unannotated tool should read as *unknown*,
a `DataFrame` tool as *a table*.

### Proposed

Emit a schema for tabular returns rather than `None`. The minimum that is
honest:

```python
{"title": "<tool>_Output", "type": "object", "x-form": "grid"}     # DataFrame
{"title": "<tool>_Output", "type": "object", "x-form": "column"}   # Series
```

`form` is already core's own word for this — `Output.form` is the cardinality
class, `"scalar" | "column" | "grid"` (`grid-model.md` §1). So the value to
report is one core already defines; this only carries it into the derived
schema.

Column names and dtypes are deliberately **not** proposed here. They are not
knowable from a signature — they are a property of the data, which is what
`Output.shape` reports after a run. A schema that promised them would be
guessing.

---

## F. Built-in tools: core already answered this

Recorded here because it is the question that prompted the adoption, and the
answer is "core settled it," not "core needs something."

We have 24 data-manipulation operations (reshaping, cleaning, sources, file IO)
that ship with the product. The question was how to model them: loose globals,
a "pack" (a term this repo is deliberately retiring), or a resource with bound
tools.

Core faced exactly this for its own built-ins and chose the third, with a twist
that makes it fit our case precisely — `orchestrations.py:440`:

```python
def orchestration_resource(registry) -> "ResourceSpec":
    """Build the built-in ``orchestration`` resource against *registry*.

    It is **namespace-only**: its tools take no injected resource ...
    What the resource provides is the namespace — ``orchestration-map``,
    ``orchestration-group`` — and a single place to ask what orchestration
    the system can do.
    """
```

A `ResourceSpec` with no `factory` and no `value` is **namespace-only**: it
groups tools and injects nothing, and `install()` is a no-op on the container.
So a resource is available as pure organisation before any runtime object
exists.

That is the future-proof property we were looking for. A namespace-only spec
becomes resource-backed by adding `factory=` to the *same* spec — the tool ids,
the registrations and the saved workflows referencing them do not move. The
grouping decision does not have to be re-litigated when one of these operations
eventually needs a real object behind it (a cache, a store, a connection).

Two properties we get by adopting it, both already implemented:

- **Qualified ids.** `reshape-add_column`, so two resources can each ship a
  `list` without colliding (`qualify()`, separator `-`).
- **Aliases.** Core registers `orchestration-map` with bare `map` as an alias
  precisely so "saved workflows, existing specs, and `registry.has("map")` all
  keep working." Our saved workflows reference bare `add_column`; the same
  mechanism carries them.

**No core change requested.** This section exists so the decision is recorded
against the code that justifies it.

---

## G. `ToolDefinition.type` rejects `'step'`, our default

Found while building the bridge, not by reading. Registering any `'step'` tool
through core raises:

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for ToolDefinition
type
  Input should be 'source', 'map', 'filter', 'dataframe', 'expand',
  'raw_output' or 'orchestrator' [input_value='step']
```

`'step'` is not an exotic mode here — `models.py` documents it as "the v0.2
single-cell default — one call, one return value, no row iteration," and it is
the type the current product hands new steps. Core's seven members cover every
*other* value we use.

### What we did

`core_bridge._CORE_TYPE_ALIASES` translates on the way into core and keeps the
local value verbatim:

| ours | sent to core | why |
|---|---|---|
| `step` | `raw_output` | one call, one raw value out, no orchestration |
| `rowmap` | `map` | a row-wise map; core has no separate row/cell distinction |

### The question for core

`raw_output` is our reading of the closest member, not a confident mapping.
Either:

1. **`'step'` joins the Literal** — if a single un-orchestrated invocation is a
   distinct kind in the grid model, which `grid-model.md`'s "a non-dict input is
   positional — an unorchestrated step over a bare value" suggests it might be; or
2. **`raw_output` is confirmed as correct** and `'step'` is just our older
   spelling of it, in which case the alias becomes permanent and this repo
   should retire the word.

Worth settling before the engine migration, because it decides whether `step`
is a mode or a synonym — and our default type should not be a guess.

---

## H. Duplicate tool ids overwrite in silence

```python
@register_tool("dup", "first")   def a(...): ...
@register_tool("dup", "second")  def b(...): ...
# -> registry holds "second". No warning, no error.
```

Verified. Nothing reports that a registration replaced another.

This is the failure mode a registry exists to prevent. Tools arrive from
several modules at startup; two of them choosing `clean` or `parse` means the
survivor depends on import order, with no signal anywhere. The symptom is a
tool that runs the wrong code, which is about the worst shape a bug can take.

### Proposed

Raise on a duplicate id by default, with `replace=True` for the deliberate
case (a notebook re-running a cell, which is presumably why overwrite is
permissive today). A warning would be the softer option, but a raise is right:
registration happens at startup, where failing loudly is cheap.

Note this interacts with §F's aliases — `qualify()` is documented as
idempotent so re-registering a bound tool passes through, and that path must
stay silent.

---

## What this leaves on our side

Not core's problem, listed so the boundary is clear:

- **The `=` formula grammar is ours.** Core has no formula parser; `wf["step"] =
  tool(...)` is Python, not a typed string. `safe_formula.py` stays local, and
  so does making it the authority on step declaration.
- **Orchestration vocabulary differs.** Our seven `operation_type` values are
  not core's modifier stack. Reconciling them is the engine migration, tracked
  in `simple-steps-core-updates.md` §9, not here.
