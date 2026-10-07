# All orchestrations — core's example, as an app workflow

simple-steps-core's canonical example
([`examples/all_orchestrations/pipeline.py`](../../external/simple-steps-core/examples/all_orchestrations/pipeline.py))
rebuilt as a Simple Steps workflow: the same nine tools, the same tiny
dataset, and one step per step of core's workflow, each written as a formula.

| file | what it is |
|---|---|
| [`app.py`](app.py) | the application: `App(tools=[tools], resources=[…], loaded={…})` — `python app.py` serves it |
| [`tools.py`](tools.py) | core's registry, declared with `@simple_step_tool`, plus its resource types (`@simple_step_resource`) |
| [`projects/demo/all-orchestrations.simple-steps-workflow`](projects/demo/all-orchestrations.simple-steps-workflow) | the 44-step workflow: every shape verb |
| [`projects/demo/resources.simple-steps-workflow`](projects/demo/resources.simple-steps-workflow) | the 11-step resources workflow: core's `build_resources()`, plus a ready-made resource |
| [`projects/demo/rich-cells.simple-steps-workflow`](projects/demo/rich-cells.simple-steps-workflow) | 5 steps whose cells are images, tables and a Plotly chart (app only) |
| [`local_llm.py`](local_llm.py) | `OllamaLLM`: a real local model as a resource, loaded only if Ollama has it |
| [`projects/demo/local-llm.simple-steps-workflow`](projects/demo/local-llm.simple-steps-workflow) | 3 steps that use the local model (needs Ollama) |
| [`check.py`](check.py) | runs every workflow the way the UI does and compares every step with core |

```bash
python examples/all_orchestrations/check.py        # 60/60 steps match simple-steps-core (63 with Ollama)
python examples/all_orchestrations/app.py          # serve it (or: simple-steps --workspace examples/all_orchestrations)
                                                    # open a workflow in the UI and press Run
```

## The formulas are core's own syntax

Each step is written the way simple-steps-core writes an operation, so a
formula reads the same as the Python in core's `pipeline.py`:

```
=scale[mod.map(name="score")](wf["readings"], weight=2)
 tool  modifier stack          the input       arguments
```

- **`wf["readings"]` is the only way to refer to a step.** Every quoted
  string is just text (`docs/dev_plan/120-literals-and-references.md`).
- **The verb goes in the brackets.** `mod.map`, `mod.filter`, `mod.select`,
  `mod.collapse`, …, optionally followed by `mod.retry(…)` / `mod.timeout(…)`.
- **The step it reads goes in the call.** Keyword arguments are the tool's
  arguments.
- **Sources and sweeps have no input:** `=to_rows[mod.source()](data='…')`,
  `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]`.
- **Verbs that apply no tool use `identity`:**
  `=identity[mod.select(columns=["n"])](wf["readings"])`. Built-in reducers are
  named directly: `=count[mod.collapse()](wf["readings"])`.
- **`=scale(wf["readings"])` lets core infer the verb** from the tool.
- **A plain value is a one-cell source:** `=[1, 2, 3, 4]`.
- **Combines read several steps and apply no tool:**
  `=join(wf["readings"], wf["city_info"], on="city", how="left")`,
  `=stack(wf["readings"], wf["more"])`, `=zip_(wf["ns"], wf["scores_only"])`.
  They take no brackets; every positional argument is a step and every
  setting is a literal keyword (core 005 B).

| core (`pipeline.py`) | formula |
|---|---|
| `scale[mod.map(over=wf["readings"], name="score")]` | `=scale[mod.map(name="score")](wf["readings"])` |
| `mod.sort(over=wf["scored"], by="score", ascending=False)` | `=identity[mod.sort(by="score", ascending=False)](wf["scored"])` |
| `add_n[mod.collapse(by="bucket", over=wf["bucketed"], initial=0)]` | `=add_n[mod.collapse(by="bucket", initial=0)](wf["bucketed"])` |
| `grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` | `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` |
| `scale(wf["readings"])`, verb inferred | `=scale(wf["readings"])` |
| `wf["a_list"] = [1, 2, 3, 4]` | `=[1, 2, 3, 4]` |
| `join(wf["readings"], wf["city_info"], on="city", how="left")` | `=join(wf["readings"], wf["city_info"], on="city", how="left")` |
| `stack(wf["readings"], wf["more"])` | `=stack(wf["readings"], wf["more"])` |
| `zip_(wf["ns"], wf["scores_only"])` | `=zip_(wf["ns"], wf["scores_only"])` |
| `wf["city_info"] = pd.DataFrame({...})` | `=to_rows[mod.source()](data='{...}')` |

The verb is part of the formula, so the saved file is the whole workflow.
The app compiles each formula to core's operation JSON
(`src/SIMPLE_STEPS/operation_formula.py`) and core runs it.

## Resources

A resource is an object steps use that isn't data: here a dummy database
(`FakeDB`) and a dummy LLM (`FakeLLM`). Three marks in `tools.py`:

- `@simple_step_resource` on a class declares a resource **type**, built from
  literal settings.
- `@simple_step_tool` on one of its methods makes that method a **bound
  tool**. Unmarked methods (`FakeDB.reset`) are never tools.
- `@simple_step_tool` on a function with a resource-typed parameter
  (`summarize(text, llm: FakeLLM)`) makes an **unbound tool**: it needs a
  resource of that type but doesn't belong to one.

The workflow file names its instances in a `resources` section, and steps use
them with `res["…"]`:

```jsonc
"resources": {"db":   {"source": "defined", "type": "FakeDB"},
              "llm":  {"source": "defined", "type": "FakeLLM", "settings": {"model": "fake-1"}},
              "tiny": {"source": "defined", "type": "TinyLLM", "settings": {"model": "tiny-1"}}}
```

| formula | what it does |
|---|---|
| `=enrich[mod.map()](wf["readings"], db=res["db"])` | unbound tool, resource by name |
| `=summarize[mod.map()](wf["notes"], res["tiny"])` | unbound tool, resource by position, matched by type (a `TinyLLM` fits `llm: FakeLLM`) |
| `=res["db"].lookup[mod.map()](wf["keys"])` | bound tool |
| `=res["llm"].complete[mod.source()](prompt="hi")` | bound tool as a source |
| `=res["db"].lookup(wf["keys"])` | bound tool, verb inferred |

The app builds each instance the first time a step uses it, keeps one per
session, and builds a new one when its settings change.

**Ready-made resources** come from the deployment, not the workflow.
`app.py` provides one:

```python
App(..., loaded={"house_llm": Loaded(FakeLLM, model="house-1")})   # env("NAME") for credentials
```

The workflow uses it and changes one setting. The file saves only the change,
so the deployment's settings apply underneath:

```jsonc
"house_llm": {"source": "loaded", "type": "FakeLLM",
              "as_loaded": {"model": "house-1"}, "overrides": {"model": "house-2"}}
```

`=summarize[mod.map()](wf["notes"], llm=res["house_llm"])` gives
`[house-2] A`, `[house-2] B`. Core has no ready-made resources, so `check.py`
marks this step *app only* and checks it against fixed values. In the UI the
toolbar's **Resources** menu lists ready-made resources under *From the
deployment* with a **Use** button.

## Rich cells

A cell can hold more than text: `rich-cells` returns an image per row
(`swatch`, a numpy array), a table per row (`profile`), and a Plotly chart
(`city_chart`, which needs `pip install simple-steps[media]`). The grid shows a
thumbnail or a short summary (`16×16 RGB image`, `table 1×3`,
`bar chart · 1 trace · Readings per city`); clicking the cell opens the full
view. `bright` reads the images back with `brightness`, which gets the real
array, never the thumbnail.

## A real local model (optional)

`local_llm.py` declares `OllamaLLM`, a resource that calls a model served by
[Ollama](https://ollama.com) on this machine (standard library only, no extra
package). `app.py` offers it as the ready-made `res["local_llm"]` **only when
it can be loaded**. Otherwise the app starts as usual and prints why:

```
ⓘ  local_llm not loaded: Ollama isn't answering at http://localhost:11434 (…)
ⓘ  local_llm not loaded: Ollama doesn't have llama3.2:3b (it has: …); run: ollama pull llama3.2:3b
```

To use it, a small model is enough. `llama3.2:3b` (about 2 GB) runs
comfortably on an M-series Mac with 16–24 GB of memory:

```bash
ollama pull llama3.2:3b          # once
python examples/all_orchestrations/app.py
```

Use another model or server with `OLLAMA_MODEL=qwen2.5:3b` or `OLLAMA_HOST=…`.
`OllamaLLM` is an `LLM`, so it fits any tool that takes one:
`=summarize[mod.map()](wf["notes"], llm=res["local_llm"])`, or call it directly
with `=res["local_llm"].complete[mod.source()](prompt="…")`. The `local-llm`
workflow does both. `check.py` runs it only when the model is loaded, and
checks just that every answer is non-empty text, since a real model's words
vary. Without Ollama it prints `SKIP`.

## Differences from core's example

- **`timeout`** is written as in core (`mod.timeout(seconds=5)`) but isn't
  enforced yet; core records it (core 005 K18).
- **`failure`** is a step here rather than a separate workflow. Its two
  failed rows are reported in the run log, not raised.
- **Not reproduced:** core's `validation()` and `roundtrip()` helpers. They
  exercise core's `Workflow` object, which the app does not hold yet (it runs
  one step at a time).
