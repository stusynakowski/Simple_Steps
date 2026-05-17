# Development Step 7: Dynamic Columnar Layout Implementation

## Goal
Refactor the application layout to implement the "Dynamic Columnar" workflow as defined in `docs/spec/004-dynamic-columns.md`. This involves moving from a horizontal step sequence + bottom detail view to a unified vertical column per operation.

## Key Actions

### 1. New Layout Architecture
-   **Main Container**:
    -   Replace the split view (Sequence on top, Details on bottom) with a single horizontal flex/grid container.
    -   Ensure horizontal scrolling support for workflows with many steps.
-   **State Management**:
    -   Update `useWorkflow` or local state to track `activeStepId` (focused column).
    -   Implement logic to calculate column widths (e.g., `flex-grow` or specific widths) based on the active state.

### 2. Operation Column Component
-   Create a new `OperationColumn` component that encapsulates:
    -   **Header Area**:
        -   Display Operation Name.
        -   Display Status Indicator directly below the name (refactoring `StepIcon`).
    -   **Mini Toolbar**:
        -   Implement compact Run/Pause controls visible within the column.
    -   **Expandable Sections**:
        -   Create collapsible container components for "Operation Details" and "Status Details".
        -   Connect visibility to the column's focused state.
    -   **Data List View**:
        -   Create a vertical list renderer for the column's output.
        -   Replace the global `DataOutputGrid` with this per-column visualization.

### 3. Interaction Dynamics ("Explosion" Effect)
-   **Focus Interaction**:
    -   Clicking a column sets it as active.
-   **Sizing & Transitions**:
    -   Implement CSS transitions for `width`, `flex-grow`, and `opacity`.
    -   **Active State**: Column expands to fill available space (or fixed wide width). Details and Toolbar become visible.
    -   **Inactive State**: Columns shrink to a summary view. Details hide. Data simplifies or hides.

### 4. Component Migration
-   Migrate specific controls from `StepDetailView` into the new Expandable Sections of `OperationColumn`.
-   Update `WorkflowSequence` to render a list of `OperationColumn` components instead of just icons.

## Verification
-   Workflow displays as a series of side-by-side vertical columns.
-   Clicking a column expands it and shrinks neighbors smoothly.
-   Status is visible under the operation name.
-   Data is displayed vertically within the column context.
