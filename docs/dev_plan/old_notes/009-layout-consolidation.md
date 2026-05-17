# 009 - Layout Consolidation & Widget Refinements

## Context
This plan implements the layout consolidation and widget updates defined in `spec/006-layout-and-widget-refinements.md`. It supersedes conflicting layout instructions from `008` (specifically regarding single-step expansion).

## Phase 1: Main Layout & Global Controls
- [ ] **Component Structure**
  - Modify `MainLayout.tsx` (or `App.tsx`) to split the top area.
  - Create a `ControlPanel` component effectively containing the `AgentWidget` and new controls.
  - **New Components:**
    - `RunWorkflowButton`: executes full sequence.
    - `PauseWorkflowButton`: pauses sequence.
    - `EnvironmentStatusWidget`: displays backend status.
    - `HolisticAnalysisWidget`: summary view.
- [ ] **Layout Styling**
  - Ensure the `AgentWidget` is no longer full-width.
  - Use Flexbox/Grid to arrange Agent + Controls in a single row/area.

## Phase 2: Consolidated Workflow Layout
- [ ] **State Management Update**
  - Update `useWorkflow` hook or parent state in `App.tsx`.
  - Change `selectedStepId` (string | null) to `expandedStepIds` (Set<string> or string[]).
  - Allow toggling: clicking a header adds/removes it from the set.
- [ ] **Gap Removal**
  - Update `WorkflowSequence.css`.
  - Remove `gap` property from the container.
  - Set margins on `OperationColumn` / `StepIcon` to 0.
- [ ] **Minimize Button**
  - Add a minimize/collapse button to the `OperationColumn` header.
  - Clicking it removes the ID from `expandedStepIds`.

## Phase 3: "Add Step" Button Repositioning
- [ ] **Relocation**
  - Remove the separate "Add Step" card/column from the end of the list.
  - Place a smaller "Add (+)" button to the immediate right of the last step's header.
  - Ensure it stays aligned with the header track even if the step content is expanded.

## Phase 4: Visual Contrast & Theming
- [ ] **Dark Mode Implementation**
  - Enforce dark background in `index.css`.
  - Update text colors to white (#fff) or light gray (#e0e0e0).
- [ ] **Widget Styling**
  - Target internal step buttons (Run/Pause).
  - Add explicit `background-color` (e.g., `#333` or `#444`) and `color: #fff`.
  - Verify contrast ratio.

## Verification
- Verify Agent widget shares space with new controls.
- Verify multiple steps can be expanded at once.
- Verify steps touch each other (no gaps).
- Verify "Add" button is next to the last header.
- Verify text is legible inside step widgets.
