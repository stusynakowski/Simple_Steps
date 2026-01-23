# 007 - UI Toolbar Expansion and Visibility Refinements

## Overview
This specification refines the top-level layout, specifically the tooling area above the workflow steps, and addresses critical visibility and usability issues within the operation components.

## 1. Resizable Tool/Header Area
### Requirement
- **Dynamic Resizing:** The area containing the global tools (Agent, Workflow Controls) and the Workflow Sequence below it must be separated by a **draggable divider** (sash).
- **Functionality:** Users should be able to drag this divider up or down to allocate more screen real estate to the tools or the workflow steps as needed.

## 2. Multi-Row Toolbar Organization
### Requirement
- **Structure:** The tools area at the top will be split into logical rows:
    - **Top Row (System):** Contains system-level operations such as `Load`, `Save`, `Environment Config`, and `Settings`.
    - **Bottom Row (Workflow context):** Contains workflow execution controls (`Run`, `Pause`) and the **Agent Widget**.
- **Agent Widget Placement:** 
    - The Agent Widget needs to be in this lower row, physically closer to the workflow steps, as it assists in step definition.
    - **Z-Index Fix:** Ensure the Agent Widget (and its mock/popups) is not obscured by other UI elements. It must have a higher z-index or proper stacking context to be fully visible when interacted with.

## 3. Step Minimization Behavior
### Requirement
- **Minimum Width:** When an Operation/Step column is minimized (collapsed), it must **not** shrink to an unreadable rectangle.
- **Content:** The minimized state must maintain sufficient width to clearly display the **Step Name**.
- **Visuals:** Maintain the header bar appearance or a summarized view that is legible.

## 4. "Add Step" Button Refinement
### Requirement
- **Label:** Change text from "Add New Operation" (or icon only) to **"Add Step +"**.
- **Shape:** The button should be strictly **rectangular**.
- **Position:** Continue to place it at the end of the step sequence, aligning with the design intent of the workflow flow.

## 5. Visual Contrast & Accessibility Fixes
### Requirement
- **Issue:** Information and controls inside the step widgets are currently invisible due to color clashes (Light Grey background with White text).
- **Specific Targets:**
    - **Step Controls:** Pause and Start/Play buttons on individual steps.
    - **Details Tabs:** "Operation Details" and "Status Details" tab headers.
- **Resolution:**
    - **Theme Update:** Ensure high contrast for these elements. 
    - **Example:** If the tab background is light grey, the text must be dark (e.g., `#333333` or black). If the text is white, the background must be significantly darker (e.g., dark grey or primary brand color).
