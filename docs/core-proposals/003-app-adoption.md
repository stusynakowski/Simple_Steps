# Proposal: what core needs before the app can adopt `App`

> **For `simple-steps-core`.** Written against `52092ba`, **re-verified against
> `1c30e03`** (2026-10-01). Status: proposal, not agreed. Companion to
> `external/simple-steps-core/docs/app-config.md`,
> `docs/writing-tools.md` and the new `docs/status.md`.
>
> Every claim below was run against the code, not read off the docs. The
> re-verification **retracted one section (§B) and narrowed two others
> (§E, §H)** — see each.

## The ask

This repo is adopting core as the backend: `App` replaces our `main.py`
bootstrap, `ToolRegistry` replaces `OPERATION_REGISTRY`, `ToolDefinition`
replaces `OperationDefinition`, and `CoreEngine` replaces `engine.py`. Four
things block that, and one is only a wrong type annotation.

## Summary

| | verdict |
|---|---|
| **A. `ToolParam` has no `description`** | **Add it.** Per-argument docs are unreachable today, so no UI can label a form field. The one real modelling gap |
| **B. ~~`description` ignores `__doc__`~~** | **Retracted — this already works.** The narrower real finding: `register_orchestrator` lacks the docstring fallback that `register` has |
| **C. `AppConfig` is missing 9 of its 14 designed fields** | **Build the rest.** `cors_origins`, `tool_modules`, `resources` and the ceilings are all in `app-config.md` §2 and absent from the class |
| **D. `register_tool(type=...)` annotation is wrong** | **Annotation-only.** It advertises 3 of the 7 legal values. Runtime accepts all 7 — verified. Cosmetic, but it misleads every author and every type checker |
| **E. `output_schema` is `None` for `DataFrame` / `Series`** | **Narrowed.** `grid.catalog()` already reports `returns='DataFrame'` and `typed`. The ask is now just to bring the engine's `output_schema` up to it — or declare it superseded |
| **F. Built-in tool grouping** | **Nothing needed.** Core already settled this with the namespace-only `ResourceSpec`. We adopt its precedent — see §F |
| **G. `ToolDefinition.type` has no `'step'`** | **Add it, or tell us the right member.** `'step'` is this repo's v0.2 *default* type. Registering one raises `literal_error`. Shimmed to `'raw_output'` — found while building the bridge |
| **H. Duplicate tool ids overwrite silently** | **Deferring to core.** `status.md` §3 already lists it and recommends a *warning*, for a better reason than our original "raise" — see §H |
| **I. Our 46 tools pass core's declaration contract** | **Nothing needed — a green light.** All four silent-failure rules clean, and `STRICT_TYPES` would accept every one. See §I |
| **J. One `DataFrame` param empties the whole `input_schema`** | **Fix — the most damaging one here.** Every property becomes `{}` and every `type_name` becomes `"Any"`, so a table tool's contract carries no types, no enums and no required flags. `input_schema` is what grounds the agent |

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

## B. Retracted: the docstring fallback already works

**This section was wrong and is kept as a correction rather than deleted.**

The original claim was that `register_tool` discards `fn.__doc__`. It does not.
`registry.py:260` has always done the right thing, at `52092ba` and now:

```python
resolved_description = description or (inspect.getdoc(fn) or "").split("\n\n")[0].strip()
```

The error was in the test, not the code: the probe passed an explicit
`description="Demo tool."`, so an explicit argument correctly won and the
docstring was never consulted. Re-tested properly:

| declaration | `description` |
|---|---|
| `@register_tool("d_none")` + docstring | `'Docstring summary line.'` ✓ |
| `@register_tool("d_explicit", "Explicit wins.")` + docstring | `'Explicit wins.'` ✓ |
| `@register_tool("d_nodoc")`, no docstring | `''` ✓ |

Exactly the behaviour §B asked for. No change needed.

### The narrower finding that is real

`register_orchestrator` does **not** share the fallback. Compare:

| | line | description |
|---|---|---|
| `ToolRegistry.register` | 260 | `description or inspect.getdoc(fn)…` |
| `ToolRegistry.register_orchestrator` | ~320 | `description=description` — raw |

So an orchestrator declared with a docstring and no `description=` registers
with an empty one, while a plain tool does not. Small, and an inconsistency
rather than a design gap — one line to align.

Still worth doing from §A: parse the `Args:` section into per-parameter text.
That is the part no amount of summary fallback covers.

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

### The grid model already solved this — the engine lags behind it

Re-checked at `1c30e03`: `grid.catalog()` does what this section was going to
ask for, and does it better.

```
tool                    returns       typed
reshape  -> DataFrame   'DataFrame'   True
to_series -> Series     'Series'      True
untyped  (no annotation) None         False
```

Against the engine's `output_schema`, which is `None` for all three.

Two things the grid version gets right:

1. **A pandas return is reported**, as the annotation's own name.
2. **`typed: False` separates "unannotated" from "annotated but not
   JSON-Schema-able"** — exactly the distinction argued for above, and the one a
   UI most wants: an unannotated tool should read as *unknown*, a `DataFrame`
   tool as *a table*.

So the ask is no longer "design a tabular schema" but the narrower **bring
`ToolDefinition.output_schema` up to what `grid.catalog()` already publishes**
— or, since `status.md` §6 says the two models should converge, treat the
engine's `output_schema` as superseded and have consumers read the catalog.

`core_bridge` already reports `output_type` and `output_form`, so our shim is
shaped like the grid version rather than the engine's. When the models converge
it should read `catalog()` directly.

Column names and dtypes stay deliberately out of scope: not knowable from a
signature, since they are a property of the data — which is what `Output.shape`
reports after a run. A contract that promised them would be guessing.

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

### Core got there first, and chose better

`status.md` §3 (new at `1c30e03`) already lists this, and recommends a
**warning, not an error** — with a reason we did not have:

> Recommended as a **warning**, not an error: re-declaration is legitimate in
> notebooks and in tests (this suite re-declares `again` five times), so a hard
> refusal would make the model painful where tools are actually written.

That is more persuasive than our original recommendation here, which was to
raise by default with `replace=True` for the deliberate case. We were reasoning
from a server that loads tool modules once at startup; core is also the library
someone drives from a notebook, where re-running a cell re-declares. A raise
would be right for our process and wrong for the library — and the library's
constraint is the binding one.

**Deferring to core's call: a warning.** Our startup can escalate it if we want
strictness in the server, which is the right place for that policy to live.

Noting the interaction with §F's aliases regardless: `qualify()` is documented
as idempotent so re-registering a bound tool passes through, and that path
should stay silent either way.

---

## I. Our tools already satisfy the declaration contract

`writing-tools.md` §2.2 (new at `1c30e03`) names four declaration rules that
currently fail **silently**, and core notes it verified no tool in *its* repo
violates them. We ran the same audit over **all 46 of ours** — the 29 system
tools plus the 17 in `examples/tools.py`:

| rule | violations |
|---|---|
| no positional-only parameters (`/`) | **0** |
| no `*args` | **0** |
| id must be an identifier (no `<lambda>`) | **0** |
| no mutable defaults | **0** |
| fully annotated (what `STRICT_TYPES` requires) | **0 of 46** |

The checker was validated against deliberately broken declarations first, so
the clean result is real and not a vacuous pass.

Two consequences worth stating:

1. **We can turn `grid.STRICT_TYPES` on from day one.** It is off by default so
   pre-existing tools keep working, but it costs us nothing and it is the rule
   core says "pays for itself" — the annotations are what let declaration
   compare a parameter against the upstream column's real dtype.
2. **Enforcing the §2.2 rules cannot break us.** Core ranks this its top next
   change (`status.md` §7) precisely because the `*args` case "returns a
   plausible wrong answer with no error." We have no exposure, so we have no
   reason to argue for a gentle rollout.

---

## J. One `DataFrame` parameter empties the entire `input_schema`

The sharpest finding in this document, and it was found by trying to read an
enum out of the schema rather than by reading code.

### Reproduction

```python
@register_tool("no_df", "x")
def no_df(mode: Literal["a","b"] = "a", n: int = 1) -> str: ...

@register_tool("with_df", "x")
def with_df(df: pd.DataFrame, mode: Literal["a","b"] = "a", n: int = 1) -> str: ...
```

```
no_df   -> {"mode": {"default":"a","enum":["a","b"],"type":"string"},
            "n": {"default":1,"type":"integer"}}
with_df -> {"df": {}, "mode": {}, "n": {}}
```

The DataFrame parameter does not merely fail to describe *itself* — it empties
`mode` and `n` too. `ToolParam.type_name` degrades the same way: every
parameter of such a tool reports `"Any"`, including the `str` and `int` ones.

### Why it matters more than it looks

`input_schema` is the derived contract: it is what a UI builds form widgets
from, and what grounds an agent's tool call. **Most tabular tools take a
DataFrame**, so for the majority of a tabular product's tools that contract is
empty — no types, no enums, no required flags.

It is also silent. A tool with no schema looks identical to a tool whose
parameters genuinely have no constraints, so nothing surfaces until a form
renders a text box where a dropdown belonged.

### Proposed

Describe what can be described and skip what cannot, rather than discarding the
lot:

1. Build the schema per parameter, so one unrepresentable annotation costs only
   its own entry.
2. Give a DataFrame / Series parameter the same treatment §E proposes for the
   return — `{"type": "object", "x-form": "grid"}` — so it reads as *a table*
   rather than as *unknown*.
3. Keep `type_name` per parameter for the same reason: a failure on `df` should
   not erase that `n` is an `int`.

### What we did meanwhile

`core_bridge.literal_options()` and `annotation_type_names()` resolve the
function's annotations with `get_type_hints` and ignore the schema. Tagged
`SHIM(core §J)`. Note `get_type_hints` is required rather than
`inspect.signature`: with `from __future__ import annotations` the raw
annotation is the *string* `"Literal['a','b']"`, which carries nothing.


---

## K. Grid: no verb hands a tool the whole table

> Consolidated into [`005-core-changes.md`](005-core-changes.md) as **K12**; §L below is **K10**.

*Added 2026-10-05, against core `d8b6979`, while moving step execution onto
the grid model (`src/SIMPLE_STEPS/grid_runner.py`). Not yet in core's
`004-grid-adoption.md`.*

Every grid verb hands a tool one row (or an accumulator and a row). A tool
written as `f(df: pd.DataFrame) -> pd.DataFrame` has no verb to run under —
and this repo has several: `pivot`, `unpivot`, `pandas_eval`, `merge_steps`,
`select_cell`, plus any user tool of that shape.

```python
@tool
def piv(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby("city", as_index=False)["n"].sum()

w["x"] = piv[mod.collapse(over=w["r"])]   # failed: AttributeError: 'NoneType'
                                          #   object has no attribute 'groupby'
w["x"] = piv[mod.map(over=w["r"])]        # invalid: piv() needs 'df', which 'r'
                                          #   does not have (it has city, n)
```

**Ask:** a verb that passes the upstream grid whole and treats a returned
DataFrame as the step's grid — the mirror image of A3's tool-backed `source`.

**Shimmed:** `SHIM(core §K)` in `core_bridge.needs_whole_frame_shim` routes
these steps to the legacy `dataframe` orchestrator.

## L. Grid: a step cannot take a value from another step

*Added 2026-10-05, against `d8b6979`. Core's 004 §B6 already plans this as P5;
recorded here because it is now shimmed.*

A bound argument is a literal. Nothing lets it be a value *from another
step*: a single-call tool reading `step1` when `step1` holds a dict, or a
`values: list[float]` parameter reading a whole column (`=Step 1!COLA`).
`over=[a, b]` is also refused (`"map over '[<a>, <b>]', which is not an
earlier step"`), so a step reads exactly one upstream.

**Shimmed:** `SHIM(core §L)` in `core_bridge.needs_whole_frame_shim` routes
these to the legacy path, which resolves the value and calls the tool. Steps
that read two upstream *tables* fail with a message naming 004 §B6.

**Two tables: closed for core-syntax formulas on `66afce2`.** Core's combine
verbs (005 B) read several grids: `join(wf["a"], wf["b"], on="k")`,
`stack(…)`, `zip_(…)`. The legacy `step1["col"]` form still reads one
upstream, and its error now points at those verbs.

---

## M. Grid: `infer_verb` reads a bound method's `self` as a column

*Added 2026-10-07, against `a799d0e`.*

For a formula written without brackets, `res["db"].lookup(wf["keys"])`, the app
infers the verb before it builds the operation, with `grid.infer_verb`. Given
the method, it counts `self` as a parameter the grid must supply:

```
grid.infer_verb(DB.lookup, upstream, {})
  -> ('collapse', "'self' is not a column but 'key' is, so this reads as a reducer")
grid.infer_verb(functools.partial(DB.lookup, None), upstream, {})
  -> ('map', 'the input is a single row')
```

Core's own Python form, `res["db"].lookup(wf["keys"])`, does infer `map`; only
the public function misses it.

**Shimmed:** `SHIM(core §M)` in `core_bridge.inferable_method` binds `self`
before inference. Delete it when `infer_verb` accepts a bound tool (or a
`(type, method)` pair).

---

## What this leaves on our side

Not core's problem, listed so the boundary is clear:

- **The `=` formula grammar is ours.** Core has no formula parser; `wf["step"] =
  tool(...)` is Python, not a typed string. `safe_formula.py` stays local, and
  so does making it the authority on step declaration.
- **Orchestration vocabulary differs.** Our seven `operation_type` values are
  not core's modifier stack. Reconciling them is the engine migration, tracked
  in `simple-steps-core-updates.md` §9, not here.
