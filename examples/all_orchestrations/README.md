# All orchestrations — core's example, as an app workflow

simple-steps-core's canonical example
([`examples/all_orchestrations/pipeline.py`](../../external/simple-steps-core/examples/all_orchestrations/pipeline.py))
rebuilt as a Simple Steps workflow: the same nine tools, the same tiny
dataset, and one step per step of core's workflow, each written as a formula.

| file | what it is |
|---|---|
| [`tools.py`](tools.py) | core's registry, declared with `@simple_step_tool` |
| [`projects/demo/all-orchestrations.simple-steps-workflow`](projects/demo/all-orchestrations.simple-steps-workflow) | the 38-step workflow |
| [`check.py`](check.py) | runs the workflow the way the UI does and compares every step with core |

```bash
python examples/all_orchestrations/check.py        # 38/38 steps match simple-steps-core
python examples/all_orchestrations/tools.py --workspace examples/all_orchestrations
                                                    # open the workflow in the UI and press Run
```

## How core's Python reads as formulas

Steps are named after core's step ids, so a formula refers to an earlier
step by name, just as core's `over=wf["readings"]` does.

| core | formula |
|---|---|
| `scale[mod.map(over=wf["readings"], name="score")]` | `=map(tool="scale", over=readings, name="score")` |
| `mod.sort(over=wf["scored"], by="score", ascending=False)` | `=sort(over=scored, by="score", ascending=False)` |
| `add_n[mod.collapse(by="bucket", over=wf["bucketed"], initial=0)]` | `=collapse(tool="add_n", over=bucketed, by="bucket", initial=0)` |
| `grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` | `=sweep(tool="grid_cell", model=["a", "b"], window=[7, 30])` |
| `scale(wf["readings"])` — verb inferred | `=scale(n=readings["n"])` |
| `wf["a_list"] = [1, 2, 3, 4]` | `=literal(expr="[1, 2, 3, 4]")` |

The verb is part of the formula, so the saved file is the whole workflow.

## Differences from core's example

- **`robust`** uses map's `retries=2` setting. Core's version stacks the
  `retry` and `timeout` modifiers; a formula has no spelling for `timeout`
  (core records it but does not enforce it yet).
- **`failure`** is a step here rather than a separate workflow. Its two
  failed rows are reported in the run log, not raised.
- **Not reproduced:** core's `validation()` and `roundtrip()` helpers. They
  exercise core's `Workflow` object, which the app does not hold yet (it runs
  one step at a time).
