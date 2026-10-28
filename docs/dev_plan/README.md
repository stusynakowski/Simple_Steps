# Dev plan — active plans

What we are changing next. Only active plans live here; when one is done or
superseded, what it decided moves to `../system_design/` or `../spec/` and the
plan moves to [`../archive/dev_plan/`](../archive/dev_plan/). The map of all
docs is [`../README.md`](../README.md).

| File | Status | What it covers |
|---|---|---|
| [`core_migration.md`](./core_migration.md) | **active** | Moving the app onto core 0.2.0 and its kernel: what's done (§8), what's open (§3.5 save/load), what follows as core lands |
| [`120-literals-and-references.md`](./120-literals-and-references.md) | rule, partly built | Only `wf["step"]` is a reference; everything else is a literal. The canonical `tool[modifiers](input, arguments)` form. Cited by `operation_formula.py` |
| [`121-ui-and-core-changes.md`](./121-ui-and-core-changes.md) | partly done | Formula-bar and reference-picking changes U1–U9, with evidence |
| [`122-skeleton-complete.md`](./122-skeleton-complete.md) | mostly built | Object model, resources, the agent, custom cell types. Cited by `application.py`, `resources.py`, `cell_types.py`, `agent/proposals.py` |
| [`123-tool-picker-discrepancy.md`](./123-tool-picker-discrepancy.md) | **open** | The formula-bar autocomplete writes the retired `tool.type(` form; the Formula panel writes core syntax |
| [`124-core-009-integration.md`](./124-core-009-integration.md) | largely superseded | Core 009 and the spec-014 grid, in six phases |
| [`125-migrate-to-core-kernel.md`](./125-migrate-to-core-kernel.md) | decided, in progress | The kernel move's costs, order, the thin formula parser, and the owner's decisions of 2026-10-27 |
| [`200-shell-infrastructure-plan.md`](./200-shell-infrastructure-plan.md) | active | The "Jupyter-on-VS-Code" shell: S0 done, phase A mostly done |

## One-paragraph summary

A **step** holds one formula in core's syntax,
`tool[mod.verb(…)](wf["step"], arg=…)`, which is valid Python. The app's
parser (`operation_formula.py`) maps that text to a core operation spec and
nothing more; whether the step makes sense is core's check. A **workflow** is
the ordered, named steps; core's **kernel** holds the workflow, the catalog
and the outputs, one per session. The **UI's job** is to help the user write
a valid formula; the formula is the single source of truth. Details:
[`../system_design/10-object-model.md`](../system_design/10-object-model.md).
