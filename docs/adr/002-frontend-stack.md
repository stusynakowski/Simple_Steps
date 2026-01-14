# ADR 002: Frontend Technology Stack

## Context
The application requires a highly interactive User Interface capable of rendering large tabular datasets efficiently. We need a framework that supports complex state management for the workflow logic and a specialized library for the data grid performance.

## Decision
We will use **React** as the core UI framework and **Glide Data Grid** for the tabular data components.

## Consequences
**Positive:**
- **Performance:** Glide Data Grid is optimized for rendering millions of rows, which meets our scalability needs.
- **Ecosystem:** React has a vast ecosystem of tools and libraries for state management and component design.
- **Modularity:** Component-based architecture suits the "Step" and "Widget" design requirements well.

**Negative:**
- **Complexity:** Managing the interface between React state and the canvas-based Glide Data Grid can be complex.
- **Learning Curve:** Developers need proficiency in React and potentially the specific API of Glide.
