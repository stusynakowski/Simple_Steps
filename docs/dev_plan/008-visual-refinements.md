# 008 - Visual Refinements & Layout Updates

## Context
This plan implements the visual changes defined in `spec/005-visual-refinements.md`, focusing on high contrast, distinct step validation, aggressive layout resizing, and arrow-shaped headers.

## Phase 1: High Contrast & Theme Updates
- [ ] **Global Dark Theme**
  - Update `index.css` or `App.css` to set a dark background (e.g., `#1e1e1e` or darker) as the default application background.
  - Update text colors to white/off-white for readability.
- [ ] **Widget & Button Contrast**
  - Update `AgentWidget.css` and general button styles.
  - Ensure buttons have high-contrast borders or background colors that pop against the dark theme.

## Phase 2: Step Color System
- [ ] **Color Utility**
  - Create a utility function or defined array of distinct colors in `src/styles/theme.ts` (or similar) to cycle through for steps.
  - Alternatively, add a `color` property to the `Step` model or derive it from the step index.
- [ ] **Apply Colors**
  - Update `OperationColumn` to read the assigned color.
  - Apply this color to the column borders (if visible) or the header background.

## Phase 3: Arrow Headers
- [ ] **Arrow Shape Implementation**
  - Modify `OperationColumn` header structure.
  - Use CSS `clip-path` or exact borders (`border-left`, `border-top`, `border-bottom`) to create a "sharp right arrow" shape.
  - Ensure the arrow points visually into the next column.
- [ ] **Header Integration**
  - Apply the Step Color (from Phase 2) to the arrow shape background.
  - Ensure text fits within the arrow shape without being cut off.

## Phase 4: Aggressive Compressed Layout
- [ ] **Layout Logic Update**
  - Update `WorkflowSequence.tsx` (the container).
  - Implement a layout state that distinguishes between `Default` (even distribution) and `Focused` (one large, others tiny).
- [ ] **Sliver State**
  - Define a min-width for the "collapsed/sliver" state (e.g., `40px`).
  - When a step is selected (`selectedStepId` is present), set the grid template or flex basis such that the active column takes available space (e.g., `1fr`) and others are fixed to the sliver width.
- [ ] **Content Hiding**
  - Ensure that when a column is in "sliver" mode, its internal content (list of items, buttons) is hidden or opacity-reduced, showing only the vertical color bar or a rotated label.

## Verification
- Verify visibility of buttons in dark mode.
- Verify each step has a unique color.
- Verify headers look like arrows connecting steps.
- Verify clicking a step expands it largely while compressing others to slivers.
