# Dev Plan — Current Architecture

> Status: active as of 2026-05-16
> Previous plan notes are archived in `./old_notes/`.

This directory holds the small set of notes that describe **how Simple Steps
is intended to work today**. The earlier numbered notes (`001-` through
`011-`) described an older "operation + configuration" model; that model has
been superseded by the unified-expression model documented here.

## Index

| File | What it covers |
|---|---|
| [`100-architecture.md`](./100-architecture.md) | The mental model: formulas, steps, workflows, sessions, and the registry. |
| [`101-formula-language.md`](./101-formula-language.md) | What is and isn't allowed in a formula. The safe-AST interpreter. |
| [`102-workflow-and-session-shapes.md`](./102-workflow-and-session-shapes.md) | Canonical data shapes for workflows on disk and sessions in memory. |
| [`103-ui-as-formula-formulator.md`](./103-ui-as-formula-formulator.md) | What the UI is responsible for, framed as "help the user write a valid formula." |
| [`104-equals-sign-convention.md`](./104-equals-sign-convention.md) | Where the leading `=` lives and where it doesn't. |
| [`105-validation-flow.md`](./105-validation-flow.md) | How validation flows between UI and backend, and what "commit on run" means. |
| [`117-referencing-previous-steps.md`](./117-referencing-previous-steps.md) | Suggestions for the step-reference selection UI (Excel-style cell/row/column/range picking). |
| [`118-console-and-gui-parity.md`](./118-console-and-gui-parity.md) | Plan for a console, and for keeping GUI actions and console commands in exact correspondence. |
| [`119-grid-integration.md`](./119-grid-integration.md) | Step execution on simple-steps-core's grid model: how a UI step becomes a core operation, what changed for users, and what is still shimmed. |
| [`120-literals-and-references.md`](./120-literals-and-references.md) | The rule that only `wf["step"]` is a reference and everything else is a literal; the canonical `tool[modifiers](input, arguments)` formula; requirements, tests and asks for core. |
| [`121-ui-and-core-changes.md`](./121-ui-and-core-changes.md) | What to change in the UI (reference picking, the formula bar), in core, and in the app backend, with the evidence for each and an order of work. |
| [`122-skeleton-complete.md`](./122-skeleton-complete.md) | **Draft.** The four pieces that complete the skeleton (object model, resources, the agent, custom cell types), the decisions to settle first, and what's deferred to cleanup. |

## One-paragraph summary

A **step** owns one Python **expression**. That expression is built only out
of registered functions, references to earlier steps (`step1["col"]`),
and literals. Running the expression produces an **output value** (typically
a DataFrame or Series) that is bound to the step's name and made available
to later steps. A **workflow** is just an ordered list of these
`(step_name, expression)` pairs. A **session** is a workflow plus the
materialised outputs of any steps that have already run. The **UI's only
job** is to help the user construct a valid expression for each step.
