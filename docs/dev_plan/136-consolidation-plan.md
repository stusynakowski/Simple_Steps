# 136 — Consolidation: core ↔ app, features, polish

**Status:** proposed (2026-11-15). The owner's list of problems and wanted
features, organized into tracks with what already exists, what is missing,
and an order to do them in. Every "core: …" claim was **run** against core
1.0.2 (`dbaf4c7`) on 2026-11-15; the evidence is in §6.

The governing rule for everything below:
[one step, one expression](../design_principles/one_step_one_expression.md)
— a step's whole output is induced by one Python expression.

---

## 1. The items, as listed

Renumbered (the list had two 3s and two 4s):

| # | Item |
|---|---|
| I1 | Spreadsheet-like editing within the tool's scope: manual data entry, uploading a table, adding rows and columns, editing cells, defining a function in a cell, dragging a cell to extend an operation |
| I2 | Clear rules for when you edit cells, when you augment a step's function, and when you make a new step, keeping one expression per step |
| I3 | The grid model's abstraction is unclear: what does a grid contain (data, state, …)? |
| I4 | What is the object for a cell, a column, a row, or any selection in between, and what distinguishes headers, indices, cells and the data they hold? |
| I5 | Data management for long or incremental steps: store results so a process keeps what it has done, and can be re-run or updated |
| I6 | Row referencing: trace which input row a piece of data came from |
| I7 | Grouped steps: combine sequential steps into one (loading/reshaping/cleaning vs analysis vs summarizing/exporting) |
| I8 | The agent: polish, and sub-agents that are parts of the main one (e.g. an agent to update a single step) |
| I9 | Prefab components for operations, resources and data: custom interactive plots, resources and functions with their own UIs |
| I10 | Export a workflow to other formats: a notebook (e.g. Databricks, same environment), other pipeline frameworks |

---

## 2. Five tracks

Each item belongs to one track. **Owner** says where the work is: core (an
ask of `simple-steps-core`; the app shims only in `core_bridge.py`), app,
or both.

### Track A — The grid model (I3, I4) · core · **foundation**

**Today (run):** core has no Grid, Cell, Row, Column or Selection object.
A step's grid exists only as the dict `k.view(step)` returns:

```text
view:  step, state, summary, formula, columns, rows, row_count, window, markers, lineage
  columns[i]: {name, type, "#"}                    ← a column: its header
  rows[j]:    {"#", position, state, lineage, cells}  ← a row: its index and lineage
  cells[c]:   {value, state, type}                 ← a cell: data + state + type
k.cell(step, row, col): + inputs (input step, row, values), lineage, column_number
```

A selection is a reference, and **the whole step and any pick of it are the
same type** (`StepRef`): `wf["s"]`, `wf["s"][0]`, `wf["s"][0][cols["n"]]`.

**What's missing:** a named object model the app, the agent and a terminal
all share, so "a cell", "a column header", "the index" mean one thing
everywhere:

The words below are [019](../spec/019-table-model.md)'s, which is the
reference for each:

| Object | Holds | Distinguished by |
|---|---|---|
| **Table** (a step's output, one per step) | the step header, column headers, index, lineage, the grid; the step's state; its plan before it runs | always a DataFrame; the empty step is 1×1 `EMPTY` |
| **Grid** | the data: rows (samples) × columns (variables) | only the grid holds data |
| **Column** | name, type; its header | header = the column's identity, never data |
| **Row** | its position (the index), lineage to input rows | index = identity, never data |
| **Cell** | value, type, state (absent, known, pending, blocked, failed, invalid), error, provenance | the only place data lives; `stale` belongs to the step |
| **Selection** | a cell, a block, rows, columns, the whole step | a `StepRef` with a `kind`; prints as formula text |

**Decided (owner, 2026-11-15):** core makes these objects real. Their
definitions must be **very clear, and say how each is used**.

**Deliverable:** a spec (`docs/spec/`) with, for each object:

- **what it is**, in one sentence, and what it is not (a header is never
  data; the index is never data);
- **what it holds**, field by field, and its states;
- **how it's used**, by each of: the UI (what you click, what it shows),
  the formula (how it's written as text, e.g. `wf["s"][0][cols["n"]]`),
  the agent (what it reads), and a Python terminal (what you call);
- **how it maps to core today**, and the core ask that makes it real
  (typed `k.view` / `k.cell` results; `StepRef.kind` for selections).

Agreed with the owner before the core asks go out. It answers I3 and I4
directly, and every other track uses it.

Relates to: [10-object-model](../system_design/10-object-model.md),
[130](./130-reference-selection.md) (selection rules),
[008 K19, K28](../core-proposals/008-core-changes.md) (row ids, lineage).

### Track B — Editing the grid (I1, I2) · app (+ one system tool)

**Today:** the rules are written:
[134](./134-step-by-example-grid.md) maps Excel's gestures to formulas,
and [135](./135-cell-editing-rules.md) says when a change **augments** a
step, needs **Clear**, or makes a **new step** (§2a), plus the one-step
typed table (`table[mod.source()](data={…})`, run). None of it is built.

**What's missing:** building it, in 135's phases: the `table` source tool
(A), data entry and rows (B), columns (C), one example row → every row (D),
locks and "Make values" (E). Uploading a table is a `load_csv`-style
source, or a paste into a data step (135 §3.1).

**Depends on:** Track A for the Cell/Selection objects the gestures act on
(can start with today's `k.view` dict and switch).

### Track C — Data: lineage and keeping results (I5, I6) · both

**I6, row referencing — mostly app (run):** core already answers it.
`k.cell("t", 1)["inputs"]` gives the input step, row and values that
produced the cell (`[{step: 's', row: 1, values: {n: 2}, …}]`). The app
drops it ([134](./134-step-by-example-grid.md) P0, 133 §3). Deliverable:
pass it to the client; show it on cell select (the formula bar's second
line, 134 §5) and as the lineage gutter left of `#` (133 §2).

**I5, keeping results — core:** today a kernel is put away through a shim
(C32), only the latest output is kept (K22), and there is no resume:
`run(fresh=False)` means "run on what inputs show now", not "continue".
Per-row states exist (`known`, `failed`, …), which is what resuming needs.

Deliverables, as core asks:
- an **output store** keyed by data version (K22, C32), so put-away
  kernels keep outputs without the shim;
- **incremental runs, by row state** (decided, owner 2026-11-15): keep each
  row's result as it completes, and on re-run compute only rows not
  `known` (or whose inputs changed). "Whose inputs changed" is decided by
  **cell keys** ([019 §4.3](../spec/019-table-model.md)): one mechanism for
  incremental runs and for per-cell change in interactive sessions;
- **clearing outputs, as part of incremental runs** (owner, 2026-11-16;
  [019 §5.1](../spec/019-table-model.md)): Clear output / cells / failed
  cells remove those calls' results from the store, and the next run
  computes exactly what's missing or changed;
- **progress and cancel** (K23) for long steps.

### Track D — Structure: grouped steps, export, components (I7, I9, I10) · both

**I7, grouped steps — core:** nothing in core today (run; core's ask
[R9](../core-proposals/008-core-changes.md) calls them "stages"; the app's
name is **grouped steps**, owner 2026-11-16). **Decided (owner,
2026-11-15): grouped steps are a grouping of sequential steps**, there to
consolidate a part of the process and simplify how the workflow is
organized (loading/cleaning, analysis, summarizing/exporting). Not a
sub-workflow: it adds no inputs, outputs or computation. Each step keeps its
one line; a group is a named range in the workflow spec, shown folded as
one block that expands to its steps, and in exported code a section or a
notebook cell group. Deliverable: the spec field (a name and its steps),
raised with core, and the folded view in the UI.

**I10, export — app:** [132](./weekend_developments/132-workflow-export.md)
proposes `export_script()` (one `wf["step"] = …` line per step). Core
prints every step (`to_source()`, run). Deliverables: script (132), then
a **notebook** (one cell per step or per group; Databricks-ready when the
environment matches), then other frameworks as adapters over the same
spec. Grouped steps (I7) become the notebook's sections.

**I9, prefab components — both:** the pieces are partly planned:
[131](./weekend_developments/131-explore-widgets.md) (explore widgets that
are tools), [126](./126-formula-ui.md) (custom argument inputs), and core's
spec `extras` (K21, present as `k.extras`, run) for the app's UI hints.
Deliverable: one way to attach a UI to a tool, a resource type or a cell
type (`extras["simple_steps.ui"]` naming a component), with plots as the
first case.

### Track E — The agent (I8) · app

**Today:** [128](./weekend_developments/128-agent-workflow-builder.md) is
in progress (propose mode, one agent). Its output is formulas checked by
core ([traceable agentic development](../design_principles/traceable_agentic_development.md)).

**What's missing:** polish (to be listed by the owner: what feels wrong in
use), and **sub-agents**: a step agent that edits one step, scoped to that
step's inputs and the catalog, and returns one formula. It is the main
agent's proposal reduced to one step, so it reuses the same checks.

**Depends on:** Track A (a step agent reasons about a step's Grid and
Selections), Track C (it should see lineage when explaining a value).

### Across all tracks — the overlap a reactive app needs

**The question (owner, 2026-11-15):** the app must feel reactive (typing,
editing cells, dragging a fill handle answer at once), which suggests some
of core's work, like reading formulas, is duplicated in the browser. How
much, and under what rule?

**Today:** nothing is duplicated, and everything waits on the server. The
browser's `parseFormula`, `formatFormula` and `inferVerb`
(`frontend/src/utils/formulaParser.ts`) are each a `fetch` to the server,
where core reads the text. That's correct, but each keystroke's feedback
costs a round trip.

**The rule proposed: the browser may predict; core decides.** Work is split
into three tiers by how fast it must answer and whether it can be wrong:

| Tier | Answers in | Where | What | Can it be wrong? |
|---|---|---|---|---|
| **1. Instant** | the same frame | browser | Syntax only: tokens and colours (the Monaco language), bracket matching, reference spans for the coloured boxes, autocomplete from a catalog snapshot, rewriting a data step's literal as you type in its cells, marking later steps stale from the last known dependencies | Only cosmetically, and the next tier corrects it |
| **2. Fast** | ~100–200 ms, debounced | server, core | Meaning: does the formula parse, what are its parts, its problems, the verb core picks, the plan (shape before running) | No: this is the answer |
| **3. Run** | as long as it takes | server, core | Running, results, cell states, lineage | No |

**What may be duplicated (tier 1), and the guard on it:**

- **Allowed:** a small *presentation* reader in the browser, for syntax
  (tokens, spans, the parts the formula panel edits), and a printer for
  literals (a data step's `table(data={…})` as you type). The formula
  grammar is a subset of Python, so this is small and stable.
- **Never in the browser:** deciding whether a formula is valid or what it
  means, writing a problem message, choosing a verb, or computing a value.
  Those come only from core, so there is one implementation of meaning.
- **The guard: one shared conformance corpus.** A file of formulas with
  what each must give (tokens, spans, parts, valid or not), run by the
  frontend tests against the browser reader **and** by the backend tests
  against core. A disagreement fails a test, so the two can't drift. The
  56 cases in `core_migration_L1_messages.md` are the start of it.
- **Optimism is always visible:** a tier-1 guess (a stale mark, a
  re-coloured reference) is replaced by tier 2's answer when it arrives;
  nothing is saved or run on a guess.

This refines the standing rule "core reads formulas; the app adds only
what the UI needs": the browser reader is exactly that, what the UI needs
to be instant, tested against core so it never becomes a second meaning.

**Other overlaps that make it reactive:** a cached catalog snapshot
(`catalog.describe()`) for autocomplete and the palette; the last parse's
dependency list, to mark stale steps before the server confirms; and
`k.view` pages cached per step by their `view_key`.

**Deliverable (with P0):** the tier table agreed; the conformance corpus;
then the browser reader for tokens and spans (tier 1), behind the corpus.

---

## 3. How the tracks depend on each other

```text
            A  grid model (I3, I4)
          ╱    │      ╲        ╲
   B editing  C lineage  E agent  D components (I9)
   (I1, I2)   (I6)      (I8)
                │
           C keeping results (I5) ── D grouped steps (I7) ── D export (I10)
```

- **A first:** it is the vocabulary the others are written in. The specs
  (019, 020) are written; what core is asked to do is split in two (§5,
  refine first): small refinements now, and the call-key and
  reference-column redesign (K31, most of K32) only after a prototype.
- **C·I6 (lineage) and B (editing) can start in parallel with A**, on
  today's `k.view` dict; they switch to A's objects when core has them.
- **Grouped steps before notebook export:** a notebook's sections are the groups.
- **I5 is the largest core ask;** start it early so core can work on it
  while the app builds B and C·I6.

---

## 4. Phases

Each phase ships on its own and is confirmed with the owner first
([context.md](../context.md): core-driven changes confirmed piece by piece).

| Phase | What | Track | Owner |
|---|---|---|---|
| **P0** | The table model ([019](../spec/019-table-model.md)) and table mappings ([020](../spec/020-table-mappings.md)), decided (§5). Core refinements: flag the whole chain, a reader's own state `stale`, markers, clear/reset, F3, the chain rule, map settings (F2, F7), `StepRef.kind`, `call` in `k.cell`, unpivot/pivot, uneven data | A | spec, then core |
| **P0c** | Prototype call keys for `1 → 1` verbs on today's row ids: hashing cost, the determinism default, re-run counts (the 6 → 2 probe). Then decide the core redesign: K31 points 4 and 7, K32 points 1, 3, 5 and 7 | A, C·I5 | core |
| **P0b** | Reactivity tiers agreed; the shared conformance corpus; the browser's tier-1 reader (tokens, spans) behind it | all | app |
| **P1** | Row lineage on screen: plumb `k.cell` inputs; cell formula line; lineage gutter | C·I6 | app |
| **P2** | Editing, 135 phases A–C: `table` source, data entry, rows, columns, paste/upload | B | app |
| **P3** | Editing, 135 phases D–E: example row → every row, locks, Make values | B | app |
| **P4** | Keeping results: output store, incremental runs, progress/cancel (core asks K22, C32, K23 + new) | C·I5 | core, then app |
| **P5** | Grouped steps: the spec field; core ask; folded groups in the UI | D·I7 | core + app |
| **P6** | Export: script (132), then notebook by group | D·I10 | app |
| **P7** | Components: one way to attach a UI to a tool/resource/cell type; plots first (131) | D·I9 | app (+ K21) |
| **P8** | Agent: polish list; step sub-agent | E | app |
| **Ongoing** | Polish: UI fixes as found (small frontend fixes are made, not asked about) | — | app |

---

## 5. Decisions for the owner

**Decided (owner, 2026-11-15):**

- **Track A:** core makes the objects real; the definitions are very clear
  and say how each is used.
- **Grouped steps (I7):** a grouping of sequential steps, to consolidate a
  part of the process and simplify organization. Called "grouped steps",
  not "stages" (owner, 2026-11-16).
- **Incremental runs (I5):** by row state.

**Decided (owner, 2026-11-16):**

- **Refine first.** Core gets small refinements now (P0). The call-key
  redesign is prototyped (P0c) and decided separately; it is a core 2.0
  (a rough 1.5–3 months), not cleanup.
- **Row picks:** a saved `wf["f"][2]` keeps its position and checks the
  row's key ("reference moved" on a mismatch).
- **Selections:** stay `StepRef`, with a `kind`.
- **Determinism:** tools are deterministic by default; LLM, API and random
  tools declare otherwise.
- **Chains:** a tool step may add one no-tool reshape before its tool and
  one after; a reshape-only step (`identity`) chains any number.
- **map** keeps only its result (F1); a dict result spreads into columns by
  default, with a setting to keep one column (F2); result columns are named
  after the step (F7).
- **019 §7 defaults:** index never data; scattered cells UI-only; one level
  of provenance on screen; `maybe` shown as `pending`; plain marker names;
  a reader of a changed step is `stale`.
- **Reactivity tiers:** the browser may predict; core decides, with a shared
  conformance corpus.
- **Order:** P0, P0b and P0c first, with P1 and P2 alongside.

**Open:**

1. **Export targets (I10):** after script and notebook, which framework
   first?
2. **Agent polish (I8):** list what feels wrong in use, so P8 has concrete
   items.

---

## 6. Evidence (core 1.0.2 `dbaf4c7`, 2026-11-15)

Tools `nums() -> DataFrame` (column `n`), `dbl(n: int) -> int`; steps
`s = nums[mod.source()]()`, `t = dbl[mod.map()](wf["s"])`, then `run_all`.

| Probe | Result |
|---|---|
| `sorted(k.view("t"))` | `columns, formula, lineage, markers, row_count, rows, state, step, summary, window` |
| a row of `k.view` | keys `#, cells, lineage, position, state` |
| a cell of `k.view` | keys `state, type, value` |
| a column of `k.view` | `{name: 't', type: 'int', '#': 0}` |
| `k.cell("t", 1)` | keys `column, column_number, inputs, lineage, row, state, step, type, value`; `inputs = [{step: 's', columns: ['n'], argument: 'n', row: 1, state: 'known', values: {n: 2}, more: 0}]` |
| `type(wf["s"][0])`, `type(wf["s"][0][cols["n"]])` | both `StepRef` |
| `Kernel.run` docstring | `fresh=False` "runs it on what its inputs show now, on purpose" — not a resume |
| names containing "stage" on `Kernel` / `simple_steps_core` | none |
| `k.step("t").formula` | `dbl[mod.map()](wf["s"])` |
