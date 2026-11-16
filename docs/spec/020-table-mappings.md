# 020 — Table mappings: how each step turns tables into a table

**Status:** draft for the owner's review (2026-11-16). Dev plan
[136](../dev_plan/136-consolidation-plan.md) Track A, phase P0, with
[019](./019-table-model.md) (what one table is, and the rules T1–T8). Every diagram below is a real
run of core 1.0.2 (`dbaf4c7`), reproduced by
[`scripts/core_probes/probe_grid_mappings.py`](../../scripts/core_probes/probe_grid_mappings.py).

**Purpose:** for every verb, exactly how its output table comes from its
input table(s): which rows (samples), which columns (variables), where each
row came from, which input cells made each cell, and what a failure does.
One diagram and one set of rules per verb. Rows are samples and columns
variables (019 T3); these are the ways to restructure what a sample and a
variable are.

---

## 1. The mapping model

A step is one expression. Its **shape verb** decides how the input grid
becomes the output grid; its **tool** (if any) computes values.

```text
   input grid(s)  ──  shape verb  ──▶  output grid
   wf["r"]            map, filter, …     one table, three regions:
                      + tool             lineage | # | data      (019 §2.3)
```

Every mapping is described by the same five rules:

| Rule | Answers | Written as |
|---|---|---|
| **Rows** | how many output rows per input row | `1 → 1`, `1 → 0..1`, `1 → n`, `n → 1`, `all → any`, `none → n`, `k grids → 1` |
| **Columns** | what happens to the input's columns | kept · added · replaced · removed |
| **Lineage** | what the `#<input>` entry holds | none (same position) · one position · a list · `i` + item `j` |
| **Provenance** | which input cells made a cell | one row's bound cells · a group's · the whole grid · none |
| **Failure** | what a row that fails does | the cell is `failed`; later steps' cells from it are `blocked` |

**REQ-MAP-001** Every output row's lineage points only at rows of the
step's own inputs, never further back. Following lineage step by step
traces any row to its sources.

**REQ-MAP-002** A mapping that keeps every row in order (`1 → 1`) records
no lineage: output row `i` is input row `i`. Every other mapping records
one `#<input>` entry per input.

---

## 2. The fixture

Every diagram starts from this source step, `r`:

```text
r = readings[mod.source()]()

 #  │ city    temp_c  tags
────┼──────────────────────────────
 0  │ Oslo     4.0    [cold]
 1  │ Rome    18.5    [warm, sun]
 2  │ Oslo     6.0    [cold, wind]
 3  │ Cairo   31.2    [hot]
```

Tools: `to_f(temp_c)` (°C → °F), `is_warm(temp_c) -> bool`,
`band(temp_c) -> "warm" | "cold"`, `each_tag(tags) -> list`,
`mean_temp(temp_c: list)`, `summary(df) -> DataFrame`.

---

## 3. The families

```text
                         ┌─ map      1 → 1    compute a value per row
          per row ───────┼─ filter   1 → 0..1 keep the rows a test passes
          (a tool)       ├─ group    1 → 1    label each row with a key
                         └─ expand   1 → n    one row per item of a list

                         ┌─ collapse n → 1    one row per key (or one in all)
          reduce ────────┼─ distinct n → 1    one row per distinct key
                         └─ table    all → any  the whole grid in, a grid out

          generate ──────┬─ source   none → n the first step: a grid from nothing
                         └─ sweep    none → n one row per combination of settings

                         ┌─ select / drop / rename / copy   columns only
          reshape ───────┼─ pack / widen                    columns ⇄ one dict column
          (no tool)      └─ sort / slice                    rows only

          combine ───────┬─ join     match rows of two grids on a key
          (2+ grids)     ├─ stack    rows of one grid, then another's
                         └─ zip      row i of each, side by side
```

---

## 4. Per row, with a tool

### map — compute a value per row · `1 → 1`

```text
to_f[mod.map()](wf["r"])

 r                                  map
 #  │ city    temp_c  tags           #  │ map
────┼───────────────────────  ──▶  ────┼──────
 0  │ Oslo     4.0   …               0  │ 39.2
 1  │ Rome    18.5   …               1  │ 65.3
 2  │ Oslo     6.0   …               2  │ 42.8
 3  │ Cairo   31.2   …               3  │ 88.2
```

| Rule | |
|---|---|
| Rows | `1 → 1`, in order |
| Columns | **only the tool's result**, named after the step; the input's columns are not carried |
| Lineage | none (row `i` is input row `i`) |
| Provenance | row `i`'s bound cells: `map[0]` ← `r[0].temp_c` |
| Failure | that row's cell `failed`; the others run |

A tool that returns a **dict** gives one column per key
(`info(city) -> {"len", "upper"}` → columns `len`, `upper`).

### filter — keep the rows a test passes · `1 → 0..1`

```text
is_warm[mod.filter()](wf["r"])

 r                                  filter
 #  │ city    temp_c                 #r │ #  │ city    temp_c  tags
────┼────────────────   ──▶        ────┼────┼──────────────────────
 0  │ Oslo     4.0    ✗              1 │ 0  │ Rome    18.5   …
 1  │ Rome    18.5    ✓              3 │ 1  │ Cairo   31.2   …
 2  │ Oslo     6.0    ✗
 3  │ Cairo   31.2    ✓
```

| Rule | |
|---|---|
| Rows | `1 → 0 or 1` |
| Columns | **all kept**; the test's result is not a column |
| Lineage | `#r`: one position per row (`1`, `3`) |
| Provenance | the kept row's own cells; the test read `r[1].temp_c` |

### group — label each row with a key · `1 → 1`

```text
band[mod.group()](wf["r"])

 #  │ city    temp_c  tags        │ group
────┼─────────────────────────────┼──────
 0  │ Oslo     4.0    [cold]      │ cold
 1  │ Rome    18.5    [warm, sun] │ warm
 2  │ Oslo     6.0    [cold, wind]│ cold
 3  │ Cairo   31.2    [hot]       │ warm
```

| Rule | |
|---|---|
| Rows | `1 → 1`, in order |
| Columns | **all kept, plus the key**, in a column named `group` (not after the step; `mod.name("…")` renames it). With `replace=True` and `mod.name("city")`, the key takes the place of `city` |
| Lineage | none |
| Provenance | the key ← that row's bound cells |

Grouping is two steps: **group** labels, **collapse(by=…)** reduces.

### expand — one row per item of a list · `1 → n`

```text
each_tag[mod.expand()](wf["r"])

 r                                   expand
 #  │ tags                          #r  item │ #  │ expand
────┼──────────────   ──▶          ─────────┼────┼───────
 0  │ [cold]                        0    0   │ 0  │ cold
 1  │ [warm, sun]                   1    0   │ 1  │ warm
 2  │ [cold, wind]                  1    1   │ 2  │ sun
 3  │ [hot]                         2    0   │ 3  │ cold
                                    2    1   │ 4  │ wind
                                    3    0   │ 5  │ hot
```

| Rule | |
|---|---|
| Rows | `1 → n` (n = the list's length; an empty list gives no rows) |
| Columns | **only the items**, named after the step |
| Lineage | `#r` = the parent row, `#r.idx` = the item's place in its list |
| Provenance | ← the parent's list cell: `expand[2]` ← `r[1].tags` |

---

## 5. Reduce

### collapse — one row per key · `n → 1`

```text
mean_temp[mod.collapse(by="city")](wf["r"])

 r                                  collapse
 #  │ city    temp_c                 #r     │ #  │ city    collapse
────┼────────────────   ──▶        ────────┼────┼─────────────────
 0  │ Oslo     4.0  ┐               [0, 2] │ 0  │ Oslo     5.0
 2  │ Oslo     6.0  ┘               [1]    │ 1  │ Rome    18.5
 1  │ Rome    18.5                  [3]    │ 2  │ Cairo   31.2
 3  │ Cairo   31.2
```

| Rule | |
|---|---|
| Rows | `n → 1` per key, in first-seen order; without `by`, `all → 1` |
| Columns | **the key, plus the result**; others removed |
| Lineage | `#r`: the **list** of member positions |
| Provenance | ← the group's bound column (`temp_c` of rows 0 and 2) |

The tool receives the group's column as a list (`temp_c: list`).

### distinct — one row per distinct key · `n → 1`

```text
identity[mod.distinct(columns=["city"])](wf["r"])

 #r     │ #  │ city    temp_c  tags
────────┼────┼─────────────────────
 [0, 2] │ 0  │ Oslo     4.0   [cold]       ← the first Oslo row's values
 [1]    │ 1  │ Rome    18.5   …
 [3]    │ 2  │ Cairo   31.2   …
```

| Rule | |
|---|---|
| Rows | `n → 1` per distinct key; **the first row's values** are kept |
| Columns | all kept |
| Lineage | `#r`: the list of rows it stands for |

### table — the whole grid in, a grid out · `all → any`

```text
summary[mod.table()](wf["r"])

 r (all 4 rows)   ──▶   #  │ rows  mean_c
                       ────┼─────────────
                        0  │ 4     14.92
```

| Rule | |
|---|---|
| Rows | `all → any`: the tool decides |
| Columns | the tool decides |
| Lineage | **none**: core can't know which input rows made which output row |
| Provenance | ← the whole input grid |

Use it when the work needs the whole table at once; prefer a per-row or
reduce verb when one fits, since those keep lineage.

---

## 6. Generate

### source — the first step · `none → n`

A tool that reads no step: its result (a table, a list, a value) is the
grid. No lineage, no provenance. A literal (`=7`, `=[1, 2]`) is a one-cell
source.

### sweep — one row per combination · `none → n`

```text
to_f[mod.sweep(temp_c=[0.0, 100.0])]()

 #  │ temp_c   sweep
────┼────────────────
 0  │   0.0    32.0
 1  │ 100.0   212.0
```

| Rule | |
|---|---|
| Rows | one per combination of the swept settings |
| Columns | **one per swept setting, plus the result** |
| Lineage / provenance | none: it reads no step |

---

## 7. Reshape, no tool

These apply no tool (`identity`); they only move cells.

| Verb | Rows | Columns | Lineage | Example (run) |
|---|---|---|---|---|
| **select** | `1 → 1` | keep the named | none | `select(columns=["city"])` → `city` |
| **drop** | `1 → 1` | remove the named | none | `drop(columns=["tags"])` → `city, temp_c` |
| **rename** | `1 → 1` | rename | none | `rename(columns={"temp_c": "t"})` → `city, t, tags` |
| **copy** | `1 → 1` | add a copy (the original stays); the one way lineage becomes data | none | `copy(columns={"city": "city2"})` → `+ city2` |
| **pack** | `1 → 1` | the named columns into one dict column | none | `pack(columns=["city","temp_c"]), name("rec")` → `tags, rec` |
| **widen** | `1 → 1` | a dict column into one column per key | none | `widen(column="rec")` → `tags, city, temp_c` |
| **sort** | `n → n`, reordered | all kept | `#r`: the position it came from | by `temp_c`: `#r` `0, 2, 1, 3` |
| **slice** | `n → k` | all kept | `#r`: one position | `slice(1, 3)`: `#r` `1, 2` |

```text
sort by temp_c                         slice(start=1, stop=3)
 #r │ #  │ city    temp_c              #r │ #  │ city    temp_c
────┼────┼─────────────────           ────┼────┼──────────────
 0  │ 0  │ Oslo     4.0                1 │ 0  │ Rome    18.5
 2  │ 1  │ Oslo     6.0                2 │ 1  │ Oslo     6.0
 1  │ 2  │ Rome    18.5
 3  │ 3  │ Cairo   31.2
```

**REQ-MAP-003** After any verb, `#` is `0..n-1` again (019 REQ-GRID-004);
the old position is in lineage.

---

## 8. Combine: two or more grids

The only way a step reads several steps. Each input gets its own lineage
entry.

### join — match rows on a key · `k grids → 1`

```text
join(wf["r"], wf["cn"], on="city")         cn:  # │ city   country
                                                0 │ Oslo   NO
 #r  #cn │ #  │ city   temp_c  country          1 │ Rome   IT
─────────┼────┼──────────────────────           2 │ Cairo  EG
 0   0   │ 0  │ Oslo    4.0    NO
 1   1   │ 1  │ Rome   18.5    IT
 2   0   │ 2  │ Oslo    6.0    NO
 3   2   │ 3  │ Cairo  31.2    EG
```

Rows: one per matching pair. Columns: both grids' (the key once).
Lineage: `#r` and `#cn`, one position each. Provenance: each cell ← the
input row its column came from (`country[0]` ← `cn[0]`).

### stack — one grid's rows, then another's

```text
stack(wf["r"], wf["r2"])

 #r    #r2  │ #  │ city
────────────┼────┼──────
 0     —    │ 0  │ Oslo
 1     —    │ 1  │ Rome
 2     —    │ 2  │ Oslo
 3     —    │ 3  │ Cairo
 —     0    │ 4  │ Lima
```

Rows: all of each, in order. Columns: shared names line up. Lineage: one
entry per input; the other is empty (`—`, core: `None`).

### zip — row i of each, side by side

```text
zip_(wf["r"], wf["map"])

 #r  #map │ #  │ city   temp_c  tags  │ map
──────────┼────┼──────────────────────┼──────
 0   0    │ 0  │ Oslo    4.0    …     │ 39.2
 1   1    │ 1  │ Rome   18.5    …     │ 65.3
```

This is how a `map`'s result is put back beside its inputs (map keeps only
its result, §4).

---

## 9. Failure: how it moves through mappings

```text
fragile[mod.map()](wf["r"])         half[mod.map()](wf["fragile"])
 #  │ fragile                        #  │ half
────┼───────────────────            ────┼─────────────
 0  │  4.0     known                  0  │  2.0   known
 1  │  ERROR   failed  ── reads ──▶   1  │  —     blocked
 2  │  6.0     known                  2  │  3.0   known
 3  │ 31.2     known                  3  │ 15.6   known
 step: failed                         step: failed
```

**REQ-MAP-004** A failure stays in its row. The failing cell is `failed`
with its error; every later cell computed from it is `blocked`; every other
row runs and is `known`. Both steps' state is `failed` (019 §3).

**REQ-MAP-005** A row that fails is still a row: it keeps its position, so
positions don't shift because of a failure.

---

## 10. All mappings at a glance

| Verb | Rows | Columns | Lineage (`#<input>`) | Provenance of a cell |
|---|---|---|---|---|
| map | 1 → 1 | result only | — | that row's bound cells |
| filter | 1 → 0..1 | all kept | one position | that row |
| group | 1 → 1 | all + key | — | that row's bound cells |
| expand | 1 → n | items only | position + item | the parent's list cell |
| collapse | n → 1 | key + result | list of positions | the group's column |
| distinct | n → 1 | all (first row's) | list of positions | the first row |
| table | all → any | tool decides | — | the whole grid |
| source | none → n | the result | — | — |
| sweep | none → n | settings + result | — | — |
| select · drop · rename · copy · pack · widen | 1 → 1 | as named | — | that row's cell |
| sort | n → n | all | one position | that row |
| slice | n → k | all | one position | that row |
| join | pairs | both | one per input | the row its column came from |
| stack | all, then all | shared | one per input (other empty) | that row |
| zip | row i of each | both | one per input | the row its column came from |

---

## 10a. Lossless? Each verb against rule T7

019 T7: modifiers are lossless with respect to references; for any cell you
can recover the cells, arguments and tool that made it. Checked on the run
above:

| Verb | References kept (run) | Verdict |
|---|---|---|
| map, group, filter, expand, sort, slice | input cell named per output cell; lineage where rows move | **lossless** |
| collapse, distinct | lineage lists every member row; provenance gives the column, no member rows (F4) | **lossless via lineage**; provenance should list the members |
| select, drop, rename | same rows, named columns | **lossless** |
| pack, copy, widen | provenance names the wrong input column (F3) | **not yet**: a core bug |
| join, stack, zip | one lineage entry per input; cells name their input row | **lossless** |
| sweep, source | no input: the swept settings are columns | **lossless** (nothing to refer back to) |
| table | provenance is the whole input table; no row lineage | **coarse but allowed** (019 T6: the tool's own mapping) |

distinct also **drops values** (the other rows' non-key columns): their
references survive in lineage, but the values don't appear. That is the
verb's meaning, and should be said on screen (F6).

---

## 10b. One framework: a reference column and a column map

**The idea (owner, 2026-11-16):** with keys ([019 §4.3](./019-table-model.md)),
the cell-to-cell mapping from earlier steps can be kept in **one column of
reference cells**, instead of today's lineage columns in three shapes
(`#r` one position, a list, `#r` + `#r.idx`; one column per input).

**Why one column is enough.** A cell's provenance factors into two parts:

```text
   cell (row i, column c)  =  ROW MAP (row i)  ×  COLUMN MAP (column c)
                              which input rows     which input column,
                              this row came from   or "computed by the tool"
                              — per row: data      — per step: schema
```

The row part changes row by row, so it is stored, once per row, in the
**reference column**. The column part is the same for every row, so it is
stored **once per step**, as the **column map**. Nothing is stored per cell.

### 10b.1 The reference column

```text
 #ref                                      │ #  │ city    temp_c   country
───────────────────────────────────────────┼────┼─────────────────────────
 key a91… ← r:key 3c2… , cn:key 07e…       │ 0  │ Oslo     4.0     NO
 key 5d4… ← r:key 8f1… , cn:key b20…       │ 1  │ Rome    18.5     IT
   ▲            ▲
   this row's   the input rows it came from, by key (one per input;
   key          a list for a group; plus the item for an expand)
```

Each reference cell holds:

| Field | Holds |
|---|---|
| `key` | this row's key: its call's key, or for a no-tool verb, the hash of the verb's spec and its input rows' keys |
| `inputs` | the input rows, **by key**, per input step: one key, a list (a group), or a key and an item (an expand) |

**Keys, not positions.** References point at row *keys*, which don't move
when a table is re-sorted or re-run. Positions (`#`, `#r` as shown today)
are **derived for display** and for formulas (130 R1), so a picked position
can still be checked against the key it pointed at ("reference moved",
130 T1).

### 10b.2 The column map

One per step: for each output column, where it comes from.

| Source of a column | Example | A cell's key |
|---|---|---|
| **passed through** from an input column | filter keeps `city` from `r.city` | **the input cell's key**: unchanged, so nothing downstream of it changes |
| **renamed / copied** from an input column | `t` ← `r.temp_c`; `city2` ← `r.city` | the input cell's key |
| **computed by the tool** from bound columns | `map` ← `to_f(r.temp_c)` | the **call's key** (step key + the read cells' keys) |
| **packed** from several columns | `rec` ← `{r.city, r.temp_c}` | hash of those cells' keys |
| **widened** from a dict column | `city` ← `rec["city"]` | hash of the dict cell's key and the field |
| **a swept setting** | `temp_c` ← sweep setting | hash of the setting's value |
| **a group key** | `city` ← the group's key | hash of the key value |

So the key of any cell is derived from three things already kept: the
reference cell of its row, the column map of its step, and the input
cells' keys (REQ-MAP-006, below).

### 10b.3 Every reshaping verb in the framework

| Verb | Row map: a row's `inputs` | Column map | A call reads (its key covers) |
|---|---|---|---|
| **source** | none | every column ← the tool's result | the literal arguments |
| **sweep** | none | settings ← sweep values; result ← tool | the row's setting values |
| **map** | one input row | result ← tool (dict: one column per key) | the row's bound cells |
| **filter** | one input row (kept) | all ← passed through | the row's bound cells (the test) |
| **group** | one input row | all ← passed through; key ← tool | the row's bound cells |
| **expand** | one input row + item | items ← tool | the parent's list cell |
| **collapse** | the group's rows (a list) | key ← group key; result ← tool | the group's bound cells + the key column |
| **distinct** | the group's rows (a list) | all ← the first member's cells | the key columns |
| **table** | the whole input table | the tool decides | the whole input table |
| **select / drop** | one input row | the kept columns ← passed through | — (no tool) |
| **rename** | one input row | renamed ← their input columns | — |
| **copy** | one input row | all ← passed through; copies ← their originals | — |
| **pack** | one input row | the pack ← the packed columns; others ← passed through | — |
| **widen** | one input row | each field ← the dict column's field; others ← passed through | — |
| **sort** | one input row | all ← passed through | the sort column (decides order, not values) |
| **slice** | one input row | all ← passed through | — |
| **join** | one row of each input | each column ← the input it came from | the key columns of both |
| **stack** | one row of one input | shared columns ← that input's | — |
| **zip** | row i of each input | each column ← the input it came from | — |
| **auto** | as the verb it resolved to | | |

**Reordering changes no values.** sort and slice change which row is
where, not any cell's value: their cells keep their input cells' keys, so a
re-sort upstream changes no key downstream, only positions.

**REQ-MAP-006** A table's whole mapping from its inputs is kept as one
reference column (per row: its key and its input rows, by key) and one
column map (per step: each output column's source). No per-cell lineage is
stored; any cell's provenance and key are derived from the two.

**REQ-MAP-007** References hold row keys, never positions. Positions are
derived, for display and for formulas.

**REQ-MAP-008** A passed-through, renamed or copied cell keeps its input
cell's key, so changes that don't touch its value don't flag it downstream.

**What this replaces:** the `#<step>` lineage columns and their three
shapes (130 R2, T3) become a view of the reference column; core's per-cell
`inputs` in `k.cell` become derived from it. Ask: [008 K31](../core-proposals/008-core-changes.md#k31-call-keys-change-and-reuse-per-tool-call).

---

## 10c. Consolidating the verbs: primitives and extensions

**The question (owner, 2026-11-16):** can the verbs be consolidated, and
rebuilt as extensions of others?

**Yes.** In the framework of §10b every verb is a row map plus a column
map, and most verbs differ in only one of the two. So a few **primitives**,
each changing **either rows or columns, never both**, rebuild every other
verb.

### 10c.1 The primitives

```text
             ROWS (which samples)                       COLUMNS (which variables)
 ┌──────────┬─────────────────────────────┐   ┌──────────┬───────────────────────────────┐
 │ keep     │ 1 → 0..1  a test per row    │   │ compute  │ a tool per row → new column(s)│
 │ order    │ n → n     a key per row     │   │          │ (optionally keeping the input)│
 │ spread   │ 1 → n     a list per row    │   │ columns  │ one map {new: old}: select,   │
 │ reduce   │ n → 1     rows by key       │   │          │ drop, rename, copy, nest      │
 │ generate │ none → n  from settings     │   │          │ (pack), unnest (widen)        │
 │ combine  │ k → 1     by key / append / │   └──────────┴───────────────────────────────┘
 │          │           by position       │
 └──────────┴─────────────────────────────┘    + table: the whole table to a tool (T6)
```

Eight primitives (six for rows, `compute` and `columns` for columns), and
`table` as the one escape hatch where a tool does its own mapping.

### 10c.2 Every verb as an extension

| Verb | = primitives | Checked |
|---|---|---|
| **map** | compute | — |
| **group** | compute, keeping the input's columns | run: group's output = `r`'s columns + `map`'s result |
| **filter** | compute (a test) → keep where true | — |
| **sort** | compute (a key) → order | — |
| **slice** | keep by position | — |
| **distinct** | reduce by key, taking each group's first row | **run: identical** to `first[mod.collapse(by="city")]`, values and lineage |
| **collapse** | reduce by key, with a tool | — |
| **expand** | compute (a list) → spread | — |
| **source** | generate | — |
| **sweep** | generate (every combination of settings) → compute | — |
| **select · drop · rename · copy** | columns, with a map | — |
| **pack · widen** | columns: nest · unnest | — |
| **join · stack · zip** | combine: by key · append · by position | — |
| **table** | its own primitive (T6) | — |

Twenty verbs, eight primitives and `table`.

### 10c.3 What it gives

- **The rules are defined once per primitive.** Row map, column map, read
  set, keys and losslessness (T7) are written for eight primitives; every
  verb built from them inherits them. A class of bug like F3 (pack, copy
  and widen naming the wrong source column) can't recur, because all four
  are the one `columns` primitive.
- **New verbs without new rules.** A developer or the owner can define
  `top(n, by=…)` as `order → keep by position`, and it is lossless and
  keyed with no change to core's rules.
- **The familiar names stay.** `filter`, `sort` and `distinct` remain what
  users type and see; a named verb is a fixed composition in the catalog,
  printed by its own name. The formula doesn't change.
- **One step stays one expression.** An extension is one verb in the
  formula. **Rule:** an extension combines at most one `compute` with one
  row primitive (filter = compute → keep), so a step still has one shape.

### 10c.4 What it touches

- **map vs group (F1):** with `compute` having a "keep the input's columns"
  setting, `group` is `map` with it on. Deciding F1 decides whether these
  stay two names.
- **expand's `keep` setting** doesn't keep the input's columns (run); with
  `spread`, keeping them is the same setting as on `compute`.
- **slice by position** reads positions, which are derived from keys
  (§10b.1): fine, since positions are what a user means by "rows 1 to 3".

**REQ-MAP-009** Core defines eight primitives and `table`; every other verb
is a named extension of them. The rules of this spec are stated for the
primitives, and hold for every extension.

### 10c.5 Reductions: both directions

| Reduce | Primitive | Example (run) |
|---|---|---|
| **many rows → one row** | `reduce` (collapse, distinct) | `mean_temp[mod.collapse(by="city")]`: Oslo's two rows → one |
| **many columns → one column, per row** | `compute` with a tool reading several columns | `both_years(y2023, y2024)` under `map`: `9.0, 37.5` |
| **many columns → one dict column, per row** | `columns` (nest / pack) | `pack(columns=["y2023", "y2024"])` |

---

## 10d. Turning: columns into rows, and rows into columns

**The need (owner, 2026-11-16):** sometimes columns must become rows. A
table with one column per year must become one row per (city, year) before
a per-year tool can run, and back again for a report. These are the only
reshapes that change **rows and columns together**, so they are their own
primitives.

**Proposed:** core has no `unpivot` or `pivot` today. §10d.1 is a run; the
diagrams in §10d.2–10d.3 are the design, not output.

### 10d.1 Today (run): three steps, and the trace is lost

```text
w:  city   y2023  y2024        pack → expand(as_pairs) → widen        year   temp
    Oslo    4.0    5.0     ──────────────────────────────────▶       y2023   4.0
    Rome   18.5   19.0                                                y2024   5.0
                                                                      y2023  18.5
                                                                      y2024  19.0
```

- It takes three steps and a custom tool to name the pairs.
- `city` is lost (expand keeps only its items).
- The header names become data inside the custom tool, unseen by core.
- **The cell-to-cell trace is lost:** the `temp` cell in row 1 says only
  "row 1 of `long`"; that it is `w`'s cell (Oslo, `y2024`) is recoverable
  only by convention ("item 1 of the dict"). That breaks T7.

### 10d.2 unpivot — columns into rows · `1 → m`

```text
identity[mod.unpivot(columns=["y2023", "y2024"], names="year", values="temp")](wf["w"])

 w                                       unpivot
 #  │ city   y2023  y2024           ref               │ #  │ city   year    temp
────┼─────────────────────   ──▶  ─────────────────────┼────┼─────────────────────
 0  │ Oslo    4.0    5.0          w:0 · y2023         │ 0  │ Oslo   y2023    4.0
 1  │ Rome   18.5   19.0          w:0 · y2024         │ 1  │ Oslo   y2024    5.0
                                  w:1 · y2023         │ 2  │ Rome   y2023   18.5
                                  w:1 · y2024         │ 3  │ Rome   y2024   19.0
```

| Rule | |
|---|---|
| Rows | `1 → m`, m = the unpivoted columns, in order |
| Columns | the others (`city`) passed through; `names` ← **the column header**; `values` ← the cell |
| Reference | each row ← **one input row and one input column**: `w:0 · y2024` |
| Cell to cell | `temp[1]` ← `w[0].y2024` exactly; `year[1]` ← the header `y2024`; `city[1]` ← `w[0].city` |
| Key | `temp` keeps the input cell's key; `year` is hash of the header name |

### 10d.3 pivot — rows into columns · `n → 1` per id

```text
identity[mod.pivot(by="city", names="year", values="temp")](wf["long"])

 long                                     pivot
 #  │ city   year    temp          ref                         │ #  │ city   y2023  y2024
────┼──────────────────────  ──▶  ──────────────────────────────┼────┼───────────────────
 0  │ Oslo   y2023    4.0          {y2023: long:0, y2024: long:1} │ 0  │ Oslo    4.0    5.0
 1  │ Oslo   y2024    5.0          {y2023: long:2, y2024: long:3} │ 1  │ Rome   18.5   19.0
 2  │ Rome   y2023   18.5
 3  │ Rome   y2024   19.0
```

| Rule | |
|---|---|
| Rows | one per distinct `by` value |
| Columns | `by` passed through; **one column per distinct value of `names`**: data becomes headers |
| Reference | each row ← **one input row per new column**: `{y2023: long:0, y2024: long:1}` |
| Cell to cell | `y2024[0]` ← `long[1].temp` exactly |
| Gaps | a missing (id, name) pair → `MISSING`; two rows for one pair → a problem, unless a reducing tool is given (`pivot(…)` with `collapse`'s tool) |
| Key | each cell keeps its input cell's key |

**unpivot then pivot gives back the original table**, cells, keys and all:
the pair is lossless both ways.

### 10d.4 What it does to the framework

**Headers and data cross only here, and on purpose.** 019 REQ-TBL-002 says
headers are never data. unpivot turns headers into data, and pivot turns
data into headers. Both are explicit, named verbs, recorded in the column
map (`year` ← "header names"; `y2024` ← "rows where year = y2024"), the
same way `copy` is the one way lineage becomes data (130 R12).

**The reference cell gains a column.** For every other verb, a row's
reference names input rows and the column map names input columns (§10b).
Turning ties a row to a column, so its reference cell carries it:

| Verb family | A reference cell holds |
|---|---|
| everything in §10b–10c | input rows, by key (one, a list, or one plus an item) |
| **unpivot** | an input row **and an input column**: `w:0 · y2024` |
| **pivot** | **one input row per output column**: `{y2023: long:0, …}` |

That is the general form: **a reference is (step, row key, column)**, with
the column left out whenever the column map already says it. Every
cell-to-cell mapping fits it; the earlier verbs are the common case where
the column part is the same for every row.

**The primitives become ten:**

```text
 rows:     keep · order · spread · reduce · generate · combine
 columns:  compute · columns
 turning:  unpivot · pivot                    + table (T6)
```

**REQ-MAP-010** Core provides `unpivot` (columns → rows) and `pivot` (rows
→ columns). Each output cell references its exact input cell; headers
become data (unpivot) or data becomes headers (pivot) only through them,
recorded in the column map. unpivot then pivot is the identity.

**REQ-MAP-011** A reference is `(step, row key, column)`. The reference
column stores the column part only where the column map can't say it
(unpivot, pivot).

**Decided (owner, 2026-11-16):** cell-to-cell mappings, as above: every
output cell references its exact input cell(s); `unpivot` and `pivot` are
primitives.

---

## 10e. Chains: several reshapes in one step

**The need (owner, 2026-11-16):** when a step only reshapes (no tool runs),
several reshaping verbs should chain in one step: unpivot, then sort, then
select, without a step for each.

```text
identity[mod.unpivot(columns=["y2023", "y2024"], names="year", values="temp"),
         mod.sort(by="year"),
         mod.select(columns=["city", "year", "temp"])](wf["w"])

  wf["w"] ──▶ unpivot ──▶ sort ──▶ select ──▶ the step's one table
              (no table in between is a step: nothing can reference it)
```

**Still one expression (T1).** A chain is one formula, read left to right
like a pipe, producing one table. The tables in between aren't steps: no
name, no references to them.

### 10e.1 The rule

| May chain | May not |
|---|---|
| any number of **reshaping primitives that apply no tool**: keep by position (slice), order by a column (sort), spread a list column, reduce with a built-in (`first`, `count`, …), columns (select, drop, rename, copy, pack, widen), unpivot, pivot | **more than one tool.** A step applies at most one tool, so each cell has one call ([019 §4.1](./019-table-model.md)) |
| plus **at most one** verb that applies the step's tool (map, filter, collapse with a tool, …), anywhere in the chain | a combine (join, stack, zip) after the first verb: a step's inputs are fixed at its start |
| execution modifiers (`retry`, `timeout`) after it, as today | |

**REQ-MAP-012** A step may chain any number of no-tool reshaping
primitives, and at most one verb that applies a tool; the chain runs left to
right and produces the step's one table.

### 10e.2 References compose

Each primitive in the chain maps cells to cells (§10b, §10d), so the
chain's mapping is their composition, worked out when the step runs. The
step's reference column points **straight at the step's input cells**,
never at the tables in between:

```text
 output cell        unpivot          sort          select
 (row 2, temp)  ←  (w:1 · y2023)  ←  reorder  ←  passed through
                    = w[1].y2023 exactly
```

Keys compose the same way: a passed-through cell keeps its input cell's
key through the whole chain, so a chain of pure reshapes never makes a cell
"may change" unless an input cell it came from changed.

**REQ-MAP-013** A chained step stores one reference column and one column
map for the whole chain, pointing at its input cells; lossless (T7) holds
for the chain because it holds for each primitive.

### 10e.3 Chains and grouped steps

| | A chain | Grouped steps |
|---|---|---|
| is | one step, one expression | several steps under one name |
| tables in between | none you can see or reference | every step's table, referenceable |
| use it when | the in-between shapes don't matter | each stage is worth seeing or reusing |

In the UI the formula panel shows a chain as a list of stages, each
editable, with an optional preview of the table after each; the previews
aren't steps.

### 10e.4 Today (run)

| Formula | Core 1.0.2 |
|---|---|
| `identity[mod.sort(by="temp_c"), mod.select(columns=["city"])](wf["r"])` | **accepted, and both apply** in order (sorted, then `city` kept; lineage `#r` `1, 0, 2`). Prints back as `op("identity")[…]`, not `identity[…]` |
| `identity[mod.drop(columns=["tags"]), mod.rename(columns={"temp_c": "t"})](wf["r"])` | **refused:** "2 shape verbs in one step (rename, drop); at most one is allowed" |

So chains half-exist: some pairs run, others are refused, with no stated
rule. REQ-MAP-012 is that rule.

---

## 10f. Copy as values: the data now, without references

**The need (owner, 2026-11-16):** copy the data a step (or a selection of
it) has now, as plain values, **without recording references**: a snapshot
that no longer follows where the data came from.

```text
 wf["f"]  (computed, with references)            snapshot: a new data step
 #  │ city   to_f                                #  │ city   to_f
────┼───────────────   ── Copy as values ──▶   ────┼───────────────
 0  │ Oslo   39.2       (references dropped)     0  │ Oslo   39.2     ← plain values
 1  │ Rome   65.3                                 1  │ Rome   65.3
```

### 10f.1 What it is

**A new data step: a source whose values are the copy.** In the table
model it is `generate`: no inputs, no reference column, no lineage.

| | A computed step | Its snapshot |
|---|---|---|
| expression | `to_f[mod.map()](wf["r"])` | `snapshot[mod.source()](values=…)` |
| references | every cell → its input cells | **none** |
| a cell's key | its call's key | **hash of its value** |
| an upstream change | flags it "may change" | **never flags it**: it's frozen |
| re-run | recomputes | gives the same values |

**The expression holds the values,** so a snapshot is reproducible on its
own (T1): small data inline, as a data step's literal table
(`data={"city": [...], "to_f": [...]}`, 135 §4); large data by **content
key**, `snapshot[mod.source()](id="ss:4be0…")`, the values kept once in the
store of K31 (keyed by their hash, so two identical snapshots are stored
once).

### 10f.2 Two ways to make one

| Action | Where | Result |
|---|---|---|
| **Copy as values** | a step's or a selection's popover | a **new data step** to the right, holding the copied cells; the original step is unchanged |
| **Make values** (135 E8) | a computed step's popover | the **same step** becomes a data step holding its current values: its expression is replaced, its references dropped |

A selection copies only what it covers (rows, columns, a block), keeping
column names and types.

### 10f.3 The rules

**REQ-MAP-014** Copy as values makes a new data step whose cells are
values only: no reference column, no lineage, keys = hashes of the values.
Nothing upstream can make it "may change".

**REQ-MAP-015** Dropping references is always an explicit action (Copy as
values, Make values), never a side effect. It is the one deliberate
exception to T7, and the step shows that it is a snapshot.

**REQ-MAP-016** A snapshot is reproducible from its own expression: the
values inline when small, or a content key into the store when large.

### 10f.4 A note of origin

**Decided (owner, 2026-11-16):** a snapshot keeps a plain **note** of where
it came from ("copied from `wf["f"]`, 2026-11-16"), shown to people. It is
not a reference: it is never used for keys, lineage or "may change".

**REQ-MAP-017** A snapshot carries a note of its origin (step and date),
for people only; it has no effect on keys, references or state.

---

## 11. Findings from the run (for core, and decisions)

| # | Finding | Kind |
|---|---|---|
| F1 | **map keeps only its result column.** To see inputs and result together you add a `zip_` step. Is that the rule (one expression = one new column), or should map keep the input's columns? | decision |
| F2 | **A dict result spreads into columns** under map (`info` → `len`, `upper`) without `widen`. Implicit; is it wanted? | decision |
| F3 | **Provenance names the wrong column** for no-tool reshapes: `pack`'s `rec` says it came from `r.rec` (no such column), `copy`'s `city2` from `r.city2`, `widen`'s `temp_c` from `pack.temp_c` (it came from `pack.rec`) | core bug |
| F4 | **table and collapse give provenance a row of `None`**: right for "the whole grid" or "a group", but the group's member rows (in lineage) aren't in provenance | core ask |
| F5 | **Lineage has three shapes** (one position, a list, position + item), as 130 T3 notes; a condition over lineage needs to handle each | known (130 T3) |
| F6 | **distinct keeps the first row's values** for the other columns, silently | decision: say so on screen |
| F7 | **Result column names differ by verb:** map, expand, collapse and sweep name the result after the step; group names its key `group` | decision: one rule (after the step), or keep `group` |

---

## 12. Open points for the owner

1. **F1:** map keeps only its result (today), or keeps the input's columns
   too?
2. **F2:** a dict result spreads into columns under map, or stays one dict
   column until `widen`?
3. **The five rules (§1):** are Rows, Columns, Lineage, Provenance and
   Failure the right way to describe every mapping?
4. **Diagrams:** is this level of detail right, or would an interactive
   page (click a verb, see input → output with lineage lines) help more?
5. **Primitives (§10c, §10d):** **decided** (owner, 2026-11-16): cell-to-cell
   mappings, ten primitives with `unpivot` and `pivot`, and chains of
   reshapes in one step (§10e). Core ask:
   [008 K32](../core-proposals/008-core-changes.md#k32-primitives-cell-to-cell-references-and-reshape-chains).
6. **Names of the primitives:** `keep`, `order`, `spread`, `reduce`,
   `generate`, `combine`, `compute`, `columns`, `unpivot`, `pivot`: keep, or
   prefer others (e.g. `explode` for spread, `aggregate` for reduce,
   `longer` / `wider` for unpivot / pivot)?
7. **Pivot with duplicates:** two rows for one (id, name) pair is a problem
   (recommended), or reduced by a tool the user gives?
