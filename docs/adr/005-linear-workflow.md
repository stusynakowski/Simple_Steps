# ADR 005: Linear Workflow Abstraction

## Context
Users (specifically non-technical domain experts) need to understand and manage complex processes. A fully general graph (DAG) can be visually overwhelming and difficult to configure without technical knowledge.

## Decision
We will model the workflow as a **Linear Sequence of Steps**, visualized as a left-to-right flow.

## Consequences
**Positive:**
- **Clarity:** It is immediately intuitive to users familiar with "start to finish" processes.
- **UI Simplicity:** Visualizing a list of items is significantly easier than building a graph editor.

**Negative:**
- **Flexibility:** Limits the ability to express complex parallel branching or merging logic without specific workarounds (e.g., compound steps).
- **expressiveness:** Some real-world data pipelines are inherently non-linear.
