# Shaping and mapping parameters — the current surface

> Reference, not proposal. Every signature and every `meta` value below was
> read off `grid.py` at submodule `52092ba` by running it, not transcribed.
> Written to support the open decision in
> [001](001-index-selection.md) §A/§B: whether row and column restriction
> becomes new verbs or a parameter on `over`.

---

## 1. The verbs as they exist

```python
source  (value, fn=identity, **_params)
map     (source, fn, *, name="value", retries=0, axis="rows")
filter  (source, fn, *,                retries=0, axis="rows")
group   (source, fn, *, name="group",  retries=0, axis="rows")
expand  (source, fn, *, name="value",  retries=0, axis="rows")
collapse(source, fn, *, by=None, initial=None, name="value")
sweep   (fn,     *,     name="value",  retries=0, **params)
```

Plus two execution modifiers, which take no shape parameters at all:

```python
retry   (fn, *, times: int)
timeout (fn, *, seconds: float)
```

### What each parameter does

| param | on | meaning |
|---|---|---|
| `name` | `map` `group` `expand` `collapse` `sweep` | name of the **output** column the payload lands in |
| `over` | every shape verb | which step this one reads. **The only graph edge.** Not in the signatures above — it is consumed by the modifier layer, not the verb |
| `retries` | `map` `filter` `group` `expand` `sweep` | per-**unit** retry, distinct from the `retry` modifier, which wraps whatever it sits outside of |
| `axis` | `map` `filter` `group` `expand` | `"rows"` only today. §1.0 guards this: a column-wise verb needs a different ledger index space, so it "cannot be added as an `axis=` flag and nothing else" |
| `by` | `collapse` | group key — reduce to one row *per group* instead of one row total |
| `initial` | `collapse` | seed for the accumulator; the first parameter gets `None` without it |
| `**params` | `sweep` | each named sequence becomes a column; the run is their cross product |

Note `retries` and the `retry` modifier are **not** the same knob. `retries=2`
inside `map` retries each item; `[map, retry(times=2)]` retries the whole
fan-out. That is the pair `shape-algebra.md` §1.1 uses to argue for stacks.

---

## 2. What each verb does to shape

Observed by running a 3-row grid `{"n": [1,2,3]}` through each:

| verb | `rows_rule` | rows out | columns out | payload |
|---|---|---|---|---|
| `source` | — | as given | as given | — |
| `map` | `same` | 3 | `[n, value]` — **input kept, one added** | `value` |
| `filter` | `at_most` | ≤ 3 | `[n]` — unchanged | — |
| `group` | `same` | 3 | `[group, n]` — key added | `group` |
| `expand` | `unknown` | ≥ 0 | `[n, value]` | `value` |
| `collapse` | `one` | 1 | `[value]` — **input dropped** | `value` |
| `sweep` | `generated` | ∏ lengths | one per swept param + payload | `value` |

Two asymmetries worth holding on to:

- **`map` keeps input columns; `collapse` does not.** That is deliberate —
  `writing-tools.md` §3 calls the first "the whole difference between a
  spreadsheet and a list comprehension."
- **Nothing narrows columns.** Every verb either keeps them, adds one, or
  restructures. This is the gap 001 §B is about.

### The meta a verb emits

```python
{"verb": "map", "form": "column", "payload": "value",
 "staged": True, "n_in": 3, "expected": 3, "rows_rule": "same",
 "columns": ["n", "value"], "problems": ()}
```

`expected` is a function of `(rows_rule, n_in)`. That matters for §4 below:
anything that changes `n_in` costs nothing, anything that changes `rows_rule`
breaks a published contract.

---

## 3. What `/modifiers` publishes

`react-api.md` §2 serves one static entry per kind:

```json
{"map":    {"cls": "shape",     "rows": "same"},
 "filter": {"cls": "shape",     "rows": "at_most"},
 "expand": {"cls": "shape",     "rows": "unknown"},
 "retry":  {"cls": "execution", "rows": null}}
```

`cls` drives where the UI renders a modifier — `shape` as the iteration
control, `execution` as step settings. `rows` is what "lets the client predict
cardinality locally without a round trip" (§5).

**`rows` is per-kind, not per-instance.** Any design that makes a verb's rows
rule depend on its parameters invalidates this table.

---

## 4. The open decision: where row/column restriction goes

Two designs. They differ in one question — *is restricting the input a
property of the verb, or of the reference?*

### Option A — new verbs

```python
identity[mod.select(index=[0, 2, 4])]        # rows
identity[mod.project(columns=["city"])]      # columns
```

| | |
|---|---|
| **for** | Each is one verb with one rows rule; the `/modifiers` table stays static. A selection is its own addressable, re-drivable step with its own ledger row |
| **against** | Two new entries in a vocabulary that is deliberately small. "Map this tool over these rows" becomes three steps. `select`/`project` is relational-algebra-correct but **backwards from SQL**, where `SELECT` picks columns |

### Option B — restriction on `over`

```python
score[mod.map(over="raw", rows=[0, 2, 4], columns=["temp_c"])]
identity[mod.map(over="raw", rows=[0, 2, 4])]     # the same thing, standalone
```

| | |
|---|---|
| **for** | One mechanism, no new verbs. `over` already *is* the input specification. Changes `n_in`, not `rows_rule`, so §3's table survives untouched. Restriction happens before units exist, so the ledger keeps one meaning per row. The eight graph-derivation sites gain no new edge source |
| **against** | Renaming has no home — `columns=["temp_c"]` narrows but cannot rename, so `{"temp_c": "celsius"}` either becomes a second accepted form or renaming stays with `identity` + `map(name=)`. And `identity[map(over=…, rows=…)]` leaves a duplicate `value` column echoing the payload |

### What is *not* an argument against B

§11's "at most one shape verb per step" does not apply. It forbids two shape
verbs because the intermediate grid has no cell address. Input restriction is
not a shape change — it narrows what the verb sees, which is what `over`
already does and which nobody counts as a verb.

---

## 5. Decisions this is waiting on

1. **A or B**, or both (standalone verbs *and* restriction on `over`).
2. **Renaming.** Needed either way to feed a `temp_c` column into a `celsius`
   parameter in one step instead of a chain. Where does it live?
3. **Naming**, if A. `select`/`project` inverts SQL for most users;
   `take`/`pick` carries no baggage either way.
4. **`exact` as a new `rows_rule`** — a restricted `over` knows its own
   cardinality, which no existing rule expresses. `same` is wrong and
   `at_most` understates it.
5. **`axis="columns"`** stays out of scope. §1.0 already guards it: a
   column-wise *unit of work* needs a ledger in a different index space.
   Column *restriction* is structural and unrelated — worth keeping the two
   apart in any naming.

---

## 6. Adjacent, already filed

| | |
|---|---|
| [001 §F](001-index-selection.md) | A `StepRef` passed as a tool argument is silently stringified to the step id. A correctness bug; fix independently of all of the above |
| [001 §G](001-index-selection.md) | `align` / `join` — the first two-input verb. Independent of this decision, and likely removes the need for deferred cell references |
