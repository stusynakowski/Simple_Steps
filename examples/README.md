# The Simple Steps example

One file, [`tools.py`](tools.py), and it is the whole backend a developer has
to write. Everything a user can do in the UI comes from the tools registered
there. Use it to install the app, confirm it runs, and find out what breaks.

```bash
python tools.py        # registers the tools, starts the server + UI
```

Each tool is a plain Python function with a `@simple_step_tool` decorator. The
decorator reads the signature and the docstring to build the tool's contract —
parameter types, which are required, what it returns — so the UI form, the
formula-bar autocomplete and the tool registry all come from the function
itself. Nothing else has to be declared.

## Install and run

Simple Steps needs **Python 3.10 or newer** (`simple-steps-core` requires it;
on 3.9 the install fails with a confusing dependency-resolution error).

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
python -m pip install --upgrade pip

# from a checkout of the Simple_Steps repo:
python -m pip install /path/to/Simple_Steps

python tools.py                    # opens http://127.0.0.1:8000
```

`python tools.py` registers these 17 tools and launches the server with the UI
attached. The 29 built-in tools load alongside them, so the formula bar offers
46 in total. Add `--no-browser` to stay in the terminal, or `--port 8123` if
8000 is taken.

## What you should see in the formula bar

**46 tools: these 17, plus 29 built-ins that load whether or not you run this
file.** Worth knowing before you go looking for a typo — if a name you don't
recognise appears in autocomplete, it is probably a built-in (listed further
down), not a stray.

Every entry below was read out of the live registry, and all 46 were checked
against the formula parser: 46/46 recognised, none unknown.

### The 17 in `tools.py`

Chosen to cover every orchestration mode and every failure shape rather than to
be useful. An argument shown without `=` is required; the rest show their
default.

| Category | Formula | Returns | What it exercises |
|---|---|---|---|
| **Sources** | `=make_range(n=10, start=0)` | DataFrame | Starting a workflow with no upstream input |
| | `=sample_people(count=8, seed=0)` | DataFrame | A richer source — names, ages, scores, cities |
| | `=split_text(text='alpha,beta,gamma', separator=',')` | DataFrame | One string in, many rows out |
| | `=empty_table(columns='a,b,c')` | DataFrame | The zero-row case, with columns intact |
| **Text** | `=word_count(text)` | int | Per-cell application across a column |
| | `=to_upper(text)` | str | |
| | `=reverse_text(text)` | str | |
| **Analysis** | `=classify_age(age)` | str | Per-cell with a derived label |
| | `=bucket_score(score, scheme='thirds')` | str | Enum parameters — see the known gap below |
| **Diagnostics** | `=slow_double(n, delay_ms=250)` | int | Progress reporting on a slow step |
| | `=sometimes_fails(n, fail_on_multiples_of=3)` | int | Partial failure: some rows raise, others don't |
| **Table** | `=add_computed(df, source_column='', new_column='computed', operation='double')` | DataFrame | Whole-table transforms |
| | `=top_n(df, column='', n=5, descending=True)` | DataFrame | |
| | `=summarize(df)` | DataFrame | Collapsing a table to one summary row |
| | `=count_by(df, column='')` | DataFrame | Grouping |
| **Shapes** | `=build_record(value)` | dict | A cell holding a dict, not a scalar |
| | `=make_series(n, length=4)` | list | A cell holding a list — feed it to an Expand |

### The 29 built-ins, available either way

These ship with the package. You get them from a bare `simple-steps` with no
tools file at all, which is why that is enough to confirm an install works.

| Category | Tools |
|---|---|
| **Data Reshaping** (18) | `add_column` · `aggregate` · `cast_column` · `drop_columns` · `extract_json` · `flatten_json` · `format_string` · `group_by` · `merge_steps` · `pandas_eval` · `pivot` · `rename_columns` · `sample_rows` · `select_cell` · `select_columns` · `select_rows` · `sort_by` · `unpivot` |
| **Data Cleaning** (3) | `deduplicate` · `drop_na` · `filter_rows` |
| **Data Sources** (2) | `define_value` · `to_rows` |
| **File IO** (1) | `load_csv` |
| **Variables** (1) | `literal` |
| **Orchestration** (4) | `ss_map` · `ss_filter` · `ss_expand` · `ss_reduce` |

> **`select_cell` currently has a real bug** — it raises `KeyError: 0`. It is
> the single failing test in the suite
> (`tests/test_tabular_selection.py::test_select_cell`). Avoid it until that is
> fixed; `select_rows` and `select_columns` are fine.

## A first workflow

Build this in the UI, one step at a time:

```
Step 1   =sample_people(count=12, seed=7)
Step 2   =classify_age(age=step1["age"])
Step 3   =bucket_score(score=step1["score"], scheme="thirds")
Step 4   =count_by(df=step1, column="city")
```

Steps 2 and 3 both read from step 1, which is the point — a step references
whichever earlier step it needs, not just the one immediately before it.

## Things worth deliberately breaking

Each of these exercises a rule the system is supposed to honor. If one behaves
differently than described, that's a real bug.

**Empty in, empty out.** Run `=empty_table(columns="a,b,c")`, then point
`summarize` or `top_n` at it. Every tool should return an empty result of the
right shape. None should raise.

**Partial failure.** Run `=make_range(n=10)`, then
`=sometimes_fails(n=step1["n"])`. Rows 3, 6 and 9 raise; the other seven
should still produce values, and a step downstream should still be able to read
them.

**Progress on a slow step.** Run `=make_range(n=20)` then
`=slow_double(n=step1["n"], delay_ms=300)` — about six seconds. The step should
report progress as it goes and the UI should stay responsive.

**A missing column.** Point `top_n` at a column that doesn't exist. The error
should name the column and list what's available, in the UI, without a stack
trace.

**Non-scalar cells.** Run `=sample_people()` then
`=build_record(value=step1["name"])`. Each cell now holds a dict. Check the
grid renders it and that clicking a cell shows the contents.

**Rename a step.** Rename step 1 and check that formulas referencing it still
resolve. References are supposed to survive a rename.

## Enum arguments: dropdown in the form, rejected in the formula bar

`bucket_score` and `add_computed` both declare a constrained argument:

```python
scheme:    Literal["thirds", "halves", "pass_fail"] = "thirds"
operation: Literal["double", "square", "negate", "abs"] = "double"
```

Both are now honored in both places a value can be entered:

- **The parameter form gives a dropdown** of exactly those values. If a step
  already holds something else — a wired reference, or a value from an older
  save file — it is kept as an extra option labelled `(not a valid choice)`
  rather than silently replaced.
- **The formula bar rejects an invalid constant** before the step runs:

  ```
  =bucket_score(score=step1["score"], scheme="typo_here")
  → 'typo_here' is not a valid value for 'scheme'.
    Choose one of: 'thirds', 'halves', 'pass_fail'
  ```

A value that is a reference rather than a constant — `scheme=step1["x"]` — is
deliberately **not** flagged. What it holds is unknowable until the step runs,
and guessing would invent errors.

### Why this needed a local workaround

The allowed values are already in the JSON Schema core derives, and reading
them from there would have been the clean route. It does not work, for a reason
worth knowing if you write tools:

**A single `pd.DataFrame` parameter empties a tool's entire `input_schema`.**
Pydantic cannot model a DataFrame field, and core falls back to a bare `{}` for
*every* property rather than just that one. Verified directly: a tool with
`(mode: Literal["a","b"], n: int)` gets a complete schema; add
`df: pd.DataFrame` and all three properties become `{}`. Core also reports
`type_name="Any"` for every parameter of such a tool.

Most table tools take a DataFrame, so for them the schema carries no types, no
enums and no required flags — and `input_schema` is what grounds the agent
layer. So both the dropdown and the validator read the function's resolved
annotations instead. Recorded as §J in
[`docs/core-proposals/003-app-adoption.md`](../docs/core-proposals/003-app-adoption.md).

## Uninstalling

```bash
deactivate && rm -rf .venv
```
