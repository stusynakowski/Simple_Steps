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

## One-paragraph summary

A **step** owns one Python **expression**. That expression is built only out
of registered functions, references to earlier steps (`step1["col"]`),
and literals. Running the expression produces an **output value** (typically
a DataFrame or Series) that is bound to the step's name and made available
to later steps. A **workflow** is just an ordered list of these
`(step_name, expression)` pairs. A **session** is a workflow plus the
materialised outputs of any steps that have already run. The **UI's only
job** is to help the user construct a valid expression for each step.
