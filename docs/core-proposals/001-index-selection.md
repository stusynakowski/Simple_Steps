# Proposal: index selection in the grid model

> **For `simple-steps-core`.** Written against submodule `52092ba`.
> Status: proposal, not agreed. Companion to
> `external/simple-steps-core/docs/shape-algebra.md`, whose vocabulary and
> invariants this follows.

## The ask

Select a particular row of a step's output, or a set of rows, and use the
result downstream.

## Summary

It splits into three requests that deserve different answers:

| | verdict |
|---|---|
| **A. Select rows by index as a step** | Add it. A reshaping verb over `identity` — costs one `MODIFIERS` entry and one function, and breaks no invariant |
| **B. Subscript a `StepRef` (`wf["raw"][3]`)** | Don't. It breaks the re-drive argument that §11 used to settle "at most one shape verb per step" |
| **C. Bind one cell as a tool argument** | Genuinely missing, genuinely different. Needs its own design — §5 below |

---

## A. `select` — a shape verb

### Why it fits

`shape-algebra.md` §6.3 already names the slot:

> Steps that only *reshape* have no tool of their own, so they apply a verb to
> **`identity`** — and then need no special case anywhere.

Index selection is reshaping and nothing else. It needs no user function, so it
pairs with `identity` exactly as `source` and `expand` already do.

Every invariant survives:

| invariant | holds? |
|---|---|
| At most one shape verb per step (§11, settled) | ✓ `select` is one verb; composing it with `map` means two steps, which is the point |
| Every intermediate is addressable and re-drivable | ✓ the selection is its own step with its own index |
| Staged shape is computable before running | ✓ see `rows_rule` below |
| One ledger entry per unit of work | ✓ one per selected row, `unit` naming the source index |
| The DAG derives from `over` tokens | ✓ unchanged |
| Nothing named `auto` reaches stored data | ✓ `select` is concrete |

### Shape

```python
wf["sample"]  = identity[mod.select(index=[0, 3, 7])](wf["raw"])
wf["one"]     = identity[mod.select(index=3)](wf["raw"])
wf["first10"] = identity[mod.select(head=10)](wf["raw"])
wf["failed"]  = identity[mod.select(where="status", equals="failed")](wf["scored"])
```

The last form is deliberately *not* proposed for v1 — it is `filter`'s job, and
listing it here only to mark the boundary. **`select` addresses by position;
`filter` addresses by predicate.** Keeping them apart is what stops `select`
growing into a second query language.

### `rows_rule`

`react-api.md` §5 requires a staged claim the client can render verbatim, and
this verb can make an unusually strong one:

| upstream state | `expected` | `rows_rule` | rendered |
|---|---|---|---|
| has run, all indices exist | `len(index)` | `exact` *(new)* | "3 cells" |
| has run, some index out of range | — | — | **a declaration-time `problem`** |
| has not run | `null` | `exact` | "3 cells" — known from the request, not the data |

That third row is worth noting: `select` is the only verb whose cardinality is
known from its *own parameters*, independent of upstream. `sweep` is the other
(its `rows_rule` is already `generated`), which suggests `exact` may be the more
honest name for both.

`exact` is a new `rows_rule` value. If adding one is unwelcome, `same` is wrong
and `at_most` understates it — the count is known exactly, and understating it
would violate §5's "staged claims are honest" rule in the other direction.

### Declaration-time validation

Out-of-range indices should be a `problem`, not a run-time error, whenever the
upstream has already run:

```
select index 12, which 'raw' does not have (it has 0..4)
```

This matches the existing message style in `writing-tools.md` §8 and keeps the
step `invalid` rather than `failed` — a `200` carrying `problems`, rendered
inline while the user is still typing.

### Implementation sketch

```python
def select_(source, fn=identity, *, index=None, head=None, tail=None) -> Output:
    """``select`` — keep rows by position. Columns unchanged."""
    frame = rows(source)
    if head is not None:
        picked = frame.index[:head]
    elif tail is not None:
        picked = frame.index[-tail:]
    else:
        picked = [index] if isinstance(index, int) else list(index)
    data = frame.loc[picked]
    records = [{"status": "completed", "unit": i} for i in picked]
    return Output(data=data, ledger=_ledger(records, data.index),
                  meta={"verb": "select", "form": "grid",
                        "n_in": len(frame), "rows_rule": "exact"})
```

Registered beside the others:

```python
_kind("select", "shape", _lift(select_)),
```

`_Mods.__getattr__` already tells an author this is the extension point
(*"Modifier kinds are declared in MODIFIERS; add one there"*), so nothing else
changes — `mod.select(...)` and `GET /modifiers` both pick it up for free.

### Index preservation

`shape-algebra.md` §1 defines the index as "a row's stable address, preserved
across steps." `select` must **keep the source index** rather than resetting to
`0..n-1`, so that `select(index=[3, 7])` produces rows still addressed `3` and
`7`. Otherwise selecting twice addresses different rows each time, and the
ledger's `unit` column stops linking back.

`filter` already behaves this way — filtering `[1,2,3,4,5]` to the odd values
yields index `[0, 2, 4]`, verified against `52092ba`. So this is consistency
with an existing verb, not a new demand. It is still the one place an
implementation could quietly get it wrong, and worth a test.

---

## B. Why not subscript a `StepRef`

`wf["raw"][3]` is the tempting spelling. Today `StepRef` carries only `id` and
`workflow` and is not subscriptable, and I think that should stay true.

- **It has no cell address.** §11 settles "at most one shape verb per step"
  because two shape changes in one step produce an intermediate that cannot be
  inspected or re-run. A subscript inside an argument is exactly that
  intermediate, with the same problem and less visibility.
- **It has no ledger entry.** A selection that happened invisibly cannot be
  shown, counted, or re-driven. Every other transformation in this model is
  visible as a step.
- **It is a second addressing mechanism.** Columns bind to parameters *by name*
  (`writing-tools.md` §1: "The column name is the contract"). Adding positional
  subscripting alongside means two ways to say where data comes from, which is
  the ambiguity the parameter-binding rule exists to avoid.
- **It does not survive the light export.** A step is the unit that serializes.
  A subscript buried in an argument either round-trips as an opaque string or
  needs its own grammar in the export format.

The `select` verb gives the same capability, one step later, with an address, a
ledger row and a line in the export.

---

## C. The genuinely missing piece: a cell as a bound argument

This is the part `select` does **not** solve, and it is worth naming separately
rather than folding into the same proposal.

Core binds literals today:

```python
wf["scaled"] = scaled(wf["readings"], factor=2.0)     # a constant
```

There is no way to say *"bind `factor` to whatever is in `wf["config"]` row 0,
column `rate`"* — a value known only after an upstream step runs. Common cases:

- a threshold computed by an earlier `collapse`
- an API key or model name from a config step
- a row count used to size a later request

`collapse` plus `.item()` gets you a one-row grid in Python, but there is no
*declarative* form that survives serialization, because a bound argument is
stored as a literal in `Operation.arguments` and a literal is by definition
already resolved.

What this needs — deliberately left open:

1. **A deferred-reference value type** that can live in `arguments` and resolve
   at run time. Something like `{"$ref": "config", "index": 0, "column": "rate"}`,
   which keeps `Operation` JSON-native.
2. **A staging story.** Its value is unknown until upstream runs, but its
   *presence* is known at declaration — so a step bound this way is valid but
   its cardinality may not be.
3. **A graph edge.** The reference makes the step depend on `config`, so it has
   to participate in the same derivation as `over`, or the DAG will be wrong.

That third point is the one that makes this more than a convenience: `over` is
currently the *only* source of graph edges (`react-api.md` §3). A bound cell
reference would be a second, and the "no `/dag` endpoint, the client derives it"
decision depends on the client knowing every edge source.

---

## Sequence

1. `select` with `index` / `head` / `tail`, index-preserving, plus the `exact`
   `rows_rule` and the declaration-time range check.
2. Decide whether `exact` replaces `generated` for `sweep` too.
3. Treat C as a separate design note. It touches `arguments`, staging and the
   graph derivation, and should not ride along with a shape verb.

## Relationship to per-cell re-drive

`react-api.md` §11 leaves open: *"`POST /steps/{id}/run` with a row selection is
the natural shape."* That is the same vocabulary as `select(index=[...])`, and
the two should share a spelling — one names rows to *keep*, the other names rows
to *re-run*. Deciding them together costs nothing now and avoids two different
ways to say "these rows" later.
