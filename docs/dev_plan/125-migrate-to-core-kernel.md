# 125 — Migrating to core's kernel (core-handover branch)

> **Proposed**, 2026-10-27. Core: branch `core-handover` of
> `simple-steps-core` (checkout `~/Github/simple-steps-core`), at `61f31e2`.
> This repo is pinned to `86170a3`. Checked by running core at the new commit:
> `examples/kernel_session.py` runs end to end and core's test suite passes.
>
> Core's own checklist for the app is §5 of its
> [`docs/design/cleanup-plan.md`](https://github.com/stusynakowski/simple-steps-core/blob/core-handover/docs/design/cleanup-plan.md).
> This page maps it onto this repo's files, in order. Cleanup items (L1–L12,
> stages A–D) are in [`cleanup-map.md`](../cleanup-map.md) Round 4.

## Where core is

| Core phase | State | What the app gets |
|---|---|---|
| 1. Remove the older engine | done | `REGISTRY`, `register_tool`, the old `ResourceSpec` and `grid` are gone |
| 2. Split `grid.py` | done | modules along the object model |
| 3. Object model | done (3a–3e) | `Catalog`, `Kernel`, specs, `Problem` with codes, `step.state`, `extras`, `k.check`, `k.needs_run`, `k.on_change`, `insert`/`move`, isolation (K24), format v4 |
| 4. Behaviour | started (G13 landed) | K19, K20, K22, K23, K25–K29, R7–R9, … one at a time |

**Phase 3 is the migration point.** Phase 4 items arrive one by one after it,
each a small follow-up here.

## What it costs here (measured on the working tree)

- `grid.` names used: 31 distinct. `grid.Workflow` 60 times; the palette
  functions (`modifier_catalog` 14, `catalog` 6, `resource_entry` 6,
  `tool_entry` 5, `shape_verbs` 4, `builtin_tools`, `formula_names`,
  `MODIFIERS`, `TOOLS`, `RESOURCE_TYPES`, `freeze`) all become
  `Catalog.describe()`.
- Renamed fields read in the main files: `.tool_id` 20, `payload_column` 3,
  `.status` 3, `.step_id` 2, `.params` 2.
- Old-engine imports: `core_bridge.py` (`register_tool`, `REGISTRY`,
  `ResourceSpec`) and `main.py:139` (`REGISTRY`).
- **This repo's workflow files are unaffected.** They're the app's own format
  (`format_version: 2`, formulas as text). Only the kernels' snapshots on disk
  (`kernels._save`, core's `to_session_dict`) are in core's format, and core
  refuses old versions.

## Order of work

Each step ends with the checks: `pytest` (baseline 1 failure), `python
scripts/preflight.py`, `python src/SIMPLE_STEPS/examples/runme.py`.

| # | Work | Why this order |
|---|---|---|
| 0 | **Delete first** (cleanup-map Round 4, stage A and the L-items you approve): eval mode, the engine switch, unused routes; L4's old syntax and L10's per-step runs if approved | every line deleted is a line not ported. L4 and L10 hold most of the `grid.Workflow` uses outside the kernel |
| 1 | **Pin** core to the chosen `core-handover` commit in `pyproject.toml` and the submodule together; update the pin-drift symptom in `CLAUDE.md` and `context.md` to `cannot import name 'grid' from 'simple_steps_core'` | preflight enforces pin agreement |
| 2 | **Catalog.** `application.App` builds one `Catalog` (`Catalog(tools=…, resources=…)` or `from_modules`); `core_bridge.register_with_core` and `main.py:139` stop using `REGISTRY`; `@simple_step_tool` becomes core's `@tool` plus `extras["simple_steps.ui"]` (name, category), with no `StepProxy` | everything else reads the catalog |
| 3 | **Palette from `cat.describe()`** in `main.py` (`/api/operations`, `/api/modifiers`, `/api/resources`) and `agent/scope.py` | replaces 9 palette functions |
| 4 | **Host core's `Kernel`.** `kernels.Kernel` keeps key, lock, last-used and holds a core `Kernel`; drop its `formulas`, `operations`, `reads`, `uses`, `problems`, `ids`, `loaded`, and `summary()` for `k.step(n).state`, `.problems`, `k.needs_run()`. Old snapshots on disk are discarded (the kernel re-runs) | the biggest piece; the leak (`DATA_STORE`) stays until K22 |
| 5 | **Formulas as operations.** `operation_formula.py` builds `Operation.from_spec(spec, catalog)`; `agent/proposals.check_step` calls `k.check(name, op)` | one checker for UI, agent and terminal |
| 6 | **Renames** (core §5.6): `tool_id`→`tool`, `step_id`→`name`, `params`→`settings`, `status`→`state`, `payload`→`value_column`, `ToolHandle`→`Tool`, `ResourceDecl`→`Resource` | mechanical, last, once the code that remains is known |
| 7 | **Regenerate the probes**: `scripts/core_probes/` and `scripts/core_asks.py` import `grid` | they no longer run against core |
| 8 | **Phase 4 follow-ups**, as each lands in core: K22 (outputs by version; `ref_id` becomes the data version, the browser stops sending refs), K26 (pages, sizes), K28 (lineage in `/api/cell`), K23 (progress through `on_change`/callbacks), K19, K20, K29 | each is small once 2–5 are done |

## The formula parser: central, and thin

The parser stays in this repo (decision 3) and will carry a lot: references
(`wf["x"]`, `wf[index]`), selections of rows, columns and cells, literals,
modifiers, resources. It is the one door through which the UI and the agent
turn text into steps. So it should be **important and small** (owner,
2026-10-27):

- **Syntax only.** Text → an operation spec → `Operation.from_spec(spec,
  catalog)`. Python's `ast` does the parsing; the parser only maps the allowed
  node shapes to spec fields and refuses everything else.
- **Meaning stays in core.** Whether a step makes sense is `k.check(name, op)`.
  The parser never re-implements a core rule, so the two can't disagree.
- **A new feature starts in core.** If core accepts it in Python (`wf["r"][0]`,
  `rows`, `cols`), the parser only adds the mapping.

**References: notation, chips and boxes.** The reference UI planned in
[121 §1.4 and §1.6](121-ui-and-core-changes.md#14-how-it-should-look) (each
reference a coloured chip in the formula bar, matching a box drawn around the
cells it covers in the source grid) needs one thing from the parser: **for
each reference, where it is in the text and what it covers.** Python's `ast`
already gives every node its offsets, so this is a few lines, not a feature:

```json
{"references": [
  {"span": [27, 34], "step": "r"},
  {"span": [43, 64], "step": "r", "rows": [0], "columns": ["w"]}
]}
```

for `scale[mod.map()](wf["r"], weight=wf["r"][0][cols["w"]])`. The editor draws
a chip over each span, and the grid draws the box from step, rows and columns.
One source for both, so they can't disagree.

The notation, checked at core `61f31e2` (each prints back as typed with
`to_source()`, and runs, as its own step or as an argument):

| Pick | Writes |
|---|---|
| a whole step | `wf["r"]` (or `wf[-1]`, saved as the name: K30) |
| a column | `wf["r"][cols["n"]]` |
| rows | `wf["r"][0:2]` |
| a cell | `wf["r"][0][cols["w"]]` |
| a block | `wf["r"][0:2][cols["n"]]` |

`cols["n", "w"]` is refused; a list of names, `cols[["n", "w"]]`, is the
form core's message names. Rows are picked by position today; by row id once
K19 lands.

Two things in the editor today that this replaces: `shell/monacoSetup.ts:96`
colours only the old `step1.col` notation, not `wf["x"]`; and the three
copies of the picking tokens listed in [121 §1.1](121-ui-and-core-changes.md#11-what-happens-today).

What that removes from today's `operation_formula.py` (678 lines), checked in
the code:

| Today | Becomes |
|---|---|
| `_check_stack`: one shape verb per step, and verbs that take no tool | core's check |
| `_check_settings` (already calls `grid.check_modifier`) | core's check |
| `_reject_column_ref`: refuses `wf["x"][…]` | **removed**: selections are allowed (C1), and core supports them |
| catalog lookups through `grid.modifier_catalog()`, `grid.shape_verbs()` | `cat.describe()` |
| `_setting` (settings are literals), name/quote errors | kept: these are syntax |

## Decisions (owner, 2026-10-27)

| # | Question | Decided |
|---|---|---|
| 1 | Which core commit to pin | `core-handover` is merged to core's `main` shortly; pin a `main` commit then |
| 2 | Step identity | **the name is the identity**; references and hashes use names, and `insert`/`move` change a step's position. **Both `wf["name"]` and `wf[index]` work** in a formula; an index reference is saved by name. *Core today:* `k[0]`, `k[-1]` and `k.step(0)` work, but `wf[0]` in a formula is refused (*"a step reference takes a step id (a string), got 0"*): [008 K30](../core-proposals/008-core-changes.md#k30-wfindex-in-a-formula-saved-by-name) |
| 3 | Where the parser lives | in the app (accepted) |
| 4 | Delete L4 and L10 before migrating | yes |
| 5 | Old kernel snapshots | discard; the kernel re-runs |
| 6 | Core's §7 choices | the kernel is what you hold (below; agreed); `step.state` replaces `step.status`. **Agent permissions live in the app's `App` object**, not in a step and not in core's catalog extras: they sit above the steps you operate on |
| 7 | A kernel's catalog is fixed | yes: a new or changed tool means restarting the server. Resources bring their own tools (`res["db"].query`); their methods come with the resource *type*, which is in the catalog at boot, so loading a resource doesn't add code |

**"The kernel is what you hold", clarified.** In a terminal or notebook you
make one object, `k = Kernel(catalog)`, and do everything through it: declare
steps (`k["f"] = to_f[mod.map()](wf["p"])`), run them (`k.run_all()`), read
them (`k.step("f").data`, `k.cell(…)`, `repr(k)`), save and load
(`k.to_json()`, `Kernel.from_json(text, catalog)`). The workflow and the
catalog are inside it; you never pass them around separately. In the app,
`kernels.py` holds one `Kernel` per session and workflow, and adds only the
hosting: key, lock, last-used.
