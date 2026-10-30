# Dev plan — active plans

What we are changing next. Only active plans live here; when one is done or
superseded, what it decided moves to `../system_design/` or `../spec/` and the
plan moves to [`../archive/dev_plan/`](../archive/dev_plan/). The map of all
docs is [`../README.md`](../README.md). Code comments cite plans by number
(`dev_plan/124 phase 2`); a number not here is in `../archive/dev_plan/`.

| File | Status | What it covers |
|---|---|---|
| [`core_migration.md`](./core_migration.md) | **active** | Moving the app onto core 0.2.0 and its kernel: what's done (§8), what's open (§3.5 save/load), what follows as core lands; the earlier app-side steps and the owner's decisions (§9) |
| [`120-literals-and-references.md`](./120-literals-and-references.md) | rule, partly built | Only `wf["step"]` is a reference; everything else is a literal. The canonical `tool[modifiers](input, arguments)` form. Cited by `operation_formula.py` |
| [`122-skeleton-complete.md`](./122-skeleton-complete.md) | mostly built | Object model, resources, the agent, custom cell types. Cited by `application.py`, `resources.py`, `cell_types.py`, `agent/proposals.py` |
| [`126-formula-ui.md`](./126-formula-ui.md) | **active** | The formula UI: what each path writes today (run), the open items F1–F16 (writing formulas, references and selection, showing cells), and decision D1. Replaces the open parts of 121, 123, 124 and 125 |
| [`200-shell-infrastructure-plan.md`](./200-shell-infrastructure-plan.md) | active | The "Jupyter-on-VS-Code" shell: S0 done, phase A mostly done |

## Weekend developments

Larger plans for the next stretch of work, in [`weekend_developments/`](./weekend_developments/).

| File | Status | What it covers |
|---|---|---|
| [`127-file-io.md`](./weekend_developments/127-file-io.md) | **proposed** | Importing and exporting data in steps: a `Folder` resource (`files`, `read`, `write`), a ready-made `workspace`, exports that run only when run; and a security fix for the Explorer's path check |
| [`128-agent-workflow-builder.md`](./weekend_developments/128-agent-workflow-builder.md) | **proposed** | An agent (local model) that builds workflows: a closed action space (propose, load, invoke only what the workflow has), a five-state loop, six context layers with budgets, a task budget, propose and develop modes with a live activity feed; removing the unused LangGraph path first |
| [`129-multi-user-hosting.md`](./weekend_developments/129-multi-user-hosting.md) | **proposed** | One on-prem server, many isolated users: sign-in (local accounts or a proxy header), a home per user, a kernel host per user (in-process, subprocess or container), limits and an audit log; plain Linux with Python or conda, Docker optional; security fixes first |

## One-paragraph summary

A **step** holds one formula in core's syntax,
`tool[mod.verb(…)](wf["step"], arg=…)`, which is valid Python. The app's
parser (`operation_formula.py`) maps that text to a core operation spec and
nothing more; whether the step makes sense is core's check. A **workflow** is
the ordered, named steps; core's **kernel** holds the workflow, the catalog
and the outputs, one per session. The **UI's job** is to help the user write
a valid formula; the formula is the single source of truth. Details:
[`../system_design/10-object-model.md`](../system_design/10-object-model.md).
