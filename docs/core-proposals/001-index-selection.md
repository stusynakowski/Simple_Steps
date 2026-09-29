# Proposal: selection verbs in the grid model

> **For `simple-steps-core`.** Written against submodule `52092ba`.
> Status: proposal, not agreed. Companion to
> `external/simple-steps-core/docs/shape-algebra.md`, whose vocabulary and
> invariants this follows.

## The ask

Select rows, columns or a single value from a step's output by clicking the
grid, and use the result downstream. When no tool has been chosen yet, the
selection itself is the operation — applied to `identity`.

## Summary

| | verdict |
|---|---|
| **A. `select` — rows by index** | Add it. A reshaping verb over `identity`; one `MODIFIERS` entry and one function, breaking no invariant |
| **B. `project` — columns by name** | Add it. **No verb narrows columns today** — verified against every verb in the table |
| **C. Subscript a `StepRef` (`wf["raw"][3]`)** | Don't. It breaks the re-drive argument §11 used to settle "at most one shape verb per step" |
| **D. Bind one cell as a tool argument** | Genuinely missing, genuinely different. Needs its own design |
| **E. What a selection *means*** | Decided by whether the step being edited already has a tool. Both branches are expressible today — see §E |
| **F. `StepRef` as a tool argument** | **A bug.** Silently stringified to the step id; validates clean, runs, returns garbage. Fix independently |
| **G. `align` / `join`** | Add. The way to use two steps at once, and it likely removes the need for D. First two-input verb, so the graph derivation changes |

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

## B. `project` — a column verb

Verified against `52092ba`: **no verb narrows columns.**

| verb | rows | columns |
|---|---|---|
| `source` | lifts a literal | — |
| `map` | unchanged | **adds one** |
| `filter` | fewer | unchanged |
| `group` | unchanged | adds a key |
| `expand` | more | unchanged |
| `collapse` | one | restructured |
| `sweep` | generated | generated |

So clicking a column header has no verb to compile to. `project` fills that
hole and is smaller than `select`: it never touches the index, so
`rows_rule` is `same` and every alignment invariant is untouched.

```python
wf["trimmed"] = identity[mod.project(columns=["city", "celsius"])](wf["raw"])
```

An unknown column is a declaration-time `problem`, in the same style as the
rest:

```
project column 'tmp', which 'raw' does not have (it has celsius, city)
```

One open question: should `project` preserve the *requested* column order or
the source order? Requested is more useful (it doubles as reordering) and more
surprising (a round-trip through `project` can silently reorder). Lean:
requested, because a user who named the columns in an order meant it.

---

## C. Why not subscript a `StepRef`

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

## D. The genuinely missing piece: a cell as a bound argument

This is the part `select` and `project` do **not** solve, and it is worth naming separately
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

## E. What a selection means: `identity` is the default tool

A click on a previous step's grid is ambiguous on its own. The step being
**edited** disambiguates it, with no mode switch and nothing for the user to
choose:

| the step being edited | a selection means | compiles to |
|---|---|---|
| **no tool chosen yet** | the selection *is* the operation | `identity[mod.select(...)]` / `identity[mod.project(...)]` |
| **a tool is chosen, a parameter focused** | feed this data to that parameter | a binding on the existing step |

That is the whole rule: **select before you pick a tool, and you get
`identity`.** It falls out of §6.3 rather than being bolted on — a step that
only reshapes has no tool of its own, so it applies its verb to `identity`.

### Why this is implementable today

The focused-input half already exists on the client. `StepWiringContext`
tracks `receivingStepId` and `inputRef` — which step is receiving and which of
its inputs has focus — so "which parameter does this bind to" is already
answered by whatever the user is typing in. The context does not disappear
under this design; its job changes from *injecting a text token* to *resolving
what a selection means*.

### The corner is not a verb

Clicking the corner selects the whole grid, which is what `over` already
means. It needs no verb and should produce a plain reference, not an
`identity` step that copies a grid to no purpose.

### The name-mismatch case already works

An earlier draft of this proposal claimed core had no way to feed a `temp_c`
column into a `celsius` parameter, and that a new parameter-to-column binding
was needed. **That was wrong.** `identity` already closes this, exactly as
§6.3 says it should:

```python
wf["aliased"] = op("identity", column="temp_c")[mod.map(name="celsius")](wf["readings"])
wf["f"]       = to_fahrenheit(wf["aliased"])        # binds, runs, -5 -> 23.0
```

`op("identity", column=…)` picks which upstream column is the payload;
`map(name=…)` lands it under the name the parameter wants. Verified against
`52092ba`. No new mechanism, no change to `Operation`.

So the rule holds for **both** branches, and a UI can always emit something
runnable:

| the click | with no tool | with a tool whose parameter wants another name |
|---|---|---|
| column | `identity[mod.project(...)]` | `op("identity", column=X)[mod.map(name=P)]` |
| row | `identity[mod.select(index=[…])]` | §D |
| cell | §D | §D |

### The real limitation is ergonomic, not structural

`map(name=…)` lands **one** column per step. A tool with three
differently-named parameters therefore needs three `identity` steps before it,
and each leaves the original column in place — `aliased` above carries `city`,
`temp_c` *and* `celsius`.

That is the strongest argument for `project` supporting renames:

```python
wf["ready"] = identity[mod.project(columns={"temp_c": "celsius", "t": "time"})](wf["raw"])
```

One step, several renames, originals dropped. It buys no new capability — only
a much shorter chain for the common case of wiring a multi-parameter tool.

### Still genuinely open

Only §D: a **row** or **cell** used as a bound argument is a deferred
reference to a value unknown until upstream runs. That one is not solved by
`identity`, because the value is not a column.

---

## F. Bug: a `StepRef` as a tool argument is silently stringified

Found while checking whether a manual selection can be *referenced* rather than
made into its own step. This is not a design question — it is a defect, and it
produces wrong answers rather than an error.

```python
wf["raw"]    = pd.DataFrame({"n": [1, 2, 3, 4, 5]})
wf["config"] = pd.DataFrame({"factor": [10]})
wf["scaled"] = scale(wf["raw"], factor=wf["config"])     # factor from another step
```

Declares **valid** — `status: staged`, `problems: ()`. Runs to **completed**.
Produces:

```
 n                          value
 1                         config
 2                   configconfig
 3             configconfigconfig
 4       configconfigconfigconfig
 5 configconfigconfigconfigconfig
```

`arguments` stored as `{"factor": "config"}` — the step's **id, as a string**.
`1 * "config"` is `"config"`, and pandas is happy to do it five times.

### Mechanism

`_deref` (grid.py:888) maps `StepRef -> value.id`, and is applied in four
places:

| call site | what the value means | correct? |
|---|---|---|
| `Modifier(kind, _deref(params))` (685, 1726) | `over="raw"` — a graph edge | ✓ an id is exactly right |
| `Operation(..., _deref(literals))` (738, 942) | a tool **argument** — a value | ✗ an id is almost never what the caller meant |

The same helper serves two opposite intents. For a modifier param the step id
*is* the payload; for a tool argument it is a stand-in for data the caller
wanted.

### Why it matters beyond this proposal

The corrupted value survives serialization: the light export carries
`{"factor": "config"}` as an ordinary string literal, so a reload cannot tell
it from a user who genuinely meant the word "config".

### Minimal fix

Reject rather than coerce. A `StepRef` reaching `arguments` should be a
declaration-time `problem`, in the house style:

```
scale() argument 'factor' is a reference to step 'config'; arguments take
literals. Wire it with over=, or bind a value.
```

That is a one-line guard and turns a silent wrong answer into the same
`200`-with-`problems` every other mistake produces. **It should land
independently of anything else in this document** — it is a correctness fix,
not a feature.

Supporting it *properly* is §D: a deferred reference that resolves after
upstream runs. The guard is what makes the gap visible until then.

---

## G. Combining two steps: `align` and `join`

§F says a second step cannot be referenced as an argument. The way out is not
a deferred reference — it is an explicit verb that **combines two steps into
one grid**, after which every existing binding rule works unchanged.

No such verb exists: there is no join, merge, align or zip in `grid.py`.

### The index makes this cheap

Verified against `52092ba`, branching preserves the index and `filter` subsets
the same address space rather than renumbering:

```
raw  index=[0, 1, 2, 3, 4]
a    index=[0, 1, 2, 3, 4]      double(raw)
b    index=[0, 1, 2, 3, 4]      label(raw)
c    index=[0, 2, 4]            filter(raw)
```

Because §1 makes the index "a row's stable address, preserved across steps",
two steps descended from a common ancestor are **already aligned**. Combining
them is a zip on an address both sides agree on — no key, no matching
heuristic, no chance of a silent mis-pairing.

### Two operations, not one

Conflating these is how a join silently returns the wrong rows, so they should
be separate verbs with separate names:

| | when | matches on | result index |
|---|---|---|---|
| **`align`** | both steps share an ancestor | the index itself | the shared index (or its intersection) |
| **`join`** | unrelated index spaces | a named key column | a **new** index space |

`align` is the one this proposal recommends building first. It covers the case
that actually arises — a user branches a workflow, does two things, and wants
them side by side — and it cannot mis-pair, because the index is an identity
rather than a value that happens to be equal.

`join` is the general case and deserves the caution: it produces a new index,
which breaks the "stable address preserved across steps" property that
`select`, the ledger's `unit` column and per-cell re-drive all depend on. Worth
building, worth building second, and worth documenting that downstream
addresses restart there.

```python
wf["side_by_side"] = identity[mod.align(over="a", with_="b")](...)
wf["enriched"]     = identity[mod.join(over="orders", with_="customers", on="customer_id")](...)
```

### This probably removes the need for §D

The motivating case for a deferred reference was "a scalar from step A
parameterises work over step B." `align` against a one-row step broadcasts it:

```python
wf["ready"]  = identity[mod.align(over="raw", with_="config", broadcast=True)](...)
wf["scaled"] = scale(wf["ready"])      # `factor` is now a column; binds by name
```

Once `factor` is a column, the ordinary name-binding rule applies and nothing
new is needed in `Operation` or the export format. That is a much smaller
change than a deferred-reference value type, and it keeps the rule that
**arguments are literals** intact rather than carving an exception into it.

### The structural cost: the first two-input verb

Every verb today reads exactly one upstream. The dependency graph is derived
from a single token, in eight places, all spelled `modifier.params.get("over")`.
A two-input verb is the first thing to break that assumption, and the cost
lands in three spots:

1. **Graph derivation** — either `over` becomes a list, or a second parameter
   is also recognised as an edge. Every one of those eight sites needs to agree.
2. **The client.** `react-api.md` §3 promises "the client can draw the DAG from
   the workflow payload alone, with no `/dag` call". That promise holds only if
   the client knows *every* source of an edge, so a second one has to be part
   of the documented contract, not an implementation detail.
3. **`GET /modifiers`.** The vocabulary entry needs to say a verb takes two
   inputs, so a stack editor can render two step-pickers instead of one.

None of that is hard. It is worth naming because it is the first place the
one-input assumption is load-bearing, and quietly adding a `with_` parameter
would leave the DAG wrong on the client while every server-side test passed.

### Ledger and staging

`align` and `join` apply to `identity` and invoke no user function, so like
`select` and `project` there is no per-row work and the ledger is trivially
complete. Cardinality:

| | `expected` | `rows_rule` |
|---|---|---|
| `align`, both upstreams run | size of the index intersection | `exact` |
| `align`, not yet run | `null` | `exact` |
| `join` | unknown before running | `unknown` |

### Validation

"Ensure the indices match" should be a declaration-time `problem` wherever both
upstreams have already run:

```
align over 'a' and 'c': indices differ (a has 0..4, c has 0, 2, 4).
Use how="inner" to keep the 3 shared rows.
```

That is the difference between this and a silent mis-join — the same lesson as
§F, applied before the bug exists rather than after.

---

## Sequence

1. `select` with `index` / `head` / `tail`, index-preserving, plus the `exact`
   `rows_rule` and the declaration-time range check.
2. `project` with `columns`, requested-order, with the unknown-column check.
   Independent of 1 and smaller.
3. Decide whether `exact` replaces `generated` for `sweep` too.
4. Decide the parameter↔column binding question in §E — it gates half the
   interaction model and is not a shape verb.
5. **F's guard first** — it is a correctness fix and depends on nothing here.
6. `align`, then `join` (§G) — `align` first; it is unambiguous and covers the real case.
7. Revisit D only if §G leaves something genuinely unexpressible. It touches `arguments`, staging and the
   graph derivation, and should not ride along with a shape verb.

## Relationship to per-cell re-drive

`react-api.md` §11 leaves open: *"`POST /steps/{id}/run` with a row selection is
the natural shape."* That is the same vocabulary as `select(index=[...])`, and
the two should share a spelling — one names rows to *keep*, the other names rows
to *re-run*. Deciding them together costs nothing now and avoids two different
ways to say "these rows" later.
