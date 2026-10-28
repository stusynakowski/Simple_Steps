# 101 — The Formula Language

## In one sentence

A formula is a **Python expression** parsed to an AST and interpreted by a
closed-world walker. Python's grammar; not Python's semantics.

See `src/SIMPLE_STEPS/safe_formula.py` for the implementation and
`tests/test_safe_formula.py` for the contract.

## What's allowed

| Shape | Example |
|---|---|
| Bare step reference | `step1` |
| Column via subscript | `step1["title"]` |
| Column via attribute | `step1.title` |
| Registered op call (kwargs) | `word_count(text=step1["title"])` |
| Registered op call (positional) | `word_count(step1["title"])` |
| Nested op calls | `tag(text=upper(text=step1.title), prefix="«")` |
| Literals | `"hello"`, `42`, `3.14`, `True`, `None`, `[1,2,3]`, `{"k": "v"}` |
| Unary `±` on a literal | `-5`, `+1.0` |
| Arithmetic | `2 + 3`, `a * b`, `x - 1`, `n / 2`, `n // 2`, `n % 2`, `n ** 2` |
| Comparison (single) | `views > 100`, `name == "alice"`, `n != 0`, `<`, `<=`, `>=` |

Subscript and attribute forms for column refs are **both accepted on
input** but **only the bracket form is emitted by the UI** — see
`103-ui-as-formula-formulator.md`. The interpreter treats them
identically.

## What's rejected (at validation, before execution)

- Calls to anything not in the registry — `os.system(...)`, `print(...)`,
  `random.random()`.
- Method calls of any kind — `step1.title.upper()`. The same effect must be
  obtained via a registered op.
- Attribute access on non-step expressions — `(step1.title).upper`.
- Dunder/private attributes — `step1.__class__`, `step1._df`.
- `__import__`, `getattr`, `setattr`, `exec`, `eval`, `compile`.
- `lambda`, `yield`, comprehensions, generator expressions, f-strings.
- `*args` / `**kwargs` unpacking at the call site.
- Assignments, statements of any kind. (`mode="eval"` parsing.)
- Walrus operator `:=`.
- Boolean operators `and` / `or` / `not` — ambiguous over pandas Series.
  Compose via ops (`all_of(...)`, `any_of(...)`) when we need them.
- **Chained** comparisons `1 < x < 10` — same Series-truthiness problem.
  Use two single comparisons combined externally.

## Public API

```python
from SIMPLE_STEPS.safe_formula import (
    parse, validate, describe, run_formula, FormulaError, Diagnostic,
)

parse(expression_str)            # → ast.Expression
validate(expression_str, available_steps={"step1"})  # → list[Diagnostic]
describe(expression_str)         # → {"valid":..., "top_level_op":..., "calls":..., "step_refs":...}
run_formula(expression_str, steps={"step1": df})     # → result (Step­Proxy/DF/scalar)
```

`validate` is **pure**: no side effects, no execution. This is what the UI
and the upcoming `/api/validate_formula` route lean on.

### Signature-aware validation

`validate` knows the signature of every registered op (via
`inspect.signature`) and reports:

- `unknown_kwarg` — a kwarg the function doesn't accept,
- `missing_required` — a required parameter (no default) was not supplied
  by either a positional arg or a kwarg,
- `too_many_positional` — more positional args than the function accepts.

Plus the parser-level checks: `unknown_op`, `unknown_name`,
`disallowed_node`, `indirect_call`, `attr_non_step`, `subscript_non_step`,
`subscript_non_string`, `dunder_attr`, `starred_arg`, `kwarg_unpack`,
`syntax_error`.

### Diagnostic shape

```python
@dataclass
class Diagnostic:
    message: str
    code: str                  # stable identifier (see list above)
    col_offset: int | None     # 0-based char offset in the formula body
    end_col_offset: int | None # exclusive end offset
```

`col_offset` / `end_col_offset` are character ranges inside the formula
body — the `=` prefix is already stripped. The UI uses them to draw a
squiggle over exactly the bad text, the same way a linter does.

Severity isn't a field on `Diagnostic` yet; the UI can derive it from
`code` (everything is currently "error"). When we add warning-level codes
we'll add a `severity` field rather than overload `code`.

## How calls dispatch

When the interpreter sees `op_name(arg1, kw=arg2)`:

1. It evaluates each `arg` recursively (literals → values; step refs → the
   stored output; nested calls → recurse).
2. It looks up `op_name` in `OPERATION_REGISTRY`.
3. It invokes the function through `_auto_broadcast`, which is the same
   wrapper used everywhere else in Simple Steps — so passing a column
   reference still auto-maps the call row-wise, and passing a DataFrame
   still passes the whole table.

The interpreter does not duplicate orchestration logic. It picks **what**
to call and **with what arguments**; the existing wrappers decide **how**
to call it.

## Error reporting

`validate` collects multiple diagnostics per pass. Each carries a stable
`code` and (where the AST node has one) a character range, so the UI can
render them as squiggles instead of a single banner. See
`105-validation-flow.md` for the end-to-end flow.

`run_formula` raises a `FormulaError` with a single combined message if
validation fails. Operations themselves may raise their own exceptions;
those propagate as-is so they can be caught at the runner level and
displayed against the step that produced them.

## Function-owned arguments

Most kwargs in a formula are step-derived: `text=step1["title"]`. Some
aren't — they're configuration the op author chose: API keys, model
names, file paths, retry counts. Those are plain literal kwargs:

```text
=summarize(text=step1["transcript"], model="gpt-5", api_key="sk-…")
```

The interpreter doesn't care which kwargs are step-derived and which are
literal — they all flow through `validate`'s signature check and then
into the function. The op author defines them; the UI renders them as
ordinary form fields next to the step-ref pickers.

(Where the value comes from — secret store, env var, settings panel —
is a UI concern, not a formula-language concern.)
