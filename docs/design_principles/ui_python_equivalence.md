# Design Notes: One Workflow, Two Notations (UI ⇄ Python)

## Goal

Simple Steps bridges **developers**, who write Python, and **domain experts**, who build linear workflows in the UI. Both are writing the same thing.

**Guiding principle:** *Anything built in the UI can be written in Python with the framework, and a workflow written in Python contains exactly the same conceptual work, with the same structure.* The UI and a Python script are two notations for one object, never two systems that happen to agree.

## 1. Why This Matters

| Who | What equivalence gives them |
| --- | --- |
| Domain expert | Their workflow can be handed to a developer as code, reviewed, versioned and run in a pipeline, with nothing lost |
| Developer | A script they write opens in the UI as columns a domain expert can read, check and extend |
| Reviewer / auditor | One artifact to reason about. No hidden UI-only behaviour, no script-only behaviour |
| Agent | One grammar to write, whether it is helping in the UI or generating a script |

If the two notations drift apart, the bridge breaks. Developers stop trusting what the UI builds, and domain experts stop trusting what developers hand them.

## 2. The Correspondence

Every block in the UI has one line, or one name, in Python, and every such line has one block.

| UI block | Python | Shared key |
| --- | --- | --- |
| Workflow tab | a `Kernel` (and its saved file) | workflow name |
| Palette / Environment panel | the `Catalog`: imported tools and resource types | tool name |
| Resource column | `k.define("db", ClinicalDB, url=…)` | resource name, `res["db"]` |
| Step column | `k["totals"] = …`, one statement | step name, `wf["totals"]` |
| Formula bar | the right-hand side of that statement | — |
| Formula panel (fx) | the same expression, edited as parts (tool, modifiers, arguments) | — |
| Column order | statement order | position |
| A selection of rows, columns or a cell | `wf["s"][0:2]`, `wf["s"][cols["n"]]`, `wf["s"][0][cols["n"]]` | step name + row id |
| ▶ Run / Run all | `k.run("totals")` / `k.run_all()` | — |
| Clicking a cell | `k.cell("totals", row, "col")` | step, row id, column |

The **shared keys** are what make cross-referencing possible. A step's name is its identity in both notations, so "the `totals` step" means one UI column and one Python statement. A tool's name is the same in the palette and in the import.

### Example

The UI's three columns, `orders → with_tax → by_city`, are this script, line for line:

```python
k = Kernel(Catalog(tools=[load_orders, with_tax, total]))

k["orders"]   = load_orders[mod.source()](path="orders.csv")
k["with_tax"] = with_tax[mod.map()](wf["orders"], rate=0.1)
k["by_city"]  = total[mod.group(by="city")](wf["with_tax"])

k.run_all()
```

Each formula bar shows exactly the text to the right of the `=`.

## 3. Rules That Keep the Notations Equivalent

### A. One model underneath

The UI and Python both drive core's `Kernel`. The UI never has its own engine, its own step semantics or its own idea of a result. Whatever the app computes about a workflow, core must also be able to say ([core/app separation](../system_design/effective_core_app_separation_concepts.md)).

### B. Lossless round trips

- UI → saved workflow → Python → UI gives back the same columns, names, formulas and resources.
- Core prints every step's expression in its canonical form (`to_source()`) and reads it back (`formula()`), so text and operation always agree.

### C. Every UI action writes a line

A click, a selection, a drag or a choice in the fx panel must end as a change to some step's expression, a resource's definition or the step order. If an action has no Python equivalent, it is either:

- **presentation** (column width, a collapsed panel, a colour), which is kept in the spec's `extras` and never changes a result; or
- **a gap**, which is fixed by giving it a Python form, not by keeping it UI-only.

### D. Same names, same order

Step names are valid Python identifiers and are stable keys. Column order is statement order, and a step reads only earlier steps in both notations.

### E. No hidden state

What a step produces depends only on its expression, the steps and resources it reads, and the tool code in the catalog. Nothing in the UI session (view settings, scroll position, chat history) can change an output.

## 4. The One Asymmetry: Computed Arguments

Python evaluates an argument before core ever sees it, so `rate=len("abc")` reaches core as `rate=3`. The UI's formula bar **never executes Python**, so it only accepts literals, references and catalog names.

| Direction | Equivalence |
| --- | --- |
| UI → Python | **Always exact.** Every UI workflow is a valid script |
| Python → UI | **Exact for scripts written in the formula grammar.** A script that computes arguments still produces the same *recipe* (core stores the evaluated literal), but the computation itself isn't visible as a step |

**Design rule:** if a computation is worth doing, make it a catalog tool, so its result is a step that both notations can see. A script meant to be shared with domain experts stays within the grammar.

## 5. Cross-Referencing Between UI and Code

Because the keys are shared, the two can point at each other:

- **UI → code:** export a workflow as a `.py` file where each step is one statement, in column order, under its step name. Every column, resource and selection maps to a line.
- **Code → UI:** open a script's kernel in the UI. Each statement becomes a column under the same name.
- **Jump between them:** from a column, go to its line, and from a line, go to its column. The step name is the anchor, so this survives edits to other steps.
- **Diffs:** a change in the UI is a change to one line of the script, so workflow history reads like a code diff.

## 6. How Equivalence Is Tested

Each shipped example has a **Python twin**: the saved workflow is run the way the UI runs it **and** as plain Python against core (`example_check.py`). The two must agree step for step on names, formulas, outputs and states. A disagreement is a bug in whichever notation drifted, never something to document as a difference.

## Core Takeaway

1. **One model, two notations.** The UI is a way of writing a kernel, not a separate system.
2. **Shared keys.** Step, resource and tool names are the same in both, so blocks and lines refer to each other.
3. **Nothing UI-only that changes a result.** Either it has a Python form, or it is presentation.
