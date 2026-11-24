# Dev plan — active plans

What we are changing next. Only active plans live here; when one is done or
superseded, what it decided moves to `../system_design/` or `../spec/` and the
plan moves to [`../archive/dev_plan/`](../archive/dev_plan/). The map of all
docs is [`../README.md`](../README.md). Code comments cite plans by number
(`dev_plan/124 phase 2`); a number not here is in `../archive/dev_plan/`.

| File | Status | What it covers |
|---|---|---|
| [`core_migration.md`](./core_migration.md) | **active** | Moving the app onto core v1.0.1 (`fed4d1a`), now on v1.0.2 (`dbaf4c7`): refine, not refactor. Each core refinement and the app's small adjustment (§1, run), the gates (§2), what waits for its own decision, such as core's `formula()` in place of the app's parser (§3). Earlier moves: [`../archive/dev_plan/core_migration/`](../archive/dev_plan/core_migration/) |
| [`120-literals-and-references.md`](./120-literals-and-references.md) | rule, partly built | Only `wf["step"]` is a reference; everything else is a literal. The canonical `tool[modifiers](input, arguments)` form. Cited by `operation_formula.py` |
| [`122-skeleton-complete.md`](./122-skeleton-complete.md) | mostly built | Object model, resources, the agent, custom cell types. Cited by `application.py`, `resources.py`, `cell_types.py`, `agent/proposals.py` |
| [`126-formula-ui.md`](./126-formula-ui.md) | **active** | The formula UI: what each path writes today (run), the open items F1–F16 (writing formulas, references and selection, showing cells), and decision D1. Replaces the open parts of 121, 123, 124 and 125 |
| [`130-reference-selection.md`](./130-reference-selection.md) | **proposed** | Selecting data from earlier steps, to the owner's rules R1–R9: rows are positions and `#` is `0..n-1`; `#<step>` lineage columns behind an expander; `#` columns never data; `var<n>` column names; many spellings; selection as input; row alignment needs join/zip. Q1–Q4 open |
| [`133-step-and-data-ux-notes.md`](./133-step-and-data-ux-notes.md) | **notes** | The owner's UX notes on a step and its data (N1–N4): show less; the data expander as part of the grid's header (`Data > / wf["step"] \ size`) with a collapsed lineage gutter; writing an empty step by editing its cell, locked after a run; ambiguous referencing. Core 1.0.2 lineage facts, open questions |
| [`134-step-by-example-grid.md`](./134-step-by-example-grid.md) | **proposed** | Defining a step from its data grid, as in Excel, to the owner's rules R-A (every grid widget maps to the formula bar), R-B (one formula, one step output) and R-C (the formula bar shows the selected cell's own call). Excel's toolbox mapped to core formulas (G1–G23, run against core), what the rules constrain (typed tables, K1), core gaps C1–C6, phases P0–P6, decisions Q1–Q6 |
| [`135-cell-editing-rules.md`](./135-cell-editing-rules.md) | **proposed** | When a step's cells can be edited (E1–E9), and when a change augments the step, needs Clear, or makes a new step (§2a): only empty and data steps take typed values; every edit rewrites the one expression; a tool call is a new step, one row then mapped to all. Typed tables in one step via a `table` source tool (resolves 134 K1 without core) |
| [`136-consolidation-plan.md`](./136-consolidation-plan.md) | **proposed** | The owner's consolidation list (I1–I10) in five tracks: A grid model (what a grid, cell, row, column and selection are; core has only a view dict), B editing (134/135), C lineage and keeping results, D grouped steps/export/components, E agent; the app↔core overlap a reactive app needs (browser predicts, core decides; a shared conformance corpus); dependencies, phases P0–P8, decisions |
| [`137-ui-components.md`](./137-ui-components.md) | **proposed** | UI components with the tools as they are: one set of built-in renderers chosen from Python. Argument widgets via `@simple_step_tool(ui=…)`, `matrix` and sandboxed `html` view kinds for cell types, explore tools on a selection (131), resource settings widgets and a panel; phases C1–C5 |
| [`138-runs-and-big-data.md`](./138-runs-and-big-data.md) | **in progress**: N0, N1, cancel built | A run never blocks the app (run: a run froze every user's requests for 5 s); `async def` tools stored as coroutines (core C48); progress and cancel; one copy of each output; each step saved to disk (`result_store` memory/disk/auto), reopened without re-running; images served on demand. App-only fixes now, core's versions taken when they land; phases N0–N3, B1–B4 |
| [`139-interactive-panels.md`](./139-interactive-panels.md) | **proposed, deferred** | Interactive panels: a developer attaches a `panel(ui, ctx)` function (Streamlit-style, rerun on each change) to a tool, resource or cell type. Talk to an LLM, browse a filesystem or database, try a tool on a pick, then hand off as a formula to confirm. Panel runs are jobs (138); the function lives in the app's registry (core extras are literals only); tools are tried in a scratch kernel. Alternatives, 8 decisions, REQ-PNL-001–012, phases P1–P5 |
| [`140-core-1.0.3.md`](./140-core-1.0.3.md) | **active** | Moving onto core 1.0.3 (`adfaf87`): runs bring steps up to date (*Run again* is `force=True`), sessions saved as core's folder (C32 replaced), C37 deleted, C36 kept; stages and bulky cells on disk later. Big-session asks of core: [`../core-proposals/014-asks-at-adfaf87.md`](../core-proposals/014-asks-at-adfaf87.md) |
| [`141-step-groups.md`](./141-step-groups.md) | **proposed** | Step groups (core's stages): a grouped step's header split in two, the shared group half on top in the group's colour; folds to one header with a parallelogram per step; the group popover runs it (`run_stage`, *Run again*) and holds its notes; made by selecting headers; shown on the steps' map. REQ-GRP-001–011, phases G1–G6, five decisions |
| [`200-shell-infrastructure-plan.md`](./200-shell-infrastructure-plan.md) | active | The "Jupyter-on-VS-Code" shell: S0 done, phase A mostly done |

## Weekend developments

Larger plans for the next stretch of work, in [`weekend_developments/`](./weekend_developments/).

| File | Status | What it covers |
|---|---|---|
| [`127-file-io.md`](./weekend_developments/127-file-io.md) | **proposed** | Importing and exporting data in steps: a `Folder` resource (`files`, `read`, `write`), a ready-made `workspace`, exports that run only when run; and a security fix for the Explorer's path check |
| [`128-agent-workflow-builder.md`](./weekend_developments/128-agent-workflow-builder.md) | **in progress**: A0, M1, M2, A2, A2b, A3 (propose mode), A5 done | An agent (local model) that builds workflows: a closed action space (propose, load, invoke only what the workflow has), a five-state loop, six context layers with budgets, a task budget, propose and develop modes with a live activity feed; removing the unused LangGraph path first |
| [`131-explore-widgets.md`](./weekend_developments/131-explore-widgets.md) | **proposed** | Widgets to explore a step's data that are also tools: an Explore category (`plot`, `heatmap`, `matrix_image`, `describe`, `value_counts`) invoked on a selection in the selection inspector, outside any step (making it a step is optional, later); a matrix cell type that shows numeric arrays as images; a core ask for a one-off run |
| [`132-workflow-export.md`](./weekend_developments/132-workflow-export.md) | **proposed** | Export a workflow as a Python script, one `wf["step"] = …  # step: label` line per step, to run without the app (Databricks, jobs): `export_script()` with imports from the catalog and resources as `wf.define`; `simple-steps export`, an Export item on the toolbar popover; proven by running the export against each shipped example in `runme.py` |
| [`129-multi-user-hosting.md`](./weekend_developments/129-multi-user-hosting.md) | **proposed** | One on-prem server, many isolated users: sign-in (local accounts or a proxy header), a home per user, a kernel host per user (in-process, subprocess or container), limits and an audit log; plain Linux with Python or conda, Docker optional; security fixes first |

## One-paragraph summary

A **step** holds one formula in core's syntax,
`tool[mod.verb(…)](wf["step"], arg=…)`, which is valid Python. **Core reads
the text** (`simple_steps_core.formula`); the app's `operation_formula.py`
only adds what the UI needs (reference positions, the step editor's parts).
Whether the step makes sense is core's check, on Enter. A **workflow** is
the ordered, named steps; core's **kernel** holds the workflow, the catalog
and the outputs, one per session. The **UI's job** is to help the user write
a valid formula; the formula is the single source of truth. Details:
[`../system_design/10-object-model.md`](../system_design/10-object-model.md).
