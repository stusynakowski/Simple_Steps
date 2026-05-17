# Stage 3 — Formula Grammar & Shape Vocabulary

*Date: 2026-05-17*
*Status: **3a–3d shipped, 3f partially shipped (mock_tabular_selection)**, 3e–3f in progress*

## Implementation log

| Sub-stage | Status | What landed |
|---|---|---|
| **3a** | ✅ shipped | `safe_formula.validate()` + `_interpret()` now accept chained subscripts (`step["col"][n]`), homogeneous list keys (`step[["a","b"]]`, `step[[0,2]]`), and slices (`step[0:5]`). `StepProxy.__getitem__` routes a list-of-ints through `.iloc` so positional row subsets do the intuitive thing. |
| **3b** | ✅ shipped | Scratch-verified that every `select_*` op formula in `mock_tabular_selection` and every `.rowmap`/`.source`/`.dataframe`/`.expand` formula in `mock_youtube_analysis` has a clean modifier-free equivalent that produces identical results. |
| **3c** | ✅ shipped | `safe_formula.parse()` silently strips legacy `.rowmap` / `.source` / `.filter` / `.dataframe` / `.expand` / `.map` / `.flatmap` / `.raw_output` modifiers via the `_LEGACY_MODIFIER_RE` pre-rewrite. Existing workflow files keep loading. New saves never emit modifiers. |
| **3d** | ✅ shipped | `formula_parser.py` reduced from 155 lines of regex to a ~190-line legacy-shape adapter (1 trivial regex left for `is_step_reference`). All parsing/build logic lives in `safe_formula`: new helpers `parse_call()`, `build()`, `format_value()`, `_arg_source()`, `_source_of()`. The frontend `ParsedFormula` JSON contract is preserved verbatim; `orchestration` is always `None` for Stage 3+ formulas. `_arg_source()` keeps two legacy quirks alive: string-literal args are unwrapped (so `make_table(rows="...")` round-trips), and literal `List/Dict/Tuple` args are JSON-encoded (so `select_columns` can still `json.loads()` them). |
| **3f.1** | ✅ shipped | `mock_tabular_selection`: all four `select_*` workflows rewritten to pure subscript syntax (`step1`, `step1[["name","score"]]`, `step1[[0,2]]`, `step1["score"][1]`). Enabling change: `engine._passthrough` now falls back to `safe_formula.run_formula()` when the legacy regex resolver can't handle a `_ref`. Series → 1-col frame; scalars → 1×1 frame (column label inferred from the innermost string subscript key). |
| **3e.0** | ✅ placeholders | `src/SIMPLE_STEPS/core_pack_v2_preview.py` registers 8 non-functional Stage-3e ops (`literal_preview`, `make_table_preview`, `expand_preview`, `filter_preview`, `pivot_preview`, `melt_preview`, `groupby_agg_preview`, `cross_join_preview`) under category `"Core (preview · Stage 3e)"`. Bodies raise `NotImplementedError`. Purpose: UI engineer can introspect `/api/operations` and confirm the new op shape is renderable *before* implementations land. |
| **3e** | ⏭ next | Implement the four canonical ops (`literal`, `make_table`, `expand`, `filter`) and drop the `_preview` suffix. |
| **3f.rest** | ⏭ pending | Rewrite `mock_table_manipulations` + `mock_youtube_analysis`; delete `select_*`, `define_variable`, `filter_rows`, `expand_cell`. |

Tests: **215/215 passing** after 3a–3d + 3f.1 + 3e.0. Zero regressions.

---

## 1. The principle

> **The formula bar should be as short as it can be — but no shorter.**
> Brevity is the default; explicitness is opt-in when the cost or behavior
> of the call deserves attention.

A corollary:

> **Orchestration is not a property of the call. It is a property of the
> data shapes flowing in and out.**

Both follow from the goal: *make a workflow file readable without
external context*, and *make a workflow writable by people who think in
spreadsheets, not in pandas*.

---

## 2. The real problem

`.rowmap`, `.source`, `.filter`, `.dataframe`, `.expand` were originally
introduced as **orchestration modifiers**, but they are actually
**shape adapters** masquerading as orchestrations.

The fundamental question of any dataflow language is:

> **How does the shape of one step's output match the shape another step
> expects as input?**

Different systems answer it differently:

| System         | Answer |
|----------------|--------|
| Spreadsheets   | Everything is a 2-D grid; broadcasting is invisible (drag down). |
| SQL            | Set semantics; everything is a relation; `JOIN` aligns shapes. |
| dplyr / tidyverse | Tidy-data convention + verbs (`group_by`, `summarise`, `pivot_*`). |
| Pandas         | Explicit shape transformations; user manages them. |
| Beam / Spark   | Typed `PCollection`s; the shape *is* the type. |

Simple Steps is closest to **spreadsheet + tidyverse**: a UI where the
user *sees* the data at every step, plus a small set of shape-transforming
verbs they call when shapes don't already line up.

`.rowmap` and friends were an attempt to put shape adaptation into call
syntax. We can do better.

---

## 3. The six shape categories

Every workflow ever written in this system is a composition of these six:

### Declaring shape (where data starts)
- **literal** — one cell. `=42`, `="hello"`, `=[1,2,3]`, `={"a":1}`.
- **to_rows / make_table** — one column or whole frame from raw data.
- **source** — call an external thing and accept whatever shape it returns.

### Selecting (narrowing shape)
- **whole step** — `step1`
- **column** — `step1["col"]`
- **cell** — `step1["col"][n]`
- **column subset** — `step1[["a","b"]]`
- **row subset / slice** — `step1[[0,2]]`, `step1[0:5]`

### Applying functions (preserving shape)
- **scalar in scalar slot** — `f(x=step1["col"][0])` → one call, one result
- **series in scalar slot** — `f(x=step1["col"])` → broadcast row-wise, get a column
- **frame in frame slot** — `f(df=step1)` → one call on the whole frame

The dispatch is **already done** by `_auto_broadcast` based on the type
of argument vs. the parameter's annotation. The formula does not need to
repeat that decision.

### Reshaping (changing shape)
- **expand** — unnest a column of dicts/lists into more columns or rows
- **pivot** — long → wide
- **melt** — wide → long
- **groupby + agg** — collapse rows

### Filtering (removing rows)
- **filter / keep_where** — predicate over rows

### Composing (nested function calls)
- Pure Python: `=clean(text=fetch(url=step1["url"])["title"])`. No special syntax.

---

## 4. What each layer should own

| Layer            | Owns                                                  |
|------------------|-------------------------------------------------------|
| **Formula grammar** (`safe_formula`) | Literals, step refs, selection patterns, function-call syntax. **Nothing else.** |
| **Built-in ops** (registered functions) | `make_table`, `expand`, `pivot`, `melt`, `groupby`, `filter` — i.e. reshape and filter verbs. |
| **Runtime** (`_auto_broadcast`) | Dispatching scalar/series/frame based on declared param type and actual arg shape. |
| **UI**           | Rendering badges (cost, shape, mode) so the user doesn't have to encode them in the formula. |

Crucial: **mode is not in the formula**. The formula bar carries data
references and op calls — that's it. How the call iterates is decided
by the function's signature plus the shape of the arguments at runtime.

---

## 5. Audit of the four mock workflow projects (2026-05-17)

| Mock | Workflows | Steps | What it actually tests |
|------|-----------|-------|------------------------|
| `mock_basic_variables` | 8 | 14 | **Literal shape declaration** — bare literal of every Python type. |
| `mock_tabular_selection` | 4 | 8  | **Narrowing shape** — cell / column / row / table selection from a frame. |
| `mock_table_manipulations` | 6 | 11 | **Reshape** — unnest dicts/lists, build frames. |
| `mock_youtube_analysis` | 5 | 23 | **End-to-end composition** — source → broadcast → reshape → broadcast → filter. |

### Top-level ops in use (41 steps total)

```
 5  define_variable     ← workaround for dict/list literals in the bar
 5  expand_cell         ← legitimate reshape verb
 5  make_table          ← legitimate frame constructor
 5  fetch_channel_videos
 5  extract_metadata
 4  transcribe_video
 3  segment_conversations
 3  analyze_sentiment
 1  select_cell         ← workaround for missing syntax
 1  select_columns      ← workaround for missing syntax
 1  select_rows         ← workaround for missing syntax
 1  select_table        ← workaround for missing syntax
 1  generate_report
 1  filter_rows         ← constrained filter (col/value/mode), not a predicate
```

### Modifier usage

```
13  .rowmap(   ← redundant; auto-broadcast covers it
 5  .source(   ← redundant; function signature covers it
 3  .expand(   ← belongs on the op's return shape, not on the call
 1  .dataframe( ← redundant; function signature covers it
```

**Every single modifier in the corpus is either redundant or
mis-located.** Zero exceptions.

### Workarounds the corpus reveals

| Today | What it's working around |
|-------|--------------------------|
| `select_cell(data=step1, row_index=1, column="score")` | `step1["score"][1]` not yet supported by grammar |
| `select_columns(data=step1, columns=["name","score"])` | `step1[["name","score"]]` not yet supported |
| `select_rows(data=step1, row_indices=[0,2])` | `step1[[0,2]]` not yet supported |
| `define_variable(value='{"name":"alice"}', type="json")` | Dict-literal in the bar not yet supported by grammar (though AST parses it) |
| `.rowmap`, `.source`, `.dataframe` on a call | `_auto_broadcast` not yet trusted as the single source of truth |

→ These are not features. They are **scar tissue** from earlier grammar
limitations. Stage 3 removes the scars.

---

## 6. What Stage 3 produces

### Syntax additions to `safe_formula`

In `validate()`, allow these subscript forms (all with bare-`Name(step)`
or a column already obtained from one):

```python
step1                       # whole frame (already works)
step1["col"]                # column (already works)
step1["col"][n]             # cell  — outer subscript int key (NEW)
step1[["a","b"]]            # column subset (NEW)
step1[[0,2]]                # row subset (NEW)
step1[0:5]                  # row slice (NEW)
```

In `_interpret()`, route each to the corresponding StepProxy / ColumnProxy
access pattern. (Some methods exist; some need adding.)

In `describe()`, return `{op, kwargs, step_refs}` — **no orchestration
field**. The orchestration is implicit in the shapes.

### Back-compat strip during transition

`safe_formula.parse()` silently strips `.rowmap` / `.source` / `.filter`
/ `.expand` / `.dataframe` / `.map` / `.raw_output` between an op name
and its `(`. Old workflow files keep loading. New saves emit without
modifiers. After all workflows are clean, the strip can be removed.

### Built-in ops to standardise

In a `core` pack:

- `literal(value)` — single cell of any Python type. Also the bare-literal fallback.
- `make_table(rows=[dicts]) -> DataFrame` — frame constructor.
- `expand(column) -> DataFrame` — unnest dicts/lists into more rows/cols.
- `filter(df, predicate) -> DataFrame` — keep rows where `predicate(row)` is true. (Replaces today's `filter_rows`.)
- *(future)* `pivot`, `melt`, `groupby_agg`.

### Ops to delete

- `select_cell`, `select_columns`, `select_rows`, `select_table` — replaced by selection syntax.
- `define_variable` — merged into `literal`. The `type="json"` parameter goes away because direct dict/list literals are now first-class in the bar.
- `filter_rows` — replaced by predicate-based `filter`.

### `formula_parser.py` deletion

`models.py` and `main.py` switch to `safe_formula.describe()` / `build()`.
`formula_parser.py` is deleted. `scripts/backfill_formulas.py` updated to
use the new builder.

### Mock rewrites (the acceptance test)

| Mock | After Stage 3 |
|------|---------------|
| `mock_basic_variables` | **Unchanged.** Already uses bare literals — already correct. |
| `mock_tabular_selection` | All `select_*(...)` replaced by selection syntax. The four ops are deleted. |
| `mock_table_manipulations` | `define_variable(value='...json string...', type="json")` replaced by direct `={...}` or `=[...]` literals. `expand_cell` renamed to `expand`. |
| `mock_youtube_analysis` | All `.rowmap` / `.source` / `.dataframe` stripped. `extract_metadata.rowmap(video_url=step1)` becomes `extract_metadata(video_url=step1["video_url"])`. `filter_rows.dataframe(column="views", value="50000", mode="greater_than")` becomes a predicate-based `filter`. |

If all four mocks read cleanly with no modifier syntax anywhere,
Stage 3 is done.

---

## 7. Order of operations

In dependency order, each as its own commit so we can checkpoint:

1. **3a — Extend `safe_formula` grammar.** Add the four missing
   selection patterns to `validate()` and `_interpret()`. Add the
   corresponding StepProxy / ColumnProxy access methods if they don't
   already exist.

2. **3b — Verify with the PoC.** Test every shape transition the mocks
   need, modifier-free.

3. **3c — Drop modifier grammar.** `parse()` strips legacy modifiers.
   `describe()` and `build()` drop the orchestration field.

4. **3d — Switch call sites.** `models.py` and `main.py` use
   `safe_formula.describe()` / `build()`. Delete `formula_parser.py`.

5. **3e — Standardise built-in ops.** Add `filter`, ensure `expand`,
   `make_table`, `literal` are first-class.

6. **3f — Rewrite the four mocks.** Delete the redundant ops
   (`select_*`, `define_variable`, `filter_rows`).

---

## 8. Proof of concept (already run, 2026-05-17)

A scalar-signature op registered fresh:

```python
@simple_step(category="Test")
def upper_url(video_url: str) -> dict:
    return {"upper": video_url.upper(), "len": len(video_url)}
```

Run modifier-free via `run_formula`:

```
=upper_url(video_url=step1["video_url"])
```

Result: per-row broadcast, three rows in → three rows out, merged with
the source frame. **Identical to `.rowmap` behavior, with zero special
syntax in the formula bar.**

This was the unblock: the runtime is already shape-aware.
`_auto_broadcast` is the single source of truth for "how to iterate."
Stage 3's job is to *stop encoding that decision twice* — once in the
op's signature, once in the formula modifier.

---

## 8.5 Multi-step row-wise iteration (zip-by-index)

A common case the modifier-free syntax must handle: a single call drawing
columns from **two or more different prior steps** of the same row count.

```
=score(url=step1["url"], views=step2["views"], likes=step2["likes"])
```

### Rule

> All `step["col"]` arguments inside the same call must come from steps
> with the same row count. The runtime pairs them by row index. If row
> counts don't match, it errors before running.

That's the entire contract. `_auto_broadcast` already iterates
`i = 0..n-1` and picks `series.iloc[i]` from each column argument,
regardless of which step the column originated from. We just need to
add an up-front shape check so a length mismatch fails loudly with a
diagnostic naming the offending columns, instead of silently truncating
or raising a bare `IndexError`.

### Cartesian product is not automatic

Cross-product / cross-join is a real shape operation (every row of A
paired with every row of B), and it should never happen by accident.
It will be a future reshape verb (`cross_join(a, b) -> DataFrame`),
added when the need arises. **Decision deferred** — not in Stage 3
scope.

---

## 9. What this does *not* address (and why that's fine)

**Cost / latency awareness.** A separate concern. Will be handled by a
`cost` field on `@simple_step` rendered as a UI badge — not by formula
syntax. Tracked in a future "explicitness layer" follow-up.

**Streaming / partial evaluation.** Not in scope. The shape vocabulary
above describes *what* flows between steps; the engine decides *when* to
materialise. Today everything is materialised; that's fine for v1.

**Cross-step type checking.** The op's parameter annotation describes
what shape it wants; the runtime checks at call time. Static
pre-flight checking (squiggle in the formula bar if the column type is
wrong) is a v2 feature.

**User-defined ops in the bar.** Today ops must be registered Python
functions. Lambdas / inline functions in the bar are not allowed (and
won't be — that's where eval-injection lives).

---

## 10. Why this matters strategically

Today's formula syntax is a leaky abstraction: half spreadsheet, half
pandas, half method-chaining (three halves on purpose). Each `.rowmap`
or `.expand` is a small piece of evidence that the abstraction isn't
hanging together.

After Stage 3, the formula bar is **pure Python expressions**, with
exactly one convention beyond Python itself: the leading `=` to signal
"this is a formula, not a label." That's a clean line. Everything past
it is regular Python, parsed by `ast`, restricted by a small allow-list,
dispatched by argument shape.

The mocks stop being "examples we happened to migrate" and become
**the canonical spec** for what the formula system has to handle. If a
mock workflow can't be expressed cleanly, the grammar is wrong — and
the fix is well-defined: add a shape primitive, add a built-in op, or
write a clearer reshape verb.

That is the test we should hold every future change to.

---

## 11. Core pack v2 — table-op concepts (Stage 3e spec)

This is the operational spec for the four canonical table verbs that
Stage 3e ships. Each has a placeholder registered today in
`src/SIMPLE_STEPS/core_pack_v2_preview.py` (suffix `_preview`, category
`"Core (preview · Stage 3e)"`) so the UI can introspect the shape now,
before implementations land.

### Guiding principles

1. **The annotation is the contract.** Every parameter has a real Python
   type annotation. The runtime (`_auto_broadcast`) reads the annotation
   to decide whether the arg should be passed whole (`pd.DataFrame`),
   per-row (scalar slot + `pd.Series` arg = broadcast), per-column
   (`pd.Series` slot), or as a Python value (`Any`).
2. **One op = one shape transform.** No more `select_*` family — that's
   what subscript syntax is for. Ops only exist when they *change shape*
   in a way Python expressions can't.
3. **No string-in-the-middle.** When an arg is a list or dict, it is
   passed as a real Python list/dict — *not* a JSON string the op then
   re-parses. The grammar already produces literal `List`/`Dict` AST
   nodes; the runtime now passes them through.
4. **Built-in ops are spec, not implementation.** The placeholder
   docstrings *are* the spec. If the docstring is ambiguous, the op
   isn't ready.

### 11.1 `literal(value: Any) -> DataFrame`

| Aspect | Detail |
|---|---|
| Replaces | `literal` (string-eval) + `define_variable(value="...", type="json")` |
| Input | Any Python value (scalar, list, dict, nested) |
| Output | 1×1 DataFrame, column `"value"`, cell = the value unchanged (opaque) |
| Bar sugar | `=42`, `="hi"`, `={"k":"v"}`, `=[1,2,3]` all desugar to `literal(value=...)` |
| Why opaque | Dicts/lists are *single values*, not implicit tables. Call `expand` to unfold. |

### 11.2 `make_table(rows: List[dict]) -> DataFrame`

| Aspect | Detail |
|---|---|
| Replaces | `make_table(rows="<json string>")` |
| Input | A real Python list-of-dicts. The bar's literal-list syntax produces this directly — no `json.loads` step. |
| Output | N rows × M cols (union of dict keys; NaN for missing) |
| Sister ops | `to_rows` stays for `{"col": [values]}` columnar input and list-of-scalars. |

### 11.3 `expand(df: DataFrame, column: Optional[str] = None, sep: str = ".") -> DataFrame`

| Aspect | Detail |
|---|---|
| Replaces | `expand_cell()` |
| Input | Whole frame + optional target column |
| Behaviour | If `column` is None and frame is 1×1, expand the single cell (legacy `expand_cell` behaviour). Otherwise unnest the named column. |
| Cell-type rules | list-of-dicts → explode rows + dict keys → cols; list-of-scalars → explode rows + `"value"` col; flat dict → keys → cols on same row; nested dict → `"a.sep.b"` cols; scalar → pass-through |
| Why one op | The old `expand_cell` quietly assumed 1×1. Real workflows need column-aware expansion. Same verb, broader contract. |

### 11.4 `filter(df: DataFrame, predicate: str) -> DataFrame`

| Aspect | Detail |
|---|---|
| Replaces | `filter_rows(column=..., value=..., mode=...)` |
| Input | Whole frame + a Python boolean expression as a string |
| Eval semantics | Predicate is parsed via `safe_formula` (same allow-list as the formula bar). Column names are bound to the corresponding `pd.Series` of the frame. Operators `&`, `\|`, `~`, parens, `.str.*` methods all work. |
| Output | K rows × M cols (K ≤ N), index reset, row order preserved |
| Why predicate | The col/value/mode tuple is a constrained API — couldn't express `(score > 80) & (city == "NYC")` without a derived-column step first. Predicate is one slot, infinite expressivity, and still safe (`safe_formula` allow-list applies). |

### 11.5 Future reshape verbs (registered as placeholders only)

Not in Stage 3 scope, but registered now so the sidebar communicates
where the core pack is heading:

- `pivot(df, index, columns, values, aggfunc)` — long → wide
- `melt(df, id_vars, value_vars, var_name, value_name)` — wide → long
- `groupby_agg(df, by, agg)` — collapse rows by group
- `cross_join(a, b)` — explicit cartesian product (required because the
  default multi-step rule is zip-by-index, §8.5)

### 11.6 UI-introspection gaps surfaced by the placeholders

While registering the placeholders, three gaps in the decorator's
type-hint → UI-type mapping became visible. None block Stage 3e, but
they want flagging so the UI engineer knows what to plan around:

| Annotation | UI type today | What the UI probably wants |
|---|---|---|
| `Any` | `"string"` | `"json"` (free-form Python literal editor) |
| `List[dict]`, `List[str]` (parameterised generics) | `"string"` | `"list"` + an element-type hint |
| `dict` (plain), `Dict[str, Any]` | `"string"` (plain `dict`) / `"string"` (`Dict[…]`) | `"object"` with optional value-type hint |
| `Optional[str]` | `"string"` | `"string"` (correct — flagged here only because it's worth knowing the unwrapping works) |
| `Callable` | `"string"` | `"predicate"` or `"expression"` editor with column-name autocomplete |

The pragmatic fix is in `decorators.simple_step` — extend the
type-hints lookup to recognise `typing.get_origin` / `get_args` and
return richer `ui_type` values. Doing it now would change the JSON
contract of `/api/operations` for *every* op, so it's a UI-coordinated
change — best done alongside whichever component this conversation is
building toward.

### 11.7 Promotion path (preview → canonical)

When an implementation lands, the promotion is a single mechanical
edit per op:

1. Implement the body (move code from the old op or write fresh).
2. Drop the `_preview` suffix from the `id=` in the decorator.
3. Change category from `"Core (preview · Stage 3e)"` to `"Core"`.
4. In the same commit, delete the legacy op being replaced (`literal`
   string-eval → `literal_preview` becomes `literal`; `define_variable`,
   `filter_rows`, `expand_cell`, `select_*` are all deleted outright;
   their mock workflows are rewritten to the new vocabulary).
5. Run `pytest tests/` — the mock-driven tests fail loudly if the new
   op's behaviour doesn't match.

When all four mocks read cleanly with no modifier syntax anywhere and
no legacy op names, Stage 3 is done.
