# The Simple Steps examples

Small examples, each a complete Simple Steps application, and a main
example that uses them all at once. Every example ships saved workflows you
can open in the UI, and a `runme.py` that runs them headlessly and proves each
step produced what it should.

```
examples/
├── app.py            the main example: every sub-example's tools in one app
├── runme.py          runs every sub-example's checks, then the main workflow's
├── main_pipeline.py  the main workflow, written in Python
├── workspace/projects/main/all-examples.simple-steps-workflow
│
├── basic/            core verbs and data manipulation       → basic/README.md
├── dummy_llm/        resources: a dummy database and models → dummy_llm/README.md
├── plotly_charts/    Plotly charts and other rich cells     → plotly_charts/README.md
├── image_processing/ a folder of images as a resource      → image_processing/README.md
├── agent_demo/       build a workflow by asking the agent   → agent_demo/README.md
└── bad_examples/     mistakes, and how to fix them          → bad_examples/README.md
```

Each sub-example has the same five parts:

| file | what it is |
|---|---|
| `<name>_tools.py` | the tools (and resources): plain functions with `@simple_step_tool` |
| `app.py` | the application: `App(tools=[…], workspace="workspace")` |
| `workspace/projects/<name>/*.simple-steps-workflow` | saved workflows, one formula per step |
| `<name>_pipeline.py` | the same workflows written in Python: one line per step |
| `runme.py` | runs the saved workflows and checks every step |

## Install and run

Simple Steps needs **Python 3.10 or newer**.

```bash
python3 -m venv .venv && source .venv/bin/activate
python -m pip install simple-steps          # or: pip install /path/to/Simple_Steps
simple-steps --load-examples                # copies these examples to ./examples
```

Then, for any example:

```bash
simple-steps run examples/app.py              # serve it and open the UI (or: python examples/app.py)
simple-steps run examples/basic/app.py        # one sub-example on its own
python examples/runme.py                      # check everything: each sub-example, then the main one
python examples/basic/runme.py                # check one sub-example
```

In the UI, open a workflow from the file explorer and press **Run All**.

## What `runme.py` checks

For every saved workflow, every step is run **twice**:

1. **through the app**, the way the UI's Run does — the formula parsed, the
   step's input and references resolved, the workflow's resources built — by
   the same code `/api/run` calls;
2. **in Python**, from the example's `_pipeline.py`, straight in
   simple-steps-core. Each saved step is one line there, and its formula is
   exactly that line's right-hand side:

   ```
   saved formula:  scale[mod.map(), mod.name("score")](wf["readings"])
   Python:         wf["scored"] = scale[mod.map(), mod.name("score")](wf["readings"])
   ```

   A twin imports the tools like any module — `from basic_tools import scale`
   — because `@simple_step_tool` returns core's own tool handle: brackets
   build a core step, while a plain call, `scale(3)`, still just runs it.

The two outputs must match, cell for cell (images, tables and Plotly figures
by content). Some steps are also checked against values written out in
`runme.py`, so a mistake both runs share still fails:

```
── basic/all-orchestrations
PASS  readings         to_rows[mod.source()](data='{"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]}')
PASS  scored           scale[mod.map(), mod.name("score")](wf["readings"])
…
63/63 steps as expected
```

A failing step says what differs (`score[0]: app 10, Python 20`) and the
script exits non-zero. The checks run in the test suite too
(`tests/test_examples.py`). The machinery is
[`SIMPLE_STEPS/example_check.py`](../example_check.py).

## The formula syntax in one screen

A step is written the way simple-steps-core writes an operation:

```
=scale[mod.map(), mod.name("score")](wf["readings"], weight=2)
 tool  modifier stack          the input       arguments
```

- **`wf["readings"]` is the only way to refer to a step.** A quoted string is
  just text.
- **The verb goes in the brackets:** `mod.map`, `mod.filter`, `mod.select`,
  `mod.collapse`, `mod.table`, …, optionally with execution modifiers
  `mod.retry(…)`, `mod.timeout(…)`, `mod.try_except(…)`.
- **Sources and sweeps have no input:** `=to_rows[mod.source()](data='…')`,
  `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]`.
- **Verbs that apply no tool use `identity`:**
  `=identity[mod.select(columns=["n"])](wf["readings"])`.
- **No brackets lets core pick the verb:** `=scale(wf["readings"])` maps,
  `=is_big(wf["readings"])` filters. `mod.auto()` picks it again on every run.
- **A plain value is a one-cell source:** `=[1, 2, 3, 4]`.
- **Combines read several steps:** `=join(wf["a"], wf["b"], on="city")`,
  `=stack(…)`, `=zip_(…)`.
- **Resources are `res["name"]`:** `=summarize[mod.map()](wf["notes"], llm=res["llm"])`.

## The agent

[`agent_demo/`](agent_demo/README.md) turns the agent on with a local Ollama
model: open the chat pane, ask for a step, apply the proposal. Its `ask.py`
sends five requests to your model from the terminal and checks what it
builds by each step's output; its `runme.py` checks everything but the model,
so it passes without Ollama.

## Bad examples

[`bad_examples/`](bad_examples/README.md) is the other side: 20 mistakes —
a bare step name, a misspelt setting, a column the input doesn't have, a
tool typed `int` over a column with gaps, an argument hiding a column, an
uncaught failure — each with what Simple Steps says about it and the step
written right. Its `runme.py` checks that every mistake is refused, warned
about or fails rows in exactly those words, and that every fix runs cleanly.

```
PASS  nullable_column  add_one[mod.map()](wf["gappy"])
      → refused: gappy.n can be None, but add_one() takes n: int; accept int | None, or filter the Nones first
```

## The main example

[`app.py`](app.py) imports the tools of every sub-example and offers
their resources, and `all-examples` uses them together:

| step | formula | from |
|---|---|---|
| `scored` | `scale[mod.map(), mod.name("score")](wf["readings"])` | basic |
| `big` | `is_big[mod.filter()](wf["scored"])` | basic |
| `regions` | `enrich[mod.map(), mod.name("region")](wf["big"], db=res["db"])` | dummy_llm |
| `summaries` | `summarize[mod.map(), mod.name("summary")](wf["texts"], llm=res["llm"])` | dummy_llm |
| `total_n` | `add_n[mod.collapse(initial=0)](wf["big"])` | basic |
| `swatches` | `swatch[mod.map(), mod.name("swatch")](wf["big"])` | plotly_charts |
| `chart` | `bar_chart[mod.collapse()](wf["big"])` | plotly_charts |

## Adding a sub-example

Copy a sub-example folder and rename its modules. Each sub-example folder is
a package (it has an `__init__.py`), so the main app imports its tools like
any other module — `from basic import basic_tools` — with nothing added to
the import path. Two rules keep that working:

- **The tools module imports nothing from its own folder.** The main app
  imports it as `basic.basic_tools`, where a sibling's bare name
  (`import other_module`) doesn't resolve. That's why everything `dummy_llm`
  offers — its dummy models, the Ollama model, `TYPES` and `ready_made()` — is
  in one file, `llm_tools.py`. The sub-example's own `app.py`, `runme.py` and
  `_pipeline.py` run from its folder, so they may import siblings.
- **No folder is named after a library** — that's why the Plotly example is
  `plotly_charts/`, not `plotly/`, which would hide the real `plotly`.

Then import it in [`app.py`](app.py), add its tools module to `tools=[…]`, and
add the folder to `SUB_EXAMPLES` in [`runme.py`](runme.py).

## Built-in tools

29 tools ship with the package and load in every example, beside the
example's own — `to_rows` (used by every workflow here), `load_csv`,
`select_columns`, `pivot`, `merge_steps` and the rest. Built-in or not, every
tool appears in the formula bar's autocomplete and the palette.
