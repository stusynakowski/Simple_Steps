# ADR 004: Data Handling Strategy (Reference Passing)

## Context
The system will handle large datasets ("productionize workflows at scale"). Transferring entire datasets from the backend to the frontend browser memory is unfeasible due to bandwidth and memory constraints.

## Decision
We will adopt a **Reference Passing** strategy. 
- The backend maintains the full state of the data.
- "Steps" pass references (e.g., DataFrame IDs) to each other.
- The Frontend requests only specific "viewports" or slices of data necessary for the current screen (Output Grid).

## Consequences
**Positive:**
- **Scalability:** The UI implementation is decoupled from the actual size of the data.
- **Performance:** Initial load times are fast because only metadata is fetched.

**Negative:**
- **Complexity:** Requires implementing pagination, virtualization, or windowing logic in the API and UI.
- **State Sync:** Ensuring the backend data state matches the frontend's view reference requires careful synchronization, especially for long-running async processes.
