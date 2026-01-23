# 006 - Layout Consolidation & Widget Refinements

## Overview
This specification details layout adjustments to the main Agent container, the Workflow operations list, and visual styling fixes to ensure text readability.

## 1. Agent Container & Global Controls
### Requirement
- **Objective:** Reduce the footprint of the Agent Container and introduce global workflow controls.
- **Layout:**
  - The Agent Container should **not** span the entire width of the page.
  - It should share space with or allow room for new global widgets.
- **New Widgets:**
  - **Functionality:**
    - **Run Workflow:** specific button to execute the entire sequence.
    - **Pause Workflow:** specific button to pause execution.
    - **Backend Status:** display general status about the backend environment.
    - **Holistic Analysis:** a summary view or widget for data analysis.
- **Placement:** These widgets should be positioned alongside the Agent Container (e.g., in a dashboard header row or a dedicated sidebar) rather than expanding the Agent Container to full width.

## 2. Consolidated Workflow Layout
### Requirement
- **Objective:** Create a tight, cohesive horizontal sequence of operations.
- **Spacing:**
  - **Zero Gap:** Remove all spacing/margins between individual Operation Columns. They should touch visually.
  - **Consolidated View:** The layout moves strictly left-to-right.
- **Expansion Behavior:**
  - **Multi-Expand:** Users can have multiple operations expanded simultaneously. (This supersedes previous "accordion" logic where only one was active).
  - **Minimize:** Each operation header must include a **Minimize Button** (- or similar icon) to manually collapse the step content, leaving only the header/sliver.

## 3. "New Operation" Placement
### Requirement
- **Position:** 
  - The button to add a new step must be located **immediately to the right of the last step's header**.
  - It should occupy the "empty space" at the end of the header row, rather than being a standalone full-height column.
- **Visuals:** Should be distinct but physically attached or aligned with the header track.

## 4. Visual Contrast & Accessibility
### Requirement
- **Objective:** Fix readability issues for widget text (specifically "Run" and "Pause" inside steps).
- **Issue:** Current text contrast is too low against the background.
- **Implementation:**
  - **Backgrounds:** use a darker background for the widget container or the specific buttons.
  - **Typography:** Change font color (e.g., to white or brighter accent) or font weight to ensure controls are clearly visible.
