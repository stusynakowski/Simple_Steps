# Design Notes: One Step, One Expression

## Goal

Every step's whole output, the entire grid, is produced by **one Python expression**. That expression is the step. It is what you read, edit, save, compare and re-run.

**Guiding principle:** *A step's data is induced by its expression.* Some cells could have been produced some other way, but there is always one abstraction that produces the whole output, and that abstraction is what the workflow keeps.

## 1. The Form

```text
tool[modifiers](input, arguments)
```

```python
with_tax[mod.map(name="total"), mod.retry(times=2)](wf["items"], rate=0.1)
#  tool    shape verb, then execution modifiers     input       arguments
```

| Part | Says | Example |
| --- | --- | --- |
| tool | **what** is computed | `with_tax`, `res["db"].lookup`, `identity` |
| shape verb | **how the tool meets the grid**: per row, as a filter, expanding, collapsing, … | `mod.map()`, `mod.filter()`, `mod.group(by="city")` |
| execution modifiers | **how it runs** | `mod.retry(times=2)`, `mod.timeout(…)`, `mod.try_except()` |
| input | **which earlier step** it reads | `wf["items"]`, or a selection `wf["items"][0:10]` |
| arguments | the **settings** | literals, or `res["name"]` |

The forms that look like exceptions are still single expressions. A source has no input, a bare literal (`=[3, 1, 2]`) is a one-cell source, and a combine (`join(wf["a"], wf["b"], on="city")`) is the one way to read several steps. None of them breaks the rule.

## 2. Why One Expression

| Property | What it gives |
| --- | --- |
| **One thing to read** | Click any cell and see the expression that made the whole column of results. There is no second place to look |
| **One thing to save** | A workflow file is a list of expressions (a recipe). It never needs to store how each cell was made |
| **Staleness is exact** | A step is out of date exactly when its expression, or an expression it reads, changed after it ran |
| **Reproducible** | Same expression + same inputs + same tool code = same output |
| **Equivalent in Python** | One expression is one statement, `k["step"] = …` ([UI ⇄ Python](ui_python_equivalence.md)) |
| **Checkable before running** | Core can check the expression against the catalog, and plan the output's shape, before anything runs |
| **Safe to author** | The expression grammar is closed, so an agent or a user can only compose what the catalog allows ([traceable agentic development](traceable_agentic_development.md)) |

## 3. The Expression Explains Every Cell

A cell is explained by **the step's expression + the input row it came from**. Nothing more is needed.

- The grid shows values; clicking a cell shows the formula and the cell's lineage (which input row, which columns, which arguments were bound).
- The expression is an abstraction over the **whole frame**, not a per-cell formula. Spreadsheets give every cell its own formula; Simple Steps gives every *step* one, and the shape verb says how it spreads over rows.
- The output is **always a DataFrame**. An empty or undefined step is a 1×1 frame with one cell, `"empty"`, never a placeholder.

## 4. What This Rules Out

| Not allowed | Why | What to do instead |
| --- | --- | --- |
| Hand-editing a computed cell in place | The output would no longer be what the expression produces, and staleness and reproducibility break | A new step: a literal, or a step that patches by row id |
| Two expressions making one step | There would be no single recipe to read, save or compare | Two steps, or a combine |
| A step whose output depends on UI state | The recipe would not reproduce it | Put the setting in the expression as an argument |
| Code typed into the formula bar (`len(…)`, `pd.read_csv`) | Evaluating it means running arbitrary Python | A catalog tool, so the computation is its own visible step |

## 5. Step by Example Still Ends in an Expression

A user can build a step by writing into a blank step's cells, by selecting, or by picking from the fx panel. Whichever way they work, **what is kept is the expression** that produces those cells:

```text
Write a cell / select / pick → the app writes the expression
                             → core checks and runs it
                             → the grid shows what it induced
```

If no expression in the grammar produces what the user showed, the answer is a missing tool or modifier, not a step that stores hand-entered cells as though they were computed.

## 6. Limits Worth Being Honest About

- **Non-deterministic tools** (an LLM, a random sample): the expression is still the abstraction, but "same expression, same output" also needs a seed or a recorded run (core's `run_id`).
- **Tool code changes**: the expression names a tool; it doesn't contain it. A changed tool should mark its steps stale (core asks K20).
- **Resources with changing data** (a live database): the expression is the same, but its input changed. A resource that reports a data version keeps staleness exact.

## Core Takeaway

1. **The expression is the step.** The grid is what it induces.
2. **One abstraction per output,** even when parts of it could be computed differently.
3. **Every way of building a step ends in an expression,** which is what makes steps readable, reproducible, comparable and safe.
