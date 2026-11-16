# 019 — The table model: table, grid and cell

**Status:** draft for the owner's review (2026-11-16). Dev plan
[136](../dev_plan/136-consolidation-plan.md) Track A, phase P0. How a step's
table is made from earlier tables is [020](./020-table-mappings.md). Every
"core today" line was **run** against core 1.0.2 (`dbaf4c7`).

**Purpose:** one clear model of what a step produces, with one meaning
everywhere: the UI, formula text, the agent and a Python terminal.

---

## 0. The rules

The owner's rules (2026-11-16). Everything below follows from them.

| # | Rule |
|---|---|
| **T1** | **A step has one expression, and produces one table.** The expression may chain several reshapes, with at most one tool ([020 §10e](./020-table-mappings.md)). |
| **T2** | **A table is a grid of data, with headers and an index** to reference the data in the grid. |
| **T3** | **Rows are samples; columns are variables** of each sample. What counts as a sample or a variable depends on the goal, so tables are restructured by reshaping ([020](./020-table-mappings.md)). |
| **T4** | **A tool is fixed code.** Changing a step's tool call changes only *how it's applied*: its arguments and its modifiers. |
| **T5** | **A tool's arguments are literals, cells, or grid selections**, depending on the tool and how its modifiers apply it. |
| **T6** | **A tool may map data in its own way;** its insides are abstracted, and that is fine. |
| **T7** | **Modifiers are lossless with respect to references:** for any cell, you can recover the earlier cells, the arguments and the tool that made it. The one deliberate exception is **Copy as values**: an explicit snapshot that keeps the values and drops the references ([020 §10f](./020-table-mappings.md)). |
| **T8** | **A change is seen at once:** if anything a cell was made from changes (an argument, a modifier, the tool, an input cell), the cell, and everything made from it, shows it *may change* if run again. |

---

## 1. The picture

### 1.1 From workflow down to a value

```text
Workflow                                   the ordered steps
├── Grouped steps   (optional)             a named group of steps, for organizing only
│   └── Step                               T1: one line   name = expression
│       ├── Expression                     tool[modifiers](input, arguments)
│       └── Table                          T1: what it produced, always one
│           ├── Step header   wf["step"]   the table as one thing
│           ├── Column headers             name + type of each variable    ┐ T2: to
│           ├── Lineage       #<step>      where each row came from        │ reference
│           ├── Index         #            each row's position, 0..n-1     ┘ the data
│           └── Grid                       T2: the data
│               ├── Rows                   T3: samples
│               ├── Columns                T3: variables
│               └── Cells                  one value per (row, column)
│                   ├── value · type · state
│                   └── provenance         T7: what made it
└── Resource                               something steps use (a database, a model)
```

### 1.2 The table as you see it

```text
                       ┌──────────────────────────────────────────────┐
  Step header      →   │              wf["readings"]        3 × 2      │
                       ├──────┬────┬─────────────────┬────────────────┤
  Column headers   →   │  #r  │ #  │ city      str   │ temp_c   float │  variables
                       ├──────┼────┼─────────────────┼────────────────┤
                       │  0   │ 0  │ Oslo            │  4.0           │  ← a sample
                       │  2   │ 1  │ Rome            │ 18.5           │
                       │  5   │ 2  │ Cairo           │ 31.2           │
                       └──────┴────┴─────────────────┴────────────────┘
                        lineage index └──────────── the grid ─────────┘
                        └─ references ─┘          (the data)
```

### 1.3 Table, grid, cell: the three nested models

```text
┌─ TABLE ─ one per step ───────────────────────────────────────────┐
│  identity:  step header  wf["readings"]                          │
│  references: column headers (name, type) · index # · lineage     │
│                                                                  │
│   ┌─ GRID ─ the data: rows (samples) × columns (variables) ──┐   │
│   │                                                          │   │
│   │    ┌─ CELL ─ one value ─────────────────────────────┐    │   │
│   │    │  value · type · state                          │    │   │
│   │    │  provenance: expression + input cells + call   │    │   │
│   │    └────────────────────────────────────────────────┘    │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**REQ-TBL-001** (T1) Every step has exactly one table. A step that hasn't run
or has no expression still has one: 1 × 1, a single cell holding `EMPTY`.

**REQ-TBL-002** (T2) Only the grid's cells hold data. The step header,
column headers, index and lineage reference data; a tool never reads them
as values. The only crossings are explicit verbs: `unpivot` turns column
headers into data, `pivot` turns data into headers ([020 §10d](./020-table-mappings.md)),
and `copy` turns lineage into data (130 R12).

---

## 2. The models

### 2.1 Table

**What it is:** everything one step produced: the grid of data, and the
headers and index that let you reference it.

| Holds | Meaning |
|---|---|
| `step` | the step it belongs to; its header is `wf["step"]` |
| `columns` | the column headers: each variable's name and type |
| `index` | each row's position, `0..n-1` |
| `lineage` | for each row, the rows of earlier tables it came from (`#<step>`) |
| `grid` | the data |
| `state` | the step's state (§5) |
| `plan` | before it runs: the shape core expects, and how sure it is |

| Used by | How |
|---|---|
| UI | the step's data panel; the header row `wf["step"]` selects all of it |
| Formula | `wf["step"]` |
| Agent | reads its headers, types, state and a sample of rows |
| Terminal | `k.table("step")` *(proposed)*; today `k.view("step")` |

### 2.2 Grid

**What it is:** the data of a table: rows (samples) by columns (variables),
a cell at every crossing.

```text
                 variables →
              city      temp_c
 samples  0 │ Oslo   │   4.0  │
    ↓     1 │ Rome   │  18.5  │      a cell = one variable of one sample
          2 │ Cairo  │  31.2  │
```

| Part | Is | Addressed by |
|---|---|---|
| **Row** | one sample: a cell in every column | its position in the index: `wf["s"][1]` |
| **Column** | one variable: a cell in every row, one type | its name in the column header: `wf["s"][cols["temp_c"]]` |
| **Cell** | one variable of one sample | both: `wf["s"][1][cols["temp_c"]]` |

**REQ-TBL-003** (T2) A row is addressed by its position (`0..n-1`, like a
Python list, 130 R1); a column by its name, never its position.

**REQ-TBL-004** (T3) Whether something is a row or a column is a choice of
the table's shape, not of the data. Reshaping changes it without losing any
value or reference ([020](./020-table-mappings.md)).

### 2.3 Cell

**What it is:** one value: one variable of one sample. The only place data
lives.

| Holds | Meaning |
|---|---|
| `row`, `column` | where it is |
| `value` | the data, or a marker (§2.5) |
| `type` | the value's type |
| `state` | `known`, `pending`, `failed`, … (§5) |
| `error` | why it failed, when it did |
| `provenance` | what made it (§4) |

| Used by | How |
|---|---|
| UI | click it: the formula bar's second line shows the call that made it (134 §5); hover shows its input cells |
| Formula | `wf["step"][1][cols["temp_c"]]` |
| Agent | reads a value and where it came from, to explain it |
| Terminal | `k.cell("step", 1, "temp_c")` |

### 2.4 Selection

**What it is:** a part of one table's grid, picked by clicking or written in
a formula. It points at data; it holds none. Its kinds, nested by size:

```text
Table                   wf["s"]                         every cell
├── Rows                wf["s"][0:3]   wf["s"][[0, 2]]  whole samples
├── Columns             wf["s"][cols["a"]]              whole variables
├── Block               wf["s"][0:3][cols["a", "b"]]    samples × variables
│   └── Cell            wf["s"][1][cols["a"]]           one value
├── Index               (the # column)                  positions: UI only
└── Cells               (⌘-click several)               scattered: UI only
```

**REQ-TBL-005** Every selection a formula can use prints as formula text,
and reads back to the same selection.

### 2.5 Markers: values that aren't data

**Today (run):** core shows a missing value, a failure, a `NaN` and the
empty step all as `None`. Only the cell's state tells them apart, and a
`NaN` can't be told apart at all: it becomes `None`, state `known`.

| Marker | Means | Cell state |
|---|---|---|
| `EMPTY` | the step has no expression yet | `pending` |
| `MISSING` | no value at this position (a record without that key) | `absent` |
| `ERROR` | the tool failed here; carries the message | `failed` |
| `NAN` | a number that isn't one | `known` |
| `None` | the tool returned nothing, on purpose | `known` |

**REQ-TBL-006** Each marker is distinct from every other and from `None`,
and can be written in a formula (e.g. keep rows whose `b` is not `MISSING`).

---

## 3. Arguments: what a tool receives (T4, T5)

A tool's code never changes in a step (T4). What a step changes is how the
tool is applied: **which arguments it gets, and how the modifiers feed
them.**

### 3.1 The kinds of argument

| Kind | Written as | The tool receives |
|---|---|---|
| **Literal** | `k=2.0`, `name="x"`, `[1, 2]` | the same value on every call |
| **Cell** | `b=wf["s"][0][cols["temp_c"]]` | one value, the same on every call (a pinned cell) |
| **Column** (bound) | the input's column of the parameter's name, or `temp_c=wf["s"][cols["reading"]]` | depends on the modifier, below |
| **Whole table** | `wf["s"]` under `mod.table()` | the table, as one value |
| **Resource** | `res["db"]` | a live object (a database, a model) |

### 3.2 How the modifier decides what a column becomes

The same column, `temp_c`, reaches the tool differently under each
modifier:

```text
 wf["r"]                 mod.map()              mod.collapse(by="city")      mod.table()
 city    temp_c          one call per row       one call per group           one call
 Oslo     4.0    ──▶     tool(temp_c=4.0)       tool(temp_c=[4.0, 6.0])      tool(whole table)
 Rome    18.5    ──▶     tool(temp_c=18.5)      tool(temp_c=[18.5])
 Oslo     6.0    ──▶     tool(temp_c=6.0)       tool(temp_c=[31.2])
 Cairo   31.2    ──▶     tool(temp_c=31.2)
                         a cell                 a column's slice (a list)    a table
```

| Modifier | A bound column arrives as | Calls |
|---|---|---|
| `map`, `filter`, `group`, `expand` | **one cell**: the row's value | one per row |
| `collapse`, `collapse(by=…)` | **a list**: the group's values | one per group |
| `table` | **the whole table** | one |
| `sweep` | no input: each **combination of literals** | one per combination |

### 3.3 Binding and types

| Term | Means |
|---|---|
| **accepted type** | the type a parameter takes, from the tool's signature (`temp_c: float`) |
| **binds** | which column fills a parameter: **by name**, or as written in the formula; never by type alone (130 R9) |
| **schema** | the types a selection covers: one type for a cell or column, a name → type map for a block |
| **fits** | the bound selection's schema matches the accepted type; if not, the step has a problem naming both |
| **compatible columns** | the columns that would fit a parameter: what the UI offers when you bind by hand |

**REQ-TBL-007** (T4) Changing a step's arguments or modifiers re-checks the
binding: a selection that no longer fits is a problem on the step, before
anything runs. Changing a tool's accepted type (its code) re-checks every
step that uses it.

---

## 4. Provenance and change (T6, T7, T8)

### 4.1 What made a cell

Every cell's provenance has three parts:

```text
cell  s[1].s = 37.0
├── expression   scale[mod.map()](wf["r"], k=2.0)     the step: tool, modifiers, arguments
├── inputs       r[1].temp_c = 18.5                   the input cells, by step, row, column
└── call         scale(temp_c=18.5, k=2.0) → 37.0     this cell alone: the expression, filled in
```

Following each input cell's provenance in turn traces any value back to
the source steps, through every tool and argument used.

**REQ-TBL-008** (T7) For every modifier, a cell's provenance is complete:
its inputs name every input cell it was made from. Where a modifier maps
rows (filter, sort, expand, collapse, join, …), lineage records it
([020](./020-table-mappings.md) §1).

**REQ-TBL-009** (T6) Inside a tool, the mapping is the tool's own. A tool
applied with `mod.table()` reads the whole table, so its cells' provenance
is the whole input table; that is complete, if coarse.

**Today (run):**

| Part | Core today |
|---|---|
| expression | on the step: its formula, and `ran_with` (`{formula, arguments: {k: '2.0'}}`) |
| inputs | on the cell: `k.cell("s", 1)["inputs"] = [{step: 'r', row: 1, columns: ['temp_c'], values: {temp_c: 18.5}}]` |
| call | **not given**: the app builds it from the two (134 §5) |
| gaps | no-tool reshapes name the wrong input column ([020](./020-table-mappings.md) F3); collapse and table give no member rows in `inputs` (F4) |

### 4.2 When a cell may change

A cell may change if run again when anything in its provenance changed:

| What changed | Which cells may change | Shown as |
|---|---|---|
| the step's argument or modifier | every cell of the step | step `stale`: *"updated args"* |
| the step's tool (its code, K20) | every cell of every step using it | each such step `stale` |
| an input cell's value | the cells made from it | `stale`, *"read stale 's'"* |
| a resource's data (if it reports a version) | the steps that use it | `stale` |

**REQ-TBL-010** (T8) Every step that may change says so in its own state,
at once, with the reason, including steps that only read a changed step.

**Today (run):** changing only `k=2.0 → 3.0` marks that step `stale`
("updated args"), and its cells keep their values, shown as outdated. A
step reading it **still says `completed`**; only `k.needs_run()` reports it
(*"read stale 's'"*). The app shows that reason today (`kernels.summary`).
REQ-TBL-010 asks for it in the reading step's own state.

### 4.3 Call keys: change tracked per cell, not per step

**The problem (owner, 2026-11-16):** in an interactive session, a change is
tracked per step (the app's `view_key`, core's `run_id`). Any edit marks the
whole step, and everything after it, as changed, even cells whose own
inputs and arguments didn't change. Those cells are fine, but they're shown
as changed and they're recomputed.

**Today (run):** three steps, `r` → `f = to_f(wf["r"])` → `h = half(wf["f"])`,
three rows each. Editing **one** value of `r` (row 1):

| | Today | Should be |
|---|---|---|
| what's flagged | `r` stale; `f` flagged as a whole ("read stale 'r'"); **`h` not flagged at all** | `r[1]`, `f[1]`, `h[1]` may change; the other 6 cells are fine |
| re-run calls | **6** (every row of `f` and `h`) | **2** (`f[1]`, `h[1]`) |

**Decided (owner, 2026-11-16): content-addressed call keys, owned by core.**
The approach mature incremental systems use (Bazel and Nix, git, Salsa,
Shake's early cutoff), in five parts:

| # | Part | Why |
|---|---|---|
| 1 | **One key per tool call**, built from **only the cells that call read** (its bound columns), not the whole row. The call's cells share it | a call is the unit of work; cheaper than per cell, more exact than per row: editing a column the tool doesn't read changes nothing |
| 2 | **Two phases:** at **edit**, mark "may change" by following references downstream (no hashing, instant); at **run**, compute the new key and **reuse** the old result if it's equal; if a recomputed value equals the old one, **stop** there (early cutoff) | the UI reacts at once; a run recomputes the least possible |
| 3 | **Keys are addresses:** outputs are stored under their call key | one mechanism gives the output store (K22, C32), incremental runs (136 I5), resuming, reuse across sessions, run ids (K20), and reproducible export |
| 4 | **Cheap, stable hashing:** a value is hashed once when it's made (a fast hash of a canonical form), stored beside it; tool code hashed when the catalog loads; resources by data version; a tool declared non-deterministic gets a recorded seed in its key | big values are never re-read to compare |
| 5 | **Core owns keys;** the app only shows "may change" and never computes a key | terminal, agent and UI agree; nothing duplicated (136, reactivity tiers) |

**The model: a key per call, from exactly what it read.**

```text
key(call)  = hash( step key ,  keys of the cells the call read )

step key   = hash( tool id + tool code,  value-changing modifiers,  literal arguments,
                   resource data versions,  seed if non-deterministic )
             (not the step's name: a rename recomputes nothing)
source / literal cell:  key = hash(value)
a cell's key = its call's key
```

A cell **may change** exactly when its call's recorded key differs from the
key its inputs give now. Keys are built from keys (a hash of hashes), so
they are cheap, and a change flows down by itself:

```text
 r                f = to_f(wf["r"])        h = half(wf["f"])
 0  1.0  k=a      0  33.8  k=hash(F, a)    0  16.9  k=hash(H, …)     unchanged ✓
 1  2.0→20.0      1  35.6  k=hash(F, b')   1  17.8  k=hash(H, …')    may change ●
    k=b → b'                  ▲ new key        ▲ new key
 2  3.0  k=c      2  37.4  k=hash(F, c)    2  18.7  k=hash(H, …)     unchanged ✓
```

**What each kind of change does:**

| Change | Cells whose key changes |
|---|---|
| edit one input cell | the cells that read it, and theirs, down the chain |
| add a row to a data step | the new row's cells (and any reduce over them); existing rows unchanged |
| change a literal argument | every cell of that step (each call used it), and theirs |
| add an execution modifier (`retry`, `timeout`) | none: it can't change a computed value |
| change a value-changing modifier (verb, `by=`, `try_except(default=…)`) | every cell of the step |
| change the tool's code | every cell of every step using it |
| re-enter the same formula | none (already true today) |

**Which input cells a cell read, per modifier** (from
[020](./020-table-mappings.md)):

| Modifier | A cell's inputs |
|---|---|
| map, group, select, rename, … (`1 → 1`) | that row's bound cells |
| filter | that row's cells (whether it's kept is decided per row) |
| expand | the parent row's list cell |
| collapse, distinct | the group's member cells, and the key column (membership) |
| sort | that row's cells and the sort column (order) |
| join, stack, zip | each matched row's cells, and the key columns |
| table | the whole input table: any change changes every cell (T6: coarse, allowed) |
| sweep, source | the literal settings |

**Store references, not copies.** A cell keeps only what's needed to
reproduce how it was made: its value, state and key, and **references** to
its input cells (step, row, column), never copies of their values. The
step keeps its expression once. The call, `scale(temp_c=18.5, k=2.0)`, is
rebuilt from the two when asked for.

**REQ-TBL-013** Each tool call has a key computed only from what made it:
the step key and the keys of the cells it read. Its cells share that key. A
cell may change exactly when its call's key differs from the key its
current inputs give.

**REQ-TBL-014** "May change" is shown per cell, and rolls up: a step says
how many of its cells may change ("1 of 3"), not just that it may.
Everything downstream is flagged at once, however many steps away.

**REQ-TBL-015** A re-run computes only the cells that may change, or aren't
`known` yet. This is the same mechanism as incremental runs by row state
(136 I5): one rule, "recompute what isn't known and current".

**REQ-TBL-016** A cell stores references to its inputs, not copies of their
values; the call that made it is rebuilt on demand. In practice nothing is
stored per cell: a table keeps one **reference column** (per row) and one
**column map** (per step), and every cell's references and key are derived
from them ([020 §10b](./020-table-mappings.md)).

**REQ-TBL-017** At edit time, "may change" is marked by following
references downstream, without hashing. At run time, a call whose new key
equals its stored key reuses its result; a recomputed value equal to the
old one stops the change there (early cutoff).

**REQ-TBL-018** Outputs are stored under their call keys; one store serves
put-away kernels, incremental runs, resuming and reuse. Results nothing
refers to are cleaned up.

**Rollout, each step useful on its own:**

1. Flag the whole chain: every step downstream of a change says so (today a
   step two links down isn't flagged).
2. Call keys for `1 → 1` verbs (map, group, filter, select, rename): most
   interactive editing.
3. Read rules for verbs that move rows (collapse, distinct, sort, join,
   expand).
4. The output store keyed by call keys: incremental runs and resuming.

Steps 1 and 2 already end the false "changed" alarms.

**The limits, said plainly:**

- **Positions can shift.** If a filter upstream now keeps an extra row,
  later rows move down; a reference to `wf["f"][2]` points at a different
  sample. That's flagged as "reference moved" (130 T1), not hidden.
- **Non-deterministic tools** (an LLM, a random sample) can change with the
  same key. Their step key includes a seed, or the tool is marked
  non-deterministic and its cells always "may change" when re-run.
- **Resources** that don't report a data version can't be tracked: a step
  using one is marked "may change" whenever the resource is reloaded.

---

## 5. States

States roll up: a row is as done as its worst cell; a step as done as its
rows.

```text
Cell     absent · known · maybe · pending · blocked · failed · invalid   (mildest → worst)
  │ worst cell
Row
  │ rollup, plus step-level facts
Step     staged · running · completed · stale · failed · invalid
Workflow run   idle · running · paused · stopped                          (the app's)
```

| Cell state | Means |
|---|---|
| `absent` | no value here (marker `MISSING`) |
| `known` | computed (a value, `NAN` or `None`) |
| `maybe` | planned, not certain to exist |
| `pending` | will be computed when the step runs (`EMPTY` for the empty step) |
| `blocked` | can't compute: an input failed |
| `failed` | the tool raised (marker `ERROR`) |
| `invalid` | the step can't run |

| Step state | Means |
|---|---|
| `staged` | declared, not run |
| `running` | running now |
| `completed` | every cell known |
| `stale` | may change if run again (§4.2) |
| `failed` | a cell failed or was blocked |
| `invalid` | the expression has problems |

**REQ-TBL-011** `stale` belongs to the step: its cells keep their last
values and states, shown as outdated. The app uses core's words for step
states (today it says `pending` for `staged` and `error` for `failed`).

### 5.1 Clearing outputs

Core can't clear an output today (run: no clear, reset or drop exists, and
re-assigning the same formula brings the old output back).

| Operation | Removes | The step becomes | Steps reading it |
|---|---|---|---|
| **Clear output** | the data, keeps the expression | `staged`, all cells `pending` | `stale` |
| **Clear cells** (a selection, or every `failed` cell) | those values | `staged`, those cells `pending` | `stale` |
| **Clear all outputs** | every step's data | all `staged` | — |
| **Reset step** | the expression and the data | the empty step (`EMPTY`) | invalid until rewritten |

**REQ-TBL-012** Clearing never removes an expression, except Reset step.
With incremental runs by row state, "clear the failed cells, run" retries
only those. A clear applies wherever the data is kept (kernel, disk, the
app's copies).

---

## 6. Core today, and the asks

| Model | Core 1.0.2 (run) | Ask |
|---|---|---|
| Table | a dict from `k.view(step)`: `columns, rows, state, summary, formula, row_count, window, markers, lineage` | a typed `Table` |
| Grid, Row, Column | dicts in the view: rows `{"#", position, state, lineage, cells}` (`#` is `0..n-1`); columns `{name, type, "#"}` | typed `Row`, `Column` |
| Cell | `{value, state, type}`; from `k.cell`: `+ inputs, lineage, row, column, column_number, step` | a typed `Cell` with full `provenance`, **including its `call`** (§4.1) |
| Selection | every form is `StepRef` | a `Selection` with a `kind` |
| Provenance | inputs per cell; expression and `ran_with` per step; F3, F4 gaps | complete inputs for every modifier (REQ-TBL-008) |
| Change | step `stale` with a reason; readers stay `completed`, flagged only in `needs_run()`; **two steps down isn't flagged at all**; a one-cell edit re-runs every row downstream (run: 6 calls for 2 needed) | call keys (§4.3): per-cell "may change", flagged however far down, and re-runs of only those calls (REQ-TBL-013–018); [008 K31](../core-proposals/008-core-changes.md#k31-call-keys-change-and-reuse-per-tool-call), building on K20 and K22 |
| Markers | all `None`; `NaN` lost | `EMPTY`, `MISSING`, `ERROR`, `NAN` |
| Clearing | none | `k.clear(step, rows=…, state=…)`, `k.clear_all()`, `k.reset(step)` |

---

## 7. Open points for the owner

1. **Index in formulas.** Positions stay references only (recommended,
   REQ-TBL-002), or can a formula read `#` as a value?
2. **Scattered cells.** UI-only (recommended), or a formula form?
3. **Provenance depth on screen.** One level (direct inputs), with "follow
   back" for more?
4. **`maybe`.** Shown to users, or folded into `pending`?
5. **Marker names.** `EMPTY`, `MISSING`, `ERROR`, `NAN` (plain, usable in
   formulas), or `#N/A`-style?
6. **A reader of a changed step:** `stale` too (recommended, REQ-TBL-010),
   or a separate state such as `may change`?
**Decided (owner, 2026-11-16):** change tracking is content-addressed call
keys, owned by core (§4.3): one key per tool call from the cells it read;
non-deterministic tools carry a recorded seed in their key.
