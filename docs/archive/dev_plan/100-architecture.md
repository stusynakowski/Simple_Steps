# 100 — Architecture

## The single idea

> Each step in a workflow owns one Python **expression**. The expression is
> evaluated by a safe AST interpreter. Its output is bound to the step's name
> and becomes available to later steps.

That's the whole system. Everything else — the UI, the file format, the
session manager, the agent — is in service of constructing, validating,
storing, and running these expressions.

## The four nouns

| Noun | What it is | Lives in |
|---|---|---|
| **Operation** | A registered Python function (`@simple_step`). Vanilla function with a typed signature. | `OPERATION_REGISTRY` |
| **Expression** | A string of Python *syntax* describing one step's computation. | The formula bar; the workflow file |
| **Step** | A `(name, expression)` pair, plus the materialised **output** once run. | Session; workflow file |
| **Workflow** | An ordered list of steps. | Project file on disk |
| **Session** | A workflow plus the cached outputs of any steps that have run. | Backend memory / parquet cache |

Note "operations" are *not* a noun the user manipulates. They are the
vocabulary out of which expressions are built. The user's mental object is
the **expression**.

## Step outputs and references

Each step's output is bound to its step name (`step0`, `step1`, `step2`, …
by default; user-rename-able). Inside another step's expression you refer to
that output in one of three ways:

| Syntax | Returns | When to use |
|---|---|---|
| `step1` | The full output (DataFrame / Series / scalar) | Passing a whole table to a `dataframe`-style op |
| `step1["col"]` | The named column as a Series | The canonical form for column refs |
| `step1.col` | Equivalent to `step1["col"]` for valid Python identifiers | Accepted on input only — never emitted by the UI |

**Decision: the UI always emits bracket form; both forms are accepted on input.**

The "insert column reference" button, autocomplete completions, and any
expression text the UI writes on the user's behalf always use
`step1["col"]`. Bracket form is the canonical shape because column names
with spaces, dashes, or unicode all work without quoting decisions — and
that's a real-world constraint we don't want to litigate inside the
formula bar.

Dot form is still accepted by the parser because users will reasonably
type `step1.col` when authoring expressions by hand, and rejecting it
would be hostile. Both shapes collapse to the same AST resolution at
interpret time.

## Argument shapes

A call like

```python
filter_rows(data=step1, column="views", min_value=100)
```

has three kinds of arguments mixed together, and the UI treats them
differently:

- **Step-reference args** — `data=step1`, or `column_data=step1["views"]`.
  Resolved at run time by looking up the named step's output in the
  session. The UI populates these with a *step picker* / *column picker*.
- **Literal config args** — `min_value=100`, `column="views"`. Plain Python
  literals. The UI renders these as ordinary form fields (number, string,
  enum, etc.) whose values get serialised into the expression as
  literals.
- **Nested calls** — `data=clean(rows=step1)`. The argument is itself a
  registered op call. The UI shows this as an inline sub-panel (later;
  text-mode is fine for v1).

The user doesn't have to know which is which; the registered function's
type-annotated signature drives the form rendering.

## Execution boundary

Expressions are **never** run with `eval`. They are parsed to an `ast` tree
and walked by the interpreter in `safe_formula.py`, which only knows how to:

- look up step names,
- read attributes/subscripts on step refs,
- call registered operations,
- handle literals.

Everything else is rejected at validation time. See
[`101-formula-language.md`](./101-formula-language.md) for the full list.

The backend therefore has a clean invariant: **the only Python code that
ever runs as a result of a formula is code the user has put into the
registry**.

## What about the `=` sign?

The `=` is a UI convention. The workflow file and the in-memory session
both store expressions *without* the leading `=`. See
[`104-equals-sign-convention.md`](./104-equals-sign-convention.md).

## What replaces the old "process_type / configuration" pair?

The earlier model stored each step as:

```jsonc
{
  "operation_id": "filter_rows",
  "configuration": { "column": "views", "min_value": 100 },
  "process_type": "filter"
}
```

That representation is now **derivable** from the expression string —
the AST tells you the top-level op id, the kwargs, and which args are
step references. We keep one field: `expression`. The structured view is
a projection computed on demand.

This is the single biggest simplification of the redesign.
