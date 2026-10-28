# Specification: UI Components

## 1. Workflow Visualizer (Step Sequence)
**Description:** The main visualization component displaying the linearity of the process.
- **Layout:** Horizontal strip near the top of the main page.
- **Item Representation:** Arrow-shaped icons flowing left-to-right.
- **Interaction:**
  - Click to select/expand a step.
  - Controls to insert a new step between existing ones.
  - Context menu (or button) to delete a step.

## 2. Step Detail View
**Description:** The expanded view appearing below the selected step.
- **Visibility:** Toggled by clicking a Step Icon.
- **Components:**
  - **Operation Toolbar:**
    - Menu options specific to the Step's process type.
    - Configuration controls (parameters for the Python script).
    - Execution capability ("Run Step").
    - Status Indicator (Idle, Processing, Done, Error).
  - **Output Data Grid:**
    - A columnar view of cells representing the step's output.
    - **Interaction:** Cells are clickable for detailed inspection.
    - **Performance:** Must handle rendering of large outputs (virtualization if needed).

## 3. Agent Widget
**Description:** An intelligent assistant interface.
- **Location:** Fixed or floating widget near the top of the viewport.
- **Functionality:**
  - Suggests next steps.
  - Explains errors.
  - Facilitates complex operations via natural language (simulated/actual).

## 4. Global Control Bar
**Description:** High-level application controls.
- **Location:** Above the Step Sequence.
- **Items:**
  - **File Operations:** Load Workflow, Save Workflow.
  - **Settings:** API endpoint config, Theme, UI preferences.
  - **Help:** Documentation access.

## 5. UI Framework / Libraries
- **React:** Core library.
- **Glide Data Grid:** For high-performance tabular data rendering.
- **Styling:** CSS Modules or Styled Components (TBD).
