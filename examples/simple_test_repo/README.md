# simple_test_repo

A self-contained tool registry for Simple Steps. Use it to install the app,
confirm it runs on your machine, and find out what breaks.

Everything a user can do in the UI comes from [`tools.py`](tools.py). That one
file is the whole "backend" a developer has to write.

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

`python tools.py` registers the 17 tools and launches the server with the UI
attached. Add `--no-browser` to stay in the terminal, or `--port 8123` if 8000
is taken.

## What's in here

17 tools across five categories, chosen to cover every orchestration mode and
every failure shape rather than to be useful.

| Category | Tools | What they exercise |
|---|---|---|
| **Sources** | `make_range` · `sample_people` · `split_text` · `empty_table` | Starting a workflow with no upstream input |
| **Text** | `word_count` · `to_upper` · `reverse_text` | Per-cell application across a column |
| **Analysis** | `classify_age` · `bucket_score` | Per-cell with arguments; enum parameters |
| **Table** | `add_computed` · `top_n` · `summarize` · `count_by` | Whole-table transforms |
| **Diagnostics** | `slow_double` · `sometimes_fails` | Progress reporting and partial failure |
| **Shapes** | `build_record` · `make_series` | Cells holding a dict or a list, not a scalar |

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

## Known gap: enum arguments render as free text

`bucket_score` declares its argument properly:

```python
scheme: Literal["thirds", "halves", "pass_fail"] = "thirds"
```

That should give you a dropdown with three options and reject anything else
before the step runs. Today the decorator flattens it to a plain string field,
so you get a text box and a typo only surfaces as a crash at run time.
`add_computed`'s `operation` argument has the same problem.

This matters more than it looks: the JSON Schema the UI builds its forms from —
and the schema an agent is grounded on — is derived from these annotations. If
every parameter is a string, forms stay untyped and an agent has nothing to
constrain it. Fixing the decorator to honor `Literal` fixes both at once.

## Uninstalling

```bash
deactivate && rm -rf .venv
```
