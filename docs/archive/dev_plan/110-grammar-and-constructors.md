# Grammar: literals, constructors, step refs, operations

> Sections §1.0–§1.7 of the original contracts doc.
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

# Formula Bar — Syntax Contracts & UI Fix List

> **Purpose.**  A single living checklist of every formula shape the bar must
> support, **and** the UI bugs we want to clean up.  Each row is a *contract*:
> input → expected behavior → status.
>
> Workflow:
> 1.  Pick a row.
> 2.  Type the formula into the bar (or reproduce the UI issue).
> 3.  Compare against **Expected**.
> 4.  Tick the box when it matches; file a bug if it doesn't.
>
> Source of truth for grammar: `dev_notes/stage3_formula_grammar_and_shape_vocabulary.md`.
> Source of truth for parser: `src/SIMPLE_STEPS/safe_formula.py`.

---


## 1. Formula Syntax Contracts

Each row = one input string into the formula bar.  "Expected" describes what
should appear in the step's *output grid* + the toast / inline error banner.

### 1.0 — Design principles (May 2026 revision)

The grammar has **three layers** and nothing else:

1.  **Bare literals** — `=42`, `="hi"`, `=[1,2,3]`, `={"a":1}` — parsed by
    `ast.literal_eval`.  Anything `literal_eval` accepts, the bar accepts.
    Anything else is a syntax error.
2.  **Three constructors** for *naming* a value as cell / column / table:
    `Cell(...)`, `Column(...)`, `Table(...)`.
3.  **Operation calls** — `=OP(arg=…)` — every other registered operation.

**No `import` statement.**  Packs are loaded at startup; to use a newly
installed pack you reload the session (the Kernel pill in Phase B will expose
a "Restart" action).

**No `define_variable`.**  Cell/Column/Table replace it cleanly:

| Old (gone)                              | New                                          |
|-----------------------------------------|----------------------------------------------|
| `=define_variable(name="x", value=42)`  | `=Cell(42, name="x")` *or just* `=42`        |
| `=define_variable(name="xs", value=[1,2,3])` | `=Column([1,2,3], name="xs")`           |

**No `passthrough`.**  Bare `=step1` already passes the previous step
through.  The operation is removed from the registry.

**Operator overloading is supported on step references** (see §1.5):
`step1.score > 0.5`, `step1["score"] > 0.5`, `step1.url[0:10]`,
`step1.a + step1.b`.

---

### 1.1 — Bare literals (cell-equivalent shorthand)

A formula whose body is a valid `ast.literal_eval` expression evaluates to
a **1-cell table** (column name = `"value"` by default).

Accepted: `int`, `float`, `str` (single or double quotes), `bool`, `None`,
`list`, `tuple`, `dict`, `set`, and any nesting thereof.

| # | Input | Output | Status |
|---|---|---|---|
| 1.1.1 | `=42`                          | 1×1 table, col=`value`, val=`42` (int) | ⬜ |
| 1.1.2 | `=3.14`                        | 1×1 table, float | ⬜ |
| 1.1.3 | `="hello"`                     | 1×1 table, str | ⬜ |
| 1.1.4 | `='hello'`                     | same as above | ⬜ |
| 1.1.5 | `=True`                        | 1×1 table, bool | ⬜ |
| 1.1.6 | `=None`                        | 1×1 table, null | ⬜ |
| 1.1.7 | `=[1,2,3]`                     | 3×1 table, col=`value` | ⬜ |
| 1.1.8 | `=["a","b","c"]`               | 3×1 table | ⬜ |
| 1.1.9 | `={"a":1,"b":2}`               | 2×2 table, cols=`key`,`value` | ⬜ |
| 1.1.10 | `={"col_a":[1,2],"col_b":[3,4]}` | 2×2 table, cols=`col_a`,`col_b` (dict-of-lists is treated as a table) | ⬜ |
| 1.1.11 | `=[{"x":1},{"x":2}]`          | 2×1 table, col=`x` (list-of-dicts is treated as a table) | ⬜ |
| 1.1.12 | `=(1, 2, 3)`                  | 3×1 table | ⬜ |
| 1.1.13 | `=42 + 1` *(not a literal)*   | ❌ syntax error — `literal_eval` rejects arithmetic | ⬜ |
| 1.1.14 | `=foo`                        | ❌ syntax error: "`foo` is not a literal, step reference, or operation" | ⬜ |
| 1.1.15 | `=` *(empty body)*            | passthrough of previous step | ⬜ |
| 1.1.16 | empty formula                 | passthrough | ⬜ |
| 1.1.17 | `="""triple quoted"""`        | ❌ — `literal_eval` accepts triple quotes, but we reject for sanity *(decide)* | ⬜ |

> **Promotion rules** (dict / list ↔ table shape) are codified in §1.6.

### 1.2 — `Cell(...)` — named scalar

```
=Cell(value [, name="..."])
```

- `value` MUST be a literal (same set as §1.1) or a step-scalar reference.
- `name` is optional; defaults to `"value"`.
- Output: 1×1 table whose single column is `name`.

| # | Input | Output | Status |
|---|---|---|---|
| 1.2.1 | `=Cell(42)`                       | 1×1 col=`value`, val=42 | ⬜ |
| 1.2.2 | `=Cell(42, name="answer")`        | 1×1 col=`answer` | ⬜ |
| 1.2.3 | `=Cell("hi", name="greeting")`    | 1×1 col=`greeting` | ⬜ |
| 1.2.4 | `=Cell(step1.score)` *(scalar ref)* | 1×1 col=`score` (name auto-inherits) | ⬜ |
| 1.2.5 | `=Cell([1,2])`                    | ❌ error: "Cell value must be scalar; got list — use `Column(...)`" | ⬜ |
| 1.2.6 | `=Cell()`                         | 1×1 **empty Cell** (`∅`) — explicit "no value yet" sentinel | ⬜ |
| 1.2.7 | `=Cell(name="x")`                 | 1×1 empty Cell, col=`x` (same as `=Cell()` but named) | ⬜ |
| 1.2.8 | `=Cell(None)`                     | 1×1 `null` (distinct from empty — see §1.12.3) | ⬜ |

### 1.3 — `Column(...)` — named series

```
=Column(iterable [, name="..."])
```

- `iterable` is a literal list/tuple, a dict-of-list (→ multi-col table),
  or a step-column reference.
- `name`: optional; rules:
  - if `iterable` is a list/tuple → name defaults to `"value"`.
  - if `iterable` is a `dict` with a **single** list value → name defaults to that key, and the explicit `name=` overrides it.
  - if `iterable` is a step ref → name defaults to the source col name.

| # | Input | Output | Status |
|---|---|---|---|
| 1.3.1 | `=Column([1,2,3])`                       | 3×1 col=`value` | ⬜ |
| 1.3.2 | `=Column([1,2,3], name="scores")`        | 3×1 col=`scores` | ⬜ |
| 1.3.3 | `=Column({"scores":[1,2,3]})`            | 3×1 col=`scores` (key becomes name) | ⬜ |
| 1.3.4 | `=Column({"scores":[1,2,3]}, name="pts")`| 3×1 col=`pts` (explicit override) | ⬜ |
| 1.3.5 | `=Column(step1.url)`                     | n×1 col=`url` | ⬜ |
| 1.3.6 | `=Column(step1.url, name="link")`        | n×1 col=`link` | ⬜ |
| 1.3.7 | `=Column(42)`                            | ❌ error: "Column value must be iterable; got int — use `Cell(...)`" | ⬜ |
| 1.3.8 | `=Column({"a":[1,2],"b":[3,4]})`         | ❌ error: "Column expects a single column; got 2. Use `Table(...)`" | ⬜ |

### 1.4 — `Table(...)` — named multi-column table

```
=Table(data [, name="..."])
```

- `data` is one of:
  - dict-of-list → columns = keys.
  - list-of-dict → columns = union of dict keys (NaN-fill missing).
  - step ref → identity copy.
  - path string ending in `.csv` / `.json` / `.parquet` → loaded from `WORKSPACE_ROOT`-relative path.
- `name`: optional table label (shown in tab + breadcrumb).

| # | Input | Output | Status |
|---|---|---|---|
| 1.4.1 | `=Table({"a":[1,2],"b":[3,4]})`           | 2×2 table | ⬜ |
| 1.4.2 | `=Table([{"a":1},{"a":2,"b":3}])`         | 2×2 table, b has NaN in row 0 | ⬜ |
| 1.4.3 | `=Table(step1)`                            | step1 identity | ⬜ |
| 1.4.4 | `=Table("data/views.csv")`                 | loads CSV from workspace | ⬜ |
| 1.4.5 | `=Table("data/views.csv", name="views")`   | loaded + named | ⬜ |
| 1.4.6 | `=Table("missing.csv")`                    | ❌ error: "File not found: missing.csv" | ⬜ |
| 1.4.7 | `=Table(42)`                               | ❌ error: "Table data must be dict-of-list, list-of-dict, step, or file path" | ⬜ |

### 1.5 — Step references + operator overloading

A step reference exposes a `StepProxy` with `__getattr__`, `__getitem__`,
and the full set of comparison + arithmetic dunders — so the bar reads
like spreadsheet syntax.

#### 1.5.1 — Column access

| # | Input | Expected | Status |
|---|---|---|---|
| 1.5.1a | `=Column(step1.url)`                  | url column | ⬜ |
| 1.5.1b | `=Column(step1["url"])`               | same — bracket form accepted | ⬜ |
| 1.5.1c | `=Column(step1.does_not_exist)`       | ❌ "Column `does_not_exist` not found in step 1. Available: …" | ⬜ |
| 1.5.1d | `=Column(step99.url)`                 | ❌ "Step 99 does not exist (workflow has N steps)" | ⬜ |
| 1.5.1e | `=Column(step0.url)`                  | ❌ "Step indices start at 1" | ⬜ |

#### 1.5.2 — Boolean masks & filtering (operator overloads)

Every `step1.col` supports `< <= > >= == !=` against a literal *and*
against another `step.col`.

| # | Input | Expected | Status |
|---|---|---|---|
| 1.5.2a | `=filter(step1, step1.score > 0.5)`        | step1 rows where score>0.5 | ⬜ |
| 1.5.2b | `=filter(step1, step1["score"] > 0.5)`     | same — bracket form | ⬜ |
| 1.5.2c | `=filter(step1, step1.score >= step1.threshold)` | column-vs-column mask | ⬜ |
| 1.5.2d | `=Column(step1.url[step1.score > 0.5])`    | url column filtered by mask | ⬜ |
| 1.5.2e | `=filter(step1, (step1.a > 0) & (step1.b < 10))` | conjunction via `&` (pandas style) | ⬜ |
| 1.5.2f | `=filter(step1, (step1.a > 0) and (step1.b < 10))` | ❌ "Use `&` / `\|` for column logic, not `and` / `or`" | ⬜ |

#### 1.5.3 — Arithmetic on columns

| # | Input | Expected | Status |
|---|---|---|---|
| 1.5.3a | `=Column(step1.score + 1)`                  | score + 1 elementwise | ⬜ |
| 1.5.3b | `=Column(step1.a + step1.b, name="sum")`    | new column = a+b | ⬜ |
| 1.5.3c | `=Column(step1.score * 100, name="pct")`    | scaled | ⬜ |
| 1.5.3d | `=Column(step1.url + "/full")`              | string concat per row | ⬜ |

#### 1.5.4 — Indexing / slicing (row selection)

| # | Input | Expected | Status |
|---|---|---|---|
| 1.5.4a | `=Column(step1.url[0])`            | scalar → coerced to 1-cell | ⬜ |
| 1.5.4b | `=Column(step1.url[0:10])`         | first 10 urls | ⬜ |
| 1.5.4c | `=Column(step1.url[-5:])`          | last 5 urls | ⬜ |
| 1.5.4d | `=Table(step1[0:100])`             | first 100 rows of step1 | ⬜ |
| 1.5.4e | `=Table(step1[step1.score > 0.5])` | filter as table | ⬜ |

#### 1.5.5 — Bare step ref (passthrough)

| # | Input | Expected | Status |
|---|---|---|---|
| 1.5.5a | `=step1`         | step1 identity | ⬜ |
| 1.5.5b | `step1` *(no `=`)* | yellow hint: "Did you mean `=step1`?" | ⬜ |

#### 1.5.6 — Closure principle (operator-overloading scope)

> **Every step is a DataFrame.  Every operation that accepts a DataFrame
> accepts *any* `stepN` as a drop-in.**

This is the algebraic closure that makes the bar feel like a spreadsheet:
the output of any expression in the bar is the same *kind* of thing as the
input, so anything composable in step 1 composes the same way in step 17.

The full set of overloads on `StepProxy` (and on any `Column` it exposes):

| Category | Operators | Example | Notes |
|---|---|---|---|
| Attribute access | `.col`, `["col"]` | `step1.url`, `step1["url"]` | identical semantics |
| Multi-col select | `[["a","b"]]` | `step1[["a","b"]]` | pandas-style |
| Row indexing | `[i]`, `[a:b]`, `[a:b:s]` | `step1[0]`, `step1[0:10]` | int / slice |
| Boolean mask | `[mask]` | `step1[step1.score > 0.5]` | mask is itself a `Column` |
| Comparison | `< <= > >= == !=` | `step1.score > 0.5` | returns a `Column[bool]` |
| Arithmetic | `+ - * / // % **` | `step1.a + step1.b`, `step1.score * 100` | element-wise |
| Unary | `-`, `+`, `abs()` | `-step1.delta` | |
| String add | `+` on str cols | `step1.url + "/full"` | concat per row |
| Bitwise (mask combine) | `& \| ^ ~` | `(m1 & m2) \| ~m3` | for combining masks; **never** `and`/`or` |
| Containment | `.isin([...])`, `.contains("...")` | `step1.tag.isin(["a","b"])` | helper methods, not Python `in` |
| Null tests | `.isna()`, `.notna()` | `step1.score.isna()` | |
| Reductions (return scalar `Cell`) | `.sum()`, `.mean()`, `.min()`, `.max()`, `.count()`, `.nunique()`, `.first()`, `.last()` | `step1.views.sum()` | rendered as 1-cell table |
| Aggregations (return list-`Column`) | `.unique()`, `.values()` | `step1.tag.unique()` | |
| Length | `len(step1)` | n-rows as scalar | special-cased; not eval |

**Out of scope (deliberately):**

| Form | Why excluded |
|---|---|
| `step1.url.str.upper()` (method chains beyond the table above) | Not overloaded — register `=upper(step1.url)` as an op instead.  Keeps the surface area small and the suggestion list useful. |
| Python `and` / `or` / `not` on columns | Truthiness on a Series is ambiguous — fails loudly per §4.8. |
| `in` operator | Always returns a scalar; not what users mean.  Use `.isin([...])`. |
| Subscript assignment (`step1["new"] = ...`) | Bar is **expression-only** — mutations are operations, not statements. |
| Walrus `:=`, comprehensions, lambdas | Same — no statements, no closures. |

#### 1.5.7 — Closure round-trip checks

These are property tests in `tests/test_step_proxy.py`:

- `=Table(step1) == step1` — identity.
- `=step1[step1.score > 0.5]` and `=filter(step1, step1.score > 0.5)` return identical tables.
- `=step1.a + step1.b` and `=Column(step1.a + step1.b)` return identical 1-col tables.
- `=step1[0:10]` rendered as table = first 10 rows; column names + dtypes unchanged.

### 1.6 — Shape vocabulary (literal → table promotion)

Codifies how the *type* of a bare literal becomes a *table shape*.

| Literal type | Result shape | Default column(s) |
|---|---|---|
| scalar (int/float/str/bool/None) | 1×1 | `value` |
| `list` / `tuple` of scalars      | n×1 | `value` |
| `list` of `dict`                 | n×k | union of dict keys |
| `dict` (str → scalar)            | n×2 | `key`, `value` |
| `dict` (str → list of equal len) | n×k | dict keys |
| `dict` (str → list of unequal len) | ❌ error: "Lists have unequal lengths (a=3, b=2)" |
| `set`                            | n×1 | `value` (order undefined) |
| nested list / nested dict not matching above | ❌ error: "Unrecognised shape; wrap in Table/Column/Cell" |

The frontend grid uses the same vocabulary for rendering.

### 1.7 — Operation calls (non-constructor)

Operations registered by packs follow the same `=NAME(arg=…)` shape.
Parameter handling is identical to today:

| # | Input | Expected | Status |
|---|---|---|---|
| 1.7.1 | `=does_not_exist(foo=1)` | ❌ "Unknown operation `does_not_exist`" + closest-match suggestion | ⬜ |
| 1.7.2 | `=OP()` *(missing required arg)* | ❌ "Missing required parameter `X`" + signature hint | ⬜ |
| 1.7.3 | `=OP(x=1, extra=99)` | ❌ "Unknown parameter `extra`. Did you mean `X`?" *(reject, not warn)* | ⬜ |
| 1.7.4 | `op(x=1)` *(missing `=`)* | yellow hint: "Formulas start with `=`. Did you mean `=op(x=1)`?" | ⬜ |
| 1.7.5 | `=OP(x=1,)` *(trailing comma)* | runs OK | ⬜ |
| 1.7.6 | `= OP(x=1)` *(leading space)* | runs OK | ⬜ |
| 1.7.7 | `=op(s="he said \"hi\"")` | escaped quotes preserved | ⬜ |
| 1.7.8 | `=op(` *(unclosed paren)* | ❌ "Syntax error: unclosed `(` at column N" | ⬜ |
| 1.7.9 | `=op(x=)` *(missing value)* | ❌ "Syntax error near `=)`" | ⬜ |
| 1.7.10 | `=import os` | ❌ "Imports are not allowed in formulas. Packs are loaded at startup." | ⬜ |
| 1.7.11 | `=os.system("rm -rf /")` | ❌ "`os` is not available. No imports allowed." | ⬜ |
| 1.7.12 | formula > 5kB | parses or rejects in <50ms; no UI freeze | ⬜ |


