# Basic — core verbs and data manipulation

The place to start: plain functions, no resources, nothing installed beyond
Simple Steps. [`basic_tools.py`](basic_tools.py) is the file to copy for your
own tools.

```bash
simple-steps run examples/basic/app.py     # serve it; open a workflow and press Run All
python examples/basic/runme.py             # run both workflows and check every step
```

## Workflows

| workflow | steps | what it shows |
|---|---|---|
| [`all-orchestrations`](workspace/projects/basic/all-orchestrations.simple-steps-workflow) | 44 | every shape verb, the combine verbs, execution modifiers, verb inference, plain values as sources — simple-steps-core's own `all_orchestrations` example, step for step |
| [`table-tools`](workspace/projects/basic/table-tools.simple-steps-workflow) | 19 | the data-manipulation tools: sources, per-row text and analysis, whole-table tools, a caught failure, empty in → empty out |

Their Python twins are `build_all_orchestrations()` and `build_table_tools()`
in [`basic_pipeline.py`](basic_pipeline.py).

## The tools

**Core verbs** — the nine tools of core's example. Core infers a step's verb
from a tool's signature, so these are written to give each signal:

| tool | signature | verb it suits |
|---|---|---|
| `scale` | `(n, weight=1)` | map |
| `is_big` | `(n) -> bool` | filter |
| `label_city` | `(city)` | group |
| `add_n` | `(acc, n)` | collapse (a reducer) |
| `fan_out` | `(n) -> list` | expand |
| `make_coords` | `(n)` → list of records | expand, then widen |
| `grid_cell` | `(model, window)` | sweep |
| `risky` | `(n)`, raises on 2 | partial failure |
| `make_pair` | `(n)` → tuple | widen by position |

**Data manipulation** — chosen to cover every shape and failure, not to be
useful:

| category | tools | formula, as in `table-tools` |
|---|---|---|
| Sources | `make_range`, `sample_people`, `split_text`, `empty_table` | `make_range[mod.source()](n=6, start=1)` |
| Text | `word_count`, `to_upper`, `reverse_text` | `word_count[mod.map(), mod.name("words")](wf["words"])` |
| Analysis | `classify_age`, `bucket_score` | `bucket_score[mod.map(), mod.name("band")](wf["people"], scheme="halves")` |
| Diagnostics | `slow_double`, `sometimes_fails` | `sometimes_fails[mod.map(), mod.name("checked"), mod.try_except(default=-1)](wf["numbers"])` |
| Table | `add_computed`, `top_n`, `describe_table`, `count_by` | `top_n[mod.table()](wf["people"], column="score", n=3)` |
| Shapes | `build_record`, `make_series` | `make_series[mod.expand(), mod.name("item")](wf["numbers"], length=2)` |

A per-row tool reads columns **by name**: `word_count(text)` reads the `text`
column, which is why `split_text` writes one. A whole-table tool,
`f(df: pd.DataFrame, …)`, runs under `mod.table()` and gets the entire input.

## Things worth deliberately breaking

Each exercises a rule the system is supposed to honour. If one behaves
differently than described, that's a real bug.

- **Empty in, empty out.** `describe_table[mod.table()](wf["empty"])` reads a
  zero-row table and returns one row per column, `non_null` 0. No tool should
  raise on an empty input.
- **Partial failure.** Drop the `mod.try_except(default=-1)` from `checked`:
  rows 3 and 6 fail, the others still produce values, and **Run All** stops
  there and says how to let the failures through.
- **Progress on a slow step.** Change `doubled`'s `delay_ms=0` to `300`: the
  step reports progress as it goes and the UI stays responsive.
- **A missing column.** Point `top_n` at `column="nope"`: the error names the
  column and lists what's there, without a stack trace.
- **An invalid choice.** `bucket_score`'s `scheme` is
  `Literal["thirds", "halves", "pass_fail"]`: the form offers a dropdown, and
  `scheme="typo"` in the formula bar is refused before anything runs.
- **Rename a step.** Rename `people`; the steps reading `wf["people"]` should
  follow it.
