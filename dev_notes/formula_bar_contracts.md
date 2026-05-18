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

## Legend

| Symbol | Meaning |
|---|---|
| ✅  | Confirmed working today |
| 🟡 | Works but with caveats / partial |
| ❌  | Broken / not implemented |
| ⬜ | Not yet tested in this pass |

Fill in the **Status** column as you go.

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

### 1.8 — Shape-changing operations (expand / collapse / pivot)

**This is the part you asked for help on.**  Proposal: four primitives,
all live in the core pack, all share a consistent `df_in → df_out`
shape contract.  Names chosen to avoid pandas jargon.

#### 1.8.1 — `Expand` (one row → many rows **or** one col → many cols)

```
=Expand(step1, column="tags" [, into="tag"] [, axis="rows"] [, sep=None])
```

`Expand` turns a column of *containers* into more rows or more columns,
depending on the container type.  **The default is chosen from the data**,
so most users never specify `axis=`.

##### Defaults — inferred from cell type

| Cell type in `column=` | Default `axis` | Result | Override |
|---|---|---|---|
| `list` / `tuple` / `set` | `"rows"` | n rows → Σ\|cells\| rows; other cols duplicated | `axis="cols"` → splits into N new columns (`col_0..col_N`); ragged → NaN-fill |
| `dict` (str→scalar) | `"cols"` | n rows × 1 col → n rows × k cols (dict keys become column names); original col dropped | `axis="rows"` → 2-col long format (`key`, `value`) — same shape as `Unpivot` |
| `str` with `sep=` provided | `"rows"` | string split into list, then row-expanded | `axis="cols"` → split into N new columns |
| scalar (int/float/str without `sep`) | ❌ error | "Cannot expand scalar column `x`. Did you mean `sep=`?" | |

##### Argument reference

| Arg | Default | Meaning |
|---|---|---|
| `column=` | — *(required if step has >1 col)* | which column to expand.  If step has exactly 1 col, may be omitted. |
| `into=` | source col name *(rows)* or `None` *(cols)* | name of the new column(s).  For `axis="cols"` from a list, accepts a list of names or a prefix string (`into="part_"` → `part_0, part_1, …`). |
| `axis=` | inferred (see table) | `"rows"` or `"cols"`; explicit override always wins. |
| `sep=` | `None` | if set, split string cells on `sep` first, then expand. |
| `keep_empty=` | `False` | if a cell is `[]` / `{}` / empty string, `False` drops the row; `True` keeps it with NaN. |

##### Examples

| Input | Output |
|---|---|
| `=Expand(step1, column="tags")` *(tags is list-valued)* | row-expand, `tags` column now scalar |
| `=Expand(step1, column="tags", into="tag")` | row-expand, new col `tag`, original `tags` dropped |
| `=Expand(step1, column="tags", axis="cols")` | one column per list position |
| `=Expand(step1, column="tags", axis="cols", into=["a","b","c"])` | named output columns |
| `=Expand(step1, column="props")` *(props is dict-valued)* | col-expand: dict keys → new columns |
| `=Expand(step1, column="props", axis="rows")` | long format: `key`, `value` |
| `=Expand(step1, column="csv_tags", sep=",")` | splits string → row-expand |
| `=Expand(step1.tags)` *(column-shorthand)* | 1-col table → row-expand of single col |

##### Mental model

`Expand` answers: "I have a column that holds *more than one value per row*.
Unpack it.  By default, lists grow rows; dicts grow columns; strings need
to be split first."  Everything else is an explicit override.

**Inverse:**  `Collapse(..., agg={...: "list"})` for the row-expand case;
`Pivot` / `Unpivot` for the col-expand case (those are stricter and
documented separately in §1.8.3 / §1.8.4).

#### 1.8.2 — `Collapse` (many rows → one row, by key)

```
=Collapse(step1, by=["channel"], agg={"views":"sum","tags":"list"})
```

Groups by `by`-columns; produces one row per group.  `agg` maps each
remaining column to a reducer:

| Reducer | Result |
|---|---|
| `"sum"`, `"mean"`, `"min"`, `"max"`, `"count"`, `"first"`, `"last"` | scalar per group |
| `"list"`, `"set"`, `"unique"` | list per group (inverse of `Expand`) |
| `"concat"` (strings only) | joined with `sep` (default `", "`) |
| any registered operation name | applied to the group's column as a series |

Columns not in `by` and not in `agg` → dropped *with* a warning chip
(`"3 columns dropped: a, b, c"`).

#### 1.8.3 — `Pivot` (long → wide)

```
=Pivot(step1, rows="channel", cols="month", values="views" [, agg="sum"])
```

Equivalent to pandas `pivot_table`.  Default agg is `"sum"`.  Missing
cells filled with `NaN` (or with `fill=` kwarg).

#### 1.8.4 — `Unpivot` (wide → long)  *(inverse of Pivot)*

```
=Unpivot(step1, keep=["channel"], into=("month","views"))
```

Every column **not** in `keep` becomes a row.  `into=(name_col, value_col)`
names the two emitted columns.

#### 1.8.5 — Mental model

| Direction | Op |
|---|---|
| rows ⤴ more rows | `Expand` |
| rows ⤵ fewer rows | `Collapse` |
| long ⟶ wide | `Pivot` |
| wide ⟶ long | `Unpivot` |

`Expand` and `Collapse` should be **inverses** for any list-aggregator
choice — that's a property test (§3 below).

#### 1.8.6 — Status

| # | Input | Expected | Status |
|---|---|---|---|
| 1.8a | `=Expand(step1, column="tags")` | n→Σ\|tags\| rows | ⬜ |
| 1.8b | `=Collapse(step1, by=["channel"], agg={"views":"sum"})` | one row per channel | ⬜ |
| 1.8c | `=Pivot(step1, rows="channel", cols="month", values="views")` | wide table | ⬜ |
| 1.8d | `=Unpivot(step1, keep=["channel"], into=("month","views"))` | long table | ⬜ |
| 1.8e | round-trip: `Collapse(Expand(x))` returns x (up to row order) | property | ⬜ |
| 1.8f | round-trip: `Unpivot(Pivot(x))` returns x (up to row order) | property | ⬜ |

### 1.9 — Status / UX expectations for *every* run

For every formula above, when the **Run** button is clicked:

- [ ] Step header pill turns **yellow "running"** within 100ms.
- [ ] On success → green "✓ done" + execution-time chip (e.g. `42ms`).
- [ ] On failure → red "✗ error" + clickable banner that opens the **Execution Log** scrolled to this step's error.
- [ ] Output grid renders before the next step's "running" pill (i.e. sequential, not racing).
- [ ] If the step is unchanged from last run, status pill stays neutral grey + a small `(cached)` chip.
- [ ] Hovering the pill shows tooltip: timestamp of last successful run.

### 1.10 — Spreadsheet-parity checklist (core pack must-haves)

> **Goal.** A user familiar with Excel / Google Sheets should be able to do
> the 90% of tabular work they're used to *without* opening Python.  Each
> bullet below is a registered op in the **core pack**, with the
> spreadsheet-equivalent listed for orientation.

#### Filter / sort / select

| Bar form | Spreadsheet equivalent | Notes |
|---|---|---|
| `=filter(step1, step1.score > 0)` | AutoFilter / FILTER() | also: `=step1[step1.score > 0]` |
| `=sort(step1, by=["score"], desc=True)` | Sort dialog | multi-col: `by=["a","b"]`, `desc=[True,False]` |
| `=select(step1, ["url","score"])` | Hide/show columns | also `=step1[["url","score"]]` |
| `=rename(step1, {"old":"new"})` | Rename column | dict-style |
| `=drop(step1, ["junk"])` | Delete column | accepts list or single string |
| `=distinct(step1, by=["url"])` | Remove Duplicates | `by=None` = all columns |
| `=head(step1, n=10)` / `=tail(step1, n=10)` | Top/bottom N | |
| `=sample(step1, n=100, seed=42)` | RANDBETWEEN / sample | seedable for reproducibility |

#### Conditional logic per row

| Bar form | Spreadsheet equivalent |
|---|---|
| `=when(step1.score > 0.5, "high", "low")` | `IF(score>0.5, "high", "low")` |
| `=when_chain([(step1.x>0,"pos"),(step1.x<0,"neg")], default="zero")` | nested `IF` / `IFS` |
| `=case(step1.country, {"US":"NA","CA":"NA","DE":"EU"}, default="other")` | `SWITCH` / `LOOKUP` table |
| `=coalesce(step1.a, step1.b, 0)` | `IFNA` / `IFERROR` chain |

#### Joining two steps (VLOOKUP equivalent)

| Bar form | Spreadsheet equivalent |
|---|---|
| `=join(step1, step2, on="url")` | `VLOOKUP` / `INDEX-MATCH` (inner join by default) |
| `=join(step1, step2, on="url", how="left")` | left/right/outer joins |
| `=join(step1, step2, left_on="url", right_on="link")` | different col names |
| `=lookup(step1, step2, key="url", value="title")` | single-col VLOOKUP shorthand |

#### Stacking / concatenation

| Bar form | Spreadsheet equivalent |
|---|---|
| `=stack(step1, step2)` *(rows)* | append rows (same schema) |
| `=stack(step1, step2, fill_missing=True)` | rows with column union (NaN-fill) |
| `=hstack(step1, step2)` | side-by-side columns (must have same n rows) |

#### Window / running calculations

| Bar form | Spreadsheet equivalent |
|---|---|
| `=running_total(step1.score)` | running SUM in a helper column |
| `=running(step1.score, op="mean", window=7)` | moving average |
| `=rank(step1.score, desc=True)` | `RANK.EQ` |
| `=lag(step1.score, n=1)` | `=A2` looking back |
| `=lead(step1.score, n=1)` | look forward |
| `=cumsum(step1.score)` / `=cummax(step1.score)` | running statistics |

#### Type & null handling

| Bar form | Equivalent |
|---|---|
| `=cast(step1.x, to="int")` | `VALUE()` / `INT()` |
| `=cast(step1.t, to="date", fmt="%Y-%m-%d")` | `DATEVALUE` |
| `=fill_null(step1, value=0)` | `IFERROR(.., 0)` over the sheet |
| `=fill_null(step1.score, method="forward")` | drag-down fill |
| `=drop_null(step1, cols=["score"])` | filter blanks |

#### String + date helpers

| Bar form | Equivalent |
|---|---|
| `=upper(step1.name)` / `=lower(...)` / `=title(...)` | `UPPER` / `LOWER` / `PROPER` |
| `=trim(step1.name)` | `TRIM` |
| `=replace(step1.name, find="-", with="_")` | `SUBSTITUTE` |
| `=regex_extract(step1.url, pattern="//([^/]+)")` | regex helper |
| `=split(step1.fullname, sep=" ", into=["first","last"])` | text-to-columns |
| `=concat(step1.first, " ", step1.last, name="full")` | `&` concatenation |
| `=parse_date(step1.t, fmt="%Y-%m-%d")` | `DATEVALUE` |
| `=date_part(step1.t, part="year")` | `YEAR()` / `MONTH()` / `DAY()` |
| `=date_add(step1.t, days=7)` | date math |

#### Reductions (return a 1×k Cell/Row)

| Bar form | Equivalent |
|---|---|
| `=summary(step1, agg={"views":"sum","score":"mean"})` | bottom-of-column formulas |
| `=count_rows(step1)` | `COUNTA` |
| `=count_distinct(step1.url)` | `COUNTUNIQUE` |

> All of the above are *operations* (regular `=OP(...)` syntax), not new
> grammar — so the parser doesn't grow.  The work is in the **core pack**.

### 1.11 — Python extension model

> **Goal.** Power users can register their own Python as a first-class op
> without touching the parser.  Spreadsheet users never see this.

#### 1.11.1 — How a user adds Python

Drop a `.py` file under `packs/<my_pack>/operations.py`:

```python
from SIMPLE_STEPS.pack_api import op

@op(name="word_count", category="text")
def word_count(text: str) -> int:
    """Number of whitespace-separated tokens."""
    return len(text.split())

@op(name="zscore")
def zscore(col: "Column[float]") -> "Column[float]":
    """Standardize a numeric column."""
    return (col - col.mean()) / col.std()
```

Restart the session (Kernel pill → Restart in Phase B).  The ops appear
in the autocomplete and the command palette immediately.

**The decorator IS the contract.**  Everything the engine needs to know
about an op — how to schedule it, whether to cache it, what secrets it
needs, what resources to inject, whether it's incremental — is declared
as a kwarg on `@op`.  The bar parser never grows; the *decorator* does.
A fully-loaded example:

```python
from SIMPLE_STEPS.pack_api import op, resource

@resource(name="openai", secrets=["OPENAI_API_KEY"])
def openai_client(api_key: str):
    from openai import OpenAI
    return OpenAI(api_key=api_key)

@op(
    name="summarize",
    category="llm",
    async_=True,                  # engine awaits this op
    max_concurrency=20,           # within-step parallelism cap
    deterministic=False,          # skip cache
    network=True,                 # surface "needs network" pill chip
    source=True,                  # this op materializes external data
    key="row_id",                 # primary key for incremental updates
    default_mode="fill_missing",  # see §1.14
    needs=["openai"],             # resources to inject
    secrets=["OPENAI_API_KEY"],   # surfaced at session boot for prompt
)
async def summarize(
    text: "Column[str]",
    *,
    openai,            # injected by name (resource id == param name)
    progress,          # engine-provided, see §1.11.6
    cancel_token,      # engine-provided, see §1.11.6
) -> "Column[str]":
    out = []
    for i, t in enumerate(text):
        cancel_token.raise_if_cancelled()
        r = await openai.responses.create(model="gpt-4o-mini", input=t)
        out.append(r.output_text)
        progress(i + 1, len(text))
    return out
```

The bar call is still boring: `=summarize(step1.transcript)`.  All of
the policy above lives next to the function, in code review, in git
history — *not* in a YAML sidecar and *not* in the formula string.

**Recognised `@op` kwargs** (locked):

| Kwarg | Type | Default | Meaning |
|---|---|---|---|
| `name` | `str` | function name | Bar-visible identifier |
| `category` | `str` | `"misc"` | Grouping in the palette |
| `async_` | `bool` | `False` | If True, op is awaitable |
| `max_concurrency` | `int` | `1` | Max in-flight tasks within this step |
| `deterministic` | `bool` | `True` | False ⇒ never cached |
| `network` | `bool` | `False` | Surfaces a "🌐 network" chip on the step |
| `source` | `bool` | `False` | Treats output as external data — enables incremental modes (§1.14) |
| `key` | `str` \| `list[str]` | `None` | Primary key for `source=True` ops |
| `default_mode` | str | `"replace"` | One of `replace`/`append`/`upsert`/`fill_missing` |
| `needs` | `list[str]` | `[]` | Resource ids to inject; see §1.11.5 |
| `secrets` | `list[str]` | `[]` | Env-var names required; missing ⇒ banner |
| `timeout_s` | `float` \| `None` | `None` | Hard wall-clock cap per call |

#### 1.11.2 — Type → shape inference

The `@op` decorator inspects type hints to decide *what kind of input the
op expects* and *what shape it returns*.  This drives the autocomplete
hints and the error messages.

| Param hint | Expected input | Bar coercion |
|---|---|---|
| `int` / `float` / `str` / `bool` | scalar literal | rejects non-literal |
| `list[T]` | literal list | rejects scalar |
| `Cell[T]` | a `=Cell(...)` ref | rejects multi-row inputs |
| `Column[T]` | step column or `=Column(...)` | rejects step-table |
| `Table` | step or `=Table(...)` | accepts any step |

`Return` type determines the *output shape*:

| Return hint | Output |
|---|---|
| scalar (`int`/`str`/…) | 1×1 Cell |
| `list[T]` / `Column[T]` | n×1 Column |
| `dict` / `pd.DataFrame` / `Table` | full Table |

If hints are missing, the decorator falls back to "Table → Table" and
emits a warning in the Execution Log so the author knows to add them.

#### 1.11.3 — Apply / map (per-row Python escape hatch)

For one-off "I just want to run a Python function over my rows" cases
without writing a pack:

```
=apply(step1, OP_NAME, on="url")           # OP_NAME runs per cell of `url`
=apply(step1, OP_NAME, on=["a","b"])        # OP_NAME(a, b) → new col
=apply(step1, OP_NAME, on="url", into="domain")
```

`OP_NAME` must be a **registered op identifier** (no inline lambdas — keeps
the bar deterministic, cacheable, and shareable).  The cell value(s) are
passed positionally; extra kwargs to the op come via `args={...}`.

This replaces the old `map_each` / `apply_to` / `expand_each` trio with
one verb — the differences (per-row vs per-frame vs row-expand) are
expressed by the op's return type:

| Op returns | Behaviour of `apply` |
|---|---|
| scalar | per-cell map → new column |
| `Column` | per-cell map yielding lists → `Expand`-equivalent if `expand=True` |
| `Table` | per-row sub-tables → concatenated (row-expand) |

#### 1.11.4 — Frontend "Add Operation" affordance

Phase C: a `+` button in the Operation Pack sidebar opens a Monaco editor
pre-filled with the `@op` template above, saves under `packs/local/`, and
triggers a hot reload.  Until then, packs are installed by hand and a
restart is required.

#### 1.11.5 — `@resource` — session-scoped stateful clients

Some ops need an object that's expensive to build and stateful (HTTP
session with connection pool, OpenAI client, sqlite connection, headless
browser, …).  Building one per op call wastes time and breaks rate
limiters.  Building one at import time leaks secrets and makes mocking
hard.  Answer: **declare it as a resource.**

```python
from SIMPLE_STEPS.pack_api import resource

@resource(name="openai", secrets=["OPENAI_API_KEY"])
def openai_client(api_key: str):
    from openai import OpenAI
    return OpenAI(api_key=api_key)

@resource(name="http")
def http_session():
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": "simple-steps/1.0"})
    return s

@resource(name="db")
def db():
    import sqlite3
    return sqlite3.connect("data.sqlite")
```

**Lifecycle.**

| Event | What happens |
|---|---|
| Session boot | Resource is *registered* but not instantiated. |
| First op with `needs=["openai"]` runs | Resource factory called once; result memoized for the session. |
| Subsequent ops | Same instance injected — no rebuild. |
| Kernel pill → Restart | All resources discarded; factories will re-run on next demand. |
| Session exit | If the resource exposes `.close()` it is called; otherwise GC'd. |

**Secret injection.**  If a `@resource` declares `secrets=["NAME"]`, the
engine reads `NAME` from (in order) `~/.simple_steps/secrets.json` →
process env → workspace-local `.env`.  The factory is called with each
declared secret as a positional argument *in the order listed*.  Missing
secret → op call fails at first-use with a clickable banner "Add
`OPENAI_API_KEY` in Settings → Secrets".  Boot does **not** fail; an
unused-but-undeclared resource is fine.

**Injection into ops.**  An op declares `needs=["openai"]`; the engine
injects the resource as a keyword argument whose **name matches the
resource id** (`openai` here).  Pytest-fixture style.  Open question
§4.13 below tracks the alternative of explicit `(resource_id,
param_name)` tuples.

**Cross-pack references.**  A resource defined in `pack_a` is referenced
as `"pack_a.openai"` from `pack_b`.  Bare `"openai"` resolves to the
current pack first, then falls back to globally-unique names.  Collisions
across packs without a prefix → registration error at session boot.
(Open question §4.14.)

**What `@resource` is NOT.**

- Not a place for per-row caches (use ordinary Python `functools.cache`
  inside the op).
- Not a way to share state *between* ops in a way that survives Restart
  (that's the source-op cache, §1.14).
- Not a DI container — only ops can request resources, and only by name.

#### 1.11.6 — `progress` and `cancel_token` (engine-injected utilities)

Long-running ops should report progress and bail out cleanly when the
user hits the red Stop button.  The engine injects two utilities into
any op whose signature includes them by name (no decoration needed):

```python
@op(name="scrape_all", async_=True, max_concurrency=10, network=True)
async def scrape_all(urls: "Column[str]", *, http, progress, cancel_token):
    out = []
    for i, url in enumerate(urls):
        cancel_token.raise_if_cancelled()        # raises Cancelled
        out.append(await fetch(http, url))
        progress(i + 1, len(urls), msg=url)      # updates step header
    return out
```

| Utility | API |
|---|---|
| `progress` | callable `progress(done, total, msg="")` — updates the step pill's progress bar |
| `cancel_token` | `cancel_token.is_cancelled() → bool` and `.raise_if_cancelled()` |

Neither is required.  An op that omits them runs to completion and shows
an indeterminate spinner.  The engine still enforces `timeout_s` for ops
that can't or won't check cancellation.

### 1.12 — Cross-cutting concerns (must hold across every formula)

Easy to forget; nasty bugs when violated.

1. **Reactivity / dependency graph.**  If step 5 references `step1.url`
   and step 1 re-runs, step 5's "stale" pill turns on; running step 5
   uses the new step1 output, not the old.  The graph is built from
   the parsed formula (string-match `stepN` tokens).
2. **Error propagation.**  If step 1 errors, `step1.url` in step 5
   surfaces as `ERROR(step1)` cells in the grid (not a Python exception);
   step 5's pill goes red with "Upstream failure in step 1" and the
   banner deep-links to step 1's traceback.
3. **Empty input — "empty in, empty out".**  Every op must handle empty
   inputs the same way Python handles an empty iterable: by returning
   the *identity element* of its output shape, not by crashing.

   | Input | Op category | Expected output |
   |---|---|---|
   | empty `Table` (0 rows, k cols) | row-wise (`filter`, `sort`, `apply`, `Expand`) | empty Table with same k cols + dtypes |
   | empty `Column` (0 rows) | per-cell (`upper`, `cast`, arithmetic) | empty Column with same dtype |
   | empty `Column` | reduction (`sum`, `mean`, `count`, `max`) | **empty `Cell`** — `Cell(None, name=<src>)`; pill stays green, not red |
   | empty `Column` | `count` specifically | `Cell(0)` (count of nothing is 0, not None) |
   | empty `Table` | reduction-to-row (`summary`) | 1-row Table where every value is `None` (or `0` for counts) |
   | empty `Table` | `Collapse` | empty Table with `by=` cols only |
   | empty `Table` | `Pivot` / `Unpivot` | empty Table (no synthesized cells) |
   | empty `Table` | `join` | empty Table with the join's column union |
   | empty `Table` | `stack(empty, step2)` | `step2` (identity element of stacking) |

   The mental model is `sum([]) == 0`, `max([])` → empty Cell rather than
   ValueError, `[x.upper() for x in []] == []`.  An empty result is a
   *valid* result, never an error.

   **Empty `Cell` rendering.**  An empty Cell shows as a single grid cell
   with grey italic text `∅` (`U+2205 EMPTY SET`).  Hover tooltip:
   "Empty value — upstream produced no rows."  It is *not* the same as
   `Cell(None)`, which renders as `null` and means "explicitly null".

   **Empty `Cell()` constructor.**  `=Cell()` (zero args) is the literal
   way to make one.  Legal everywhere a `Cell[T]` is expected.  Open
   question: does `=Cell()` produce `Cell(None)` or `Cell(∅)`?  Proposal:
   `Cell(∅)` — they're distinct, and "no value yet" is a useful sentinel
   distinct from "explicitly null".  (§4.12 below.)
4. **Caching.**  Re-running a step whose formula + upstream outputs are
   unchanged returns the cached frame (grey pill + `(cached)` chip).
   Invalidation is triggered by *any* upstream output hash changing.
5. **Determinism.**  Two runs of the same formula on the same inputs
   produce identical outputs.  Ops that aren't deterministic (e.g.
   `sample()` without a `seed=`) must declare it via
   `@op(deterministic=False)` — those skip the cache.
6. **Serialization.**  Every formula round-trips through the workflow
   `.json`: parse → AST → re-emit string yields the same string.
   Property test in `tests/test_safe_formula.py`.
7. **Renaming a step.**  Steps are referenced by **position** (`step1`,
   `step2`, …), not by user-given title.  Drag-reordering a step
   rewrites every formula that mentions it (Phase C UI; backend support
   first — `=rewrite_refs(workflow, {2:3, 3:2})`).
8. **Output preview limit.**  The grid renders at most 1000 rows by
   default; a banner says "showing 1000 of N rows" and offers
   "Show all" + "Export CSV".  Reductions/`Cell`s never truncate.
9. **Unicode + non-ASCII column names.**  `step1["café"]` works;
   `step1.café` works in Python ≥3 identifiers; column names with
   spaces require bracket form: `step1["my col"]`.
10. **Workspace-relative paths.**  Anywhere a path is accepted
    (`Table("data.csv")`, `=export(step1, to="out.csv")`), it's resolved
    relative to `WORKSPACE_ROOT`; absolute paths and `..` traversal are
    rejected with a banner.

---

### 1.13 — Execution model: sequential between steps, async within

The spreadsheet mental model says step N runs *after* step N-1.  That
must hold even when individual ops are concurrent internally.

| Scope | Rule |
|---|---|
| Between steps | **Strictly sequential.**  Step N+1 doesn't start until step N has produced a frame (or errored). |
| Within a step | **Async-capable.**  An `async def` op marked `async_=True` may issue up to `max_concurrency` in-flight tasks; the engine awaits the whole step before moving on. |
| Run All | Walks the dependency graph in topological order; sequential at the step level even if multiple steps are eligible. |
| Stop button | Cancels the in-flight step via `cancel_token`; downstream steps never start. |

**Why not auto-parallelize independent steps?**  Three reasons:
(1) Predictable order is what makes the spreadsheet feel sane —
"I see step 4 turn green, then step 5" is more debuggable than a
shimmering blur.  (2) Resource budgets (`max_concurrency`, rate
limits) are per-resource, not per-step, so cross-step parallelism
would silently violate them.  (3) Cancellation is much simpler with a
single in-flight step.  If a power user wants cross-step parallelism
later, the escape hatch is a single op that fans out internally.

**Engine sketch.**

```python
# pseudo-code
for step in workflow.steps:
    op = registry[step.op_name]
    kwargs = build_kwargs(step, resources, progress, cancel_token)
    if op.async_:
        result = await op(**kwargs)          # may use asyncio.gather internally
    else:
        result = await loop.run_in_executor(None, op, **kwargs)
    cache.put(step.id, hash(step, upstream_hashes), result)
```

### 1.14 — Source ops: side-effects, incremental updates, persistence

A *source op* fetches data from outside the workflow (HTTP, LLM, DB,
filesystem watch).  These ops are different from pure transforms in
three ways that matter to the engine:

1. They cost real money / time / rate-limit budget — re-running on every
   downstream change is wrong.
2. The right "update" semantics depend on the data — sometimes you want
   to refresh everything, sometimes only fill in new keys.
3. The output must survive Restart (otherwise re-running the workflow
   on a fresh kernel re-pays the cost).

**Declaration.**

```python
@op(
    name="fetch_videos",
    source=True,
    key="video_id",
    default_mode="upsert",
    network=True,
)
def fetch_videos(channel: str, *, http) -> "Table":
    return list_videos(http, channel)
```

**Four update modes** (selectable per-call via a chip on the step
header, defaulting to `default_mode`):

| Mode | Behaviour | Use case |
|---|---|---|
| `replace` | Discard cached output, run op, write fresh. | Daily snapshot, full refresh. |
| `append` | Run op, concat output to cached frame; no dedup. | Append-only event log. |
| `upsert` | Run op, merge on `key`; new keys appended, existing keys overwritten. | "Re-fetch latest stats for the same videos." |
| `fill_missing` | Run op only for keys *not already in cache*; never overwrite existing. | LLM enrichment that's expensive — only fill in what we haven't summarized yet. |

**Persistence.**  Each source-step's output is materialized to
`~/.simple_steps/cache/<workflow_id>/<step_id>.parquet` (plus a tiny
`.json` sidecar with hash + last-run timestamp).  On workflow load,
source steps hydrate from disk; the pill shows `(cached · 3 days ago)`
until the user clicks Run or Refresh.

**`fill_missing` semantics — worked example.**

Step 3 is `=fetch_videos(step1.channel_id)` with `mode=fill_missing`,
`key="video_id"`.  First run: 200 videos fetched, cached.  Two weeks
later the channel has 210 videos; user hits Refresh.

- Engine reads cached `video_id` set (200 keys).
- Calls `fetch_videos` — it returns 210 rows.
- Engine drops the 200 rows whose `video_id` is already cached,
  appends the 10 new ones, writes the union back.
- Step pill: `green · +10 rows`.

For ops where deciding "which keys are missing" requires a remote
listing (e.g., LLM summaries keyed by `video_id`), the op itself can
accept an injected `existing_keys: set` parameter — engine pre-computes
it from the cache and passes it in, so the op only does the expensive
work for the diff.

```python
@op(name="summarize_videos", source=True, key="video_id",
    default_mode="fill_missing", needs=["openai"])
async def summarize_videos(videos: "Table", *, openai, existing_keys):
    todo = videos[~videos.video_id.isin(existing_keys)]
    # ... only summarize todo
```

**Collision policy (`upsert`).**  If the op returns the same `key` twice
in one run, that's an op bug — engine raises with a "duplicate key in
upsert output" banner.  (Open question §4.16.)

**Source ops + caching layer (§1.12.4) interaction.**  Regular caching
keys on `(formula, upstream_hashes)` and is opaque to the user.
Source-op persistence keys on `(workflow_id, step_id)` and is
*addressable*: the user sees "cached · N rows · M minutes ago" and can
explicitly Refresh.  The two layers compose: a downstream pure transform
above a source step caches normally; its cache invalidates iff the
source's output hash changes.

---

## 2. UI Fixes

Smaller, scoped changes — none of these are new features.

| # | Area | Bug / change | Repro / where | Status |
|---|---|---|---|---|
| 2.1 | (fill in) | (fill in) | | ⬜ |
| 2.2 | | | | ⬜ |
| 2.3 | | | | ⬜ |

### Suggested rows to seed it (delete what doesn't apply):

- **Formula bar** — caret position survives `injectReference` from another column (no jump to start/end).
- **Formula bar** — Esc dismisses the autocomplete dropdown without blurring the editor.
- **Formula bar** — multiline paste is collapsed to a single line (we're single-line UX).
- **Formula bar** — `Tab` accepts the highlighted autocomplete suggestion (instead of inserting a tab char).
- **Step header** — clicking the colored arrow toggles maximize, not expand (verify).
- **Step header** — operation-name dropdown shows full description on hover.
- **File tree** — single-click on a workflow opens it in a tab (today single-click does nothing visible, only double-click works).
- **File tree** — currently-active workflow row is highlighted.
- **Tabs** — middle-click closes a tab.
- **Tabs** — Ctrl/Cmd-W closes the active tab.
- **Tabs** — Ctrl/Cmd-S saves the active tab.
- **Sidebar collapse** — clicking the activity-bar icon for the *currently active* view collapses the sidebar (verify today's behavior).
- **Execution log** — auto-scroll to bottom on new entry, unless the user scrolled up.
- **Execution log** — clear button confirms before wiping.
- **Save modal** — Enter submits, Esc closes.
- **Command palette** — recently used commands surface first.
- **Toolbar** — Run/Pause/Stop buttons disable themselves when no steps exist.

---

## 3. How to use this doc

1.  Work top-down through §1.1 → §1.7.
2.  For each row: type the input, observe, mark ✅/🟡/❌, paste the actual error message into a sub-bullet if it doesn't match.
3.  Anything ❌ → open a corresponding test in `tests/test_safe_formula.py` (parser-level) or `tests/test_engine.py` (run-level) **first**, then fix until green.
4.  Once §1 is all ✅, do §2 the same way — but most UI rows will need a manual repro.
5.  When everything is ✅, this doc graduates to `docs/spec/formula_bar_spec.md` and becomes the user-facing contract.

---

## 4. Open questions

These need a yes/no before the parser rewrite lands.

1. **Bare-literal default column name** — `=42` produces a column called what?
   Proposal: `"value"`.  Alternative: leave unnamed (frontend renders index).
2. **`Cell([1,2])` policy** — error vs auto-promote to `Column`?
   Proposal: error, force user to pick the right constructor.
3. **`Column` name inference from single-key dict** — does the explicit
   `name=` override the key name?  Proposal: yes, explicit always wins.
4. **`Table` from file path** — sandbox to `WORKSPACE_ROOT`?
   Proposal: yes; absolute paths and `..` traversal rejected with a banner.
5. **Unknown parameters in operation calls** — silent drop, warn-and-run, or
   reject?  Proposal: **reject** with did-you-mean.  Reasoning: silent
   drops cause "why isn't my param working" tickets we can never debug.
6. **`step0` semantics** — error vs alias for "input dataframe".
   Proposal: error.  We don't have an "input dataframe" concept at the
   step level today — step1 *is* the first step.
7. **Case sensitivity of operation names** — `=OP` vs `=op`.
   Proposal: case-sensitive (Python-style).  `Cell`/`Column`/`Table` are
   capitalized because they are *types*; everything else is a function.
8. **`and` / `or` on step columns** — error or implicit translate to `&` / `|`?
   Proposal: error.  Python's `and`/`or` short-circuit on truthiness, which
   silently produces the *wrong* answer on pandas Series; better to fail
   loudly with "Use `&` for elementwise AND".
9. **`Expand` default `into=` behavior** — replace source column in place,
   or always require explicit `into=`?  Proposal: in-place replace when
   omitted; `into=` adds a new col and drops the source.
9b. **`Expand` axis inference from cell type** — list→rows, dict→cols,
    str→requires `sep`.  Lock these defaults?  Proposal: yes — they match
    the most common shape transitions and `axis=` is always available as
    an escape hatch.
10. **`Collapse` dropping un-aggregated columns** — silent drop or error?
    Proposal: silent drop **with a warning chip on the step header** listing
    which columns were dropped.  Quiet enough not to nag; visible enough
    to debug.
11. **Eval mode** — keep or remove?  With the new grammar (operator
    overloading + 3 constructors + ops), eval mode covers very few cases
    that `Column` / `Table` don't already handle.  Proposal: **remove**.
    Lean: smaller surface area, security boundary becomes "no imports,
    period."  Migration: rewrite eval recipes as registered operations.
12. **`Cell()` vs `Cell(None)` vs missing-value sentinel** — three concepts,
    do they collapse to two or stay separate?  Proposal: stay separate.
    `Cell()` → empty (`∅`, "no value computed"); `Cell(None)` → explicit
    null; missing/NaN inside a `Column` → propagates as usual.  Reasoning:
    reductions over empty columns need a distinct "I ran but had nothing
    to reduce" signal, otherwise it's indistinguishable from "user
    explicitly stored a null".
13. **Resource injection — by name vs explicit tuple.**  Proposal:
    inject by parameter-name match (`needs=["openai"]` ⇒ `def f(*, openai)`),
    pytest-fixture style.  Tuples `("openai", "client")` available as an
    opt-in for rename / disambig.  Failure mode for typo'd names is a
    clear "no such resource" error at op load time.
14. **Missing-secret failure mode — lazy vs eager.**  Proposal: **lazy** —
    fail at first op call that needs the secret, with a clickable
    "Add `OPENAI_API_KEY` in Settings → Secrets" banner.  A workflow of
    pure transforms shouldn't be blocked by missing LLM creds.  Eager
    check available via a Settings toggle.
15. **Cross-pack resource references.**  Proposal: addressable as
    `"pack_a.openai"`; bare names resolve current-pack-first, then global
    if unique; collisions without a prefix → boot error.  Same namespacing
    rule as op names — keeps the mental model consistent.
16. **Source-op `default_mode` default.**  Proposal: `replace`.  It's the
    only mode that's correct without a `key=` declared; surprises are
    limited to "I lost my cache" rather than "my data silently
    double-counted."  Incremental semantics opt in explicitly.
17. **Source-op `upsert` duplicate-key handling.**  Proposal: **error**
    with a banner naming the duplicate keys (top 5).  Silent
    last-write-wins hides op bugs forever.
18. **Async kwarg — `async_` vs sniff from signature.**  Proposal: sniff
    via `inspect.iscoroutinefunction`; allow `async_=False` to force sync
    execution of a coroutine (testing).  Removes a footgun where author
    marks `async_=True` but writes a sync `def`.
19. **Structured literal arguments (lists, dicts, tuples).**  Ops often
    take config like `by=["a","b"]` or `headers={"Accept":"json"}`.
    Proposal: accept literal `list` / `dict` / `tuple` as op arguments
    via the same `ast.literal_eval` path as bare literals (§1.1).  Depth
    capped at 3; deeper config must live in a workspace `.json` and load
    via `=Table("config.json")`.  No step refs allowed inside containers
    (use a dedicated op instead of nesting `step2.x` into a list).
20. **`ColumnRef` as a first-class param hint.**  Bare strings inside
    op kwargs (e.g. `by=["category", "region"]`) are ambiguous: literal
    string or column reference?  Proposal: introduce `ColumnRef` /
    `list[ColumnRef]` / `dict[ColumnRef, T]` as hint vocabulary; the
    decorator tells the engine which strings to validate as columns of
    the upstream step, drive autocomplete from, and auto-rewrite on
    rename.  Bar syntax stays plain strings.
21. **`**kwargs` opt-in for ops with truly dynamic kwargs.**  Override
    of §4.5 for HTTP/SQL/chart-style ops.  Proposal: `@op(accept_unknown_kwargs="headers")`
    funnels all unrecognised kwargs into the named parameter.  Required
    so autocomplete stops typo-correcting keys it can't know about.
22. **`Literal["a","b"]` hint for enum-like kwargs.**  Proposal: support
    `typing.Literal` in param hints — drives a dropdown in the bar and
    is validated at parse time.  E.g. `how: Literal["left","right","inner","outer"]`.
23. **Heterogeneous-cell `Expand`.**  When a column has mixed cell types
    (some lists, some dicts), refuse to infer axis.  Proposal: error
    with the offending row indices listed (top 5).  Don't try to "do the
    right thing" on mixed shapes.
24. **Pack hot-reload vs Restart.**  Proposal: Restart-only for v1.
    Hot-reload of decorated, possibly-stateful op modules is a notorious
    bug source (stale closures, frozen `Mock` clients).  Revisit in
    Phase C with a dedicated "Reload pack" affordance.
25. **Resource teardown order.**  Proposal: on Restart / session exit,
    resources with `.close()` are called in **reverse registration
    order** (so DB outlives HTTP outlives caches).  Spelled out so pack
    authors can rely on it.
26. **Reserved type names.**  Proposal: `Cell`, `Column`, `Table` are
    reserved — packs cannot register ops with those names.  Hard error
    at pack load.  Prevents users from shadowing constructors.
27. **`step0` reservation for future workflow input.**  Proposal: reject
    `step0` today with "Steps are 1-indexed."  Reserve the identifier so
    we can later use it for "workflow parameter / input dataframe" without
    breaking compat.

---

## 5. Decisions still needed before parser / pack-api code starts

Sticky list — flip ✅ as each is locked in.

- [ ] §4.5 reject unknown params *(lean: yes)*
- [ ] §4.11 remove eval mode *(lean: yes)*
- [ ] §4.13 resource injection by parameter name *(lean: yes)*
- [ ] §4.14 lazy secret check *(lean: yes)*
- [ ] §4.15 cross-pack resource naming `pack.name` *(lean: yes)*
- [ ] §4.16 source-op default mode = `replace` *(lean: yes)*
- [ ] §4.17 upsert duplicate keys → error *(lean: yes)*
- [ ] §4.18 sniff `async` from signature *(lean: yes)*
- [ ] §4.19 accept literal list/dict/tuple args, depth ≤ 3 *(lean: yes)*
- [ ] §4.20 `ColumnRef` / `list[ColumnRef]` / `dict[ColumnRef,T]` as hint vocab *(lean: yes)*
- [ ] §4.21 `accept_unknown_kwargs="param"` opt-in for dynamic kwargs *(lean: yes)*
- [ ] §4.22 support `typing.Literal[...]` for enum kwargs *(lean: yes)*
- [ ] §4.23 heterogeneous `Expand` → error with row indices *(lean: yes)*
- [ ] §4.24 Restart-only pack reload for v1 *(lean: yes)*
- [ ] §4.25 resource teardown in reverse registration order *(lean: yes)*
- [ ] §4.26 `Cell`/`Column`/`Table` reserved names *(lean: yes)*
- [ ] §4.27 reserve `step0` for future workflow input *(lean: yes)*
- [ ] §1.10 MVP op set — ship all 50 or pick a 20-op core?
