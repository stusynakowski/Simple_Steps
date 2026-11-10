# 04 — Expressions (the formula syntax)

Every step is one **expression**: the line in its formula bar. In the app you
start it with `=`. The Formula panel (**fx**) writes it for you, so you don't
need to know all of this to begin — see [03 — Define a step](03-define-a-step.md)
— but this page is the reference for reading and writing it by hand.

(For developers: it's simple-steps-core's operation syntax, and valid
Python — in a script it's the right-hand side of `wf["step"] = …`.)

## The shape

```
=with_tax[mod.map(), mod.name("total"), mod.retry(times=2)](wf["items"], rate=0.1)
 ───┬───  ────────────────────┬───────────────────────── ────┬─────  ───┬────
   tool    modifiers: one verb, its name, then            input     arguments
           optional execution modifiers
```

| part | what it is | rules |
|---|---|---|
| **tool** | a tool's name, or `identity` when no tool should run | must exist in the app |
| **`[ … ]`** | modifiers | at most one *shape verb*, `mod.name(…)`, plus any execution modifiers; omit the brackets to let the verb be inferred |
| **input** | `wf["step"]`, or part of one (`wf["step"][0:2]`) | at most one; omitted for sources and sweeps |
| **arguments** | `name=value` | literals (`1`, `"a"`, `[1, 2]`, `{"k": "v"}`, `True`), `res["name"]`, or `wf["step"]` (that step's whole table) |

Modifier settings (inside `mod.verb(...)`) are always literals.

## Referring to things

| write | means |
|---|---|
| `wf["items"]` | the output of the step named `items` — the **only** way to refer to a step |
| `wf["items"][0:2]` | its first two rows |
| `wf["items"][cols["n"] > 1]` | its rows where `n` is over 1 |
| `"items"` | just the text `items` |
| `items` | an error |
| `res["db"]` | the resource named `db` |
| `res["db"].lookup` | a tool that lives on that resource |

## Shape verbs

| verb | example | effect |
|---|---|---|
| `source` | `=to_rows[mod.source()](data='{"n": [1, 2]}')` | builds a table from nothing |
| `map` | `=scale[mod.map(), mod.name("score")](wf["readings"])` | one value per row; the step holds just that column |
| `filter` | `=is_big[mod.filter()](wf["readings"])` | keeps rows where the tool returns true |
| `expand` | `=fan_out[mod.expand(), mod.name("item")](wf["readings"])` | each row becomes several |
| `collapse` | `=add_n[mod.collapse(initial=0)](wf["readings"])` | all rows reduce to one |
| `collapse` per group | `=add_n[mod.collapse(by="bucket", initial=0)](wf["bucket"])` | one row per group |
| `group` | `=label_city[mod.group(), mod.name("bucket")](wf["readings"])` | keeps the rows, adds a group-key column |
| `table` | `=top_n[mod.table()](wf["people"], column="score", n=3)` | tool gets and returns the whole table |
| `sweep` | `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` | runs every combination; no input |
| `widen` | `=identity[mod.widen(columns=["x", "y"])](wf["records"])` | spreads records/tuples into columns |

`mod.name("score")`, after the verb, names the output column; without it the
column takes the step's name. (`mod.map(name=…)` is the retired spelling and
is refused.) A `map` step holds only its answers: to see them beside the
table they came from, add a step `=zip_(wf["readings"], wf["score"])`.

### Verbs that run no tool — use `identity`

```
=identity[mod.select(columns=["city", "score"])](wf["scored"])
=identity[mod.drop(columns=["score"])](wf["scored"])
=identity[mod.rename(columns={"n": "count"})](wf["scored"])
=identity[mod.sort(by="score", ascending=False)](wf["scored"])
=identity[mod.slice(stop=2)](wf["scored"])
=identity[mod.distinct(columns=["city"])](wf["scored"])
```

The tool can also be left off: `=mod.sort(by="score")(wf["scored"])` is the
same step.

## Execution modifiers

Added after the verb, inside the same brackets:

```
=scale[mod.map(), mod.retry(times=2), mod.timeout(seconds=5)](wf["readings"])
=risky[mod.map(), mod.name("out"), mod.try_except(default=-1)](wf["readings"])
```

| modifier | effect |
|---|---|
| `mod.retry(times=N)` | retry a failing row up to N times (`times` is required) |
| `mod.timeout(seconds=S)` | a row that takes longer than S seconds fails (*TimedOut*); add `try_except` to give it a value instead |
| `mod.try_except(default=X)` | a failing row gets X instead of stopping the run |

With no shape verb beside them (`[mod.retry(times=2)]`), the verb is
inferred, as with no brackets.

## Shortcuts

| write | means |
|---|---|
| `=scale(wf["readings"])` | no brackets: the verb is inferred from the tool (a `DataFrame` first input → `table`, `(acc, x)` → `collapse`, `-> list` → `expand`, else `map`). A `-> bool` tool maps to a True/False column; write `mod.filter()` to keep rows |
| `=scale[mod.auto()](wf["readings"])` | the same: infer the verb |
| `=[1, 2, 3]`, `={"x": 1}`, `=7` | a plain value is a one-cell source; reshape it with `expand` or `widen` |

## Built-in reducers

For `collapse`, no tool of your own needed:

```
=count[mod.collapse()](wf["readings"])
=total[mod.collapse()](wf["ns"])
=gather[mod.collapse()](wf["ns"])      # all values in one list
=first[mod.collapse()](wf["ns"])
=last[mod.collapse()](wf["ns"])
```

## Combining steps

A normal step reads one input. To read several, use a combine:

```
=join(wf["readings"], wf["city_info"], on="city", how="left")
=stack(wf["readings"], wf["more"])         # rows of one, then the other
=zip_(wf["ns"], wf["scores_only"])         # side by side, row for row
```

## Arguments and columns

A per-row tool's parameters are filled from columns of the same name. An
argument you write in the formula is used for **every** row — so writing
an argument with a column's name hides that column (you'll get a warning):

```
=with_tax[mod.map(), mod.name("total")](wf["items"], rate=0.1)   # rate: same for every row
=with_tax[mod.map(), mod.name("total")](wf["items"], price=1.0)  # warns: overrides the price column
```

If a tool's parameter has no matching column, rename the column first:

```
=identity[mod.rename(columns={"cost": "price"})](wf["raw"])
```

## Not allowed

The formula bar runs no code, so these are refused:

- computed arguments: `name=str.upper("ada")` — write the literal `"ADA"`,
  or compute it in its own step and pass `wf["…"]`
- a step as a modifier setting: `mod.sort(by=wf["x"])` — settings are literals

And one to avoid: a second step written without a name,
`scale[mod.map()](wf["a"], wf["b"])`, is passed whole to the tool's next
input. To line up two steps' rows, use a combine.

More: [`examples/README.md`](../../../src/SIMPLE_STEPS/examples/README.md#the-formula-syntax-in-one-screen)
and the tour of every verb in
[`examples/basic/basic_pipeline.py`](../../../src/SIMPLE_STEPS/examples/basic/basic_pipeline.py).
