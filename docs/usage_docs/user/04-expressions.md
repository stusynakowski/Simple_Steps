# 04 — Expressions (the formula syntax)

Every step is one **expression**: the line in its formula bar. In the app you
start it with `=`. The Formula panel (**fx**) writes it for you, so you don't
need to know all of this to begin — see [03 — Define a step](03-define-a-step.md)
— but this page is the reference for reading and writing it by hand.

(For developers: it's simple-steps-core's operation syntax, and valid
Python — in a script it's the right-hand side of `wf["step"] = …`.)

## The shape

```
=with_tax[mod.map(name="total"), mod.retry(times=2)](wf["items"], rate=0.1)
 ───┬───  ──────────────┬────────────────────────── ────┬─────  ───┬────
   tool        modifiers: one verb, then             input     arguments
               optional execution modifiers
```

| part | what it is | rules |
|---|---|---|
| **tool** | a tool's name, or `identity` when no tool should run | must exist in the app |
| **`[ … ]`** | modifiers | at most one *shape verb*, plus any execution modifiers; omit the brackets to let the verb be inferred |
| **input** | `wf["step"]` | at most one; omitted for sources and sweeps |
| **arguments** | `name=value` | literals (`1`, `"a"`, `[1, 2]`, `{"k": "v"}`, `True`), or `res["name"]` |

Modifier settings (inside `mod.verb(...)`) are always literals.

## Referring to things

| write | means |
|---|---|
| `wf["items"]` | the output of the step named `items` — the **only** way to refer to a step |
| `"items"` | just the text `items` |
| `items` | an error |
| `res["db"]` | the resource named `db` |
| `res["db"].lookup` | a tool that lives on that resource |

## Shape verbs

| verb | example | effect |
|---|---|---|
| `source` | `=to_rows[mod.source()](data='{"n": [1, 2]}')` | builds a table from nothing |
| `map` | `=scale[mod.map(name="score")](wf["readings"])` | one new column, one value per row |
| `filter` | `=is_big[mod.filter()](wf["readings"])` | keeps rows where the tool returns true |
| `expand` | `=fan_out[mod.expand(name="item")](wf["readings"])` | each row becomes several |
| `collapse` | `=add_n[mod.collapse(initial=0)](wf["readings"])` | all rows reduce to one |
| `collapse` per group | `=add_n[mod.collapse(by="bucket", initial=0)](wf["bucket"])` | one row per group |
| `group` | `=label_city[mod.group(name="bucket")](wf["readings"])` | adds a group-key column |
| `table` | `=top_n[mod.table()](wf["people"], column="score", n=3)` | tool gets and returns the whole table |
| `sweep` | `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` | runs every combination; no input |
| `widen` | `=identity[mod.widen(columns=["x", "y"])](wf["records"])` | spreads records/tuples into columns |

`name=` names the new column (default `value`). It refuses to overwrite an
existing column unless you pass `replace=True`.

### Verbs that run no tool — use `identity`

```
=identity[mod.select(columns=["city", "score"])](wf["scored"])
=identity[mod.drop(columns=["score"])](wf["scored"])
=identity[mod.rename(columns={"n": "count"})](wf["scored"])
=identity[mod.sort(by="score", ascending=False)](wf["scored"])
=identity[mod.slice(stop=2)](wf["scored"])
=identity[mod.distinct(columns=["city"])](wf["scored"])
```

## Execution modifiers

Added after the verb, inside the same brackets:

```
=scale[mod.map(), mod.retry(times=2), mod.timeout(seconds=5)](wf["readings"])
=risky[mod.map(name="out"), mod.try_except(default=-1)](wf["readings"])
```

| modifier | effect |
|---|---|
| `mod.retry(times=N)` | retry a failing row up to N times (`times` is required) |
| `mod.timeout(seconds=S)` | declares a time limit — accepted and saved, but as of this writing a slow row is **not** cut off, so don't rely on it yet |
| `mod.try_except(default=X)` | a failing row gets X instead of stopping the run |

They wrap a verb; they can't stand alone (`[mod.retry(times=2)]` is refused).

## Shortcuts

| write | means |
|---|---|
| `=scale(wf["readings"])` | no brackets: the verb is inferred from the tool (`-> bool` filters, `(acc, x)` collapses, `-> list` expands, else map) |
| `=scale[mod.auto()](wf["readings"])` | infer the verb again on every run |
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
=with_tax[mod.map(name="total")](wf["items"], rate=0.1)   # rate: same for every row
=with_tax[mod.map(name="total")](wf["items"], price=1.0)  # warns: overrides the price column
```

If a tool's parameter has no matching column, rename the column first:

```
=identity[mod.rename(columns={"cost": "price"})](wf["raw"])
```

## Not allowed

The formula bar runs no code, so these are refused:

- two inputs to one step: `scale[mod.map()](wf["a"], wf["b"])` — use a combine
- part of a step: `wf["readings"][0:2]` — make the part its own step with `mod.slice`
- computed arguments: `name=str.upper("ada")` — write the literal `"ADA"`
- a step as a modifier setting: `mod.sort(by=wf["x"])` — settings are literals

More: [`examples/README.md`](../../../src/SIMPLE_STEPS/examples/README.md#the-formula-syntax-in-one-screen)
and the 44-step tour in
[`examples/basic/basic_pipeline.py`](../../../src/SIMPLE_STEPS/examples/basic/basic_pipeline.py).
