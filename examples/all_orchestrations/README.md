# All orchestrations — core's example, as an app workflow

simple-steps-core's canonical example
([`examples/all_orchestrations/pipeline.py`](../../external/simple-steps-core/examples/all_orchestrations/pipeline.py))
rebuilt as a Simple Steps workflow: the same nine tools, the same tiny
dataset, and one step per step of core's workflow, each written as a formula.

| file | what it is |
|---|---|
| [`tools.py`](tools.py) | core's registry, declared with `@simple_step_tool` |
| [`projects/demo/all-orchestrations.simple-steps-workflow`](projects/demo/all-orchestrations.simple-steps-workflow) | the 44-step workflow |
| [`check.py`](check.py) | runs the workflow the way the UI does and compares every step with core |

```bash
python examples/all_orchestrations/check.py        # 44/44 steps match simple-steps-core
simple-steps --workspace examples/all_orchestrations
                                                    # open the workflow in the UI and press Run
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

## Differences from core's example

- **`timeout`** is written as in core (`mod.timeout(seconds=5)`) but isn't
  enforced yet; core records it (core 005 K18).
- **`failure`** is a step here rather than a separate workflow. Its two
  failed rows are reported in the run log, not raised.
- **Not reproduced:** core's `validation()` and `roundtrip()` helpers. They
  exercise core's `Workflow` object, which the app does not hold yet (it runs
  one step at a time).
