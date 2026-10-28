# 005 - Visual Refinements & Layout Updates

## Overview
This specification outlines visual styling changes and layout behavior updates to improve usability, distinctiveness of steps, and focus management within the workflow.

## 1. High Contrast & Visual Theme
### Requirement
- **Objective:** Improve visibility of operations and widget buttons.
- **Preference:** Dark background.
- **Implementation:**
  - The main application background or the column track background should use a dark theme to enable high contrast for content.
  - "Operations" and "Widget Buttons" must pop against the background. Use high-contrast foreground colors (e.g., specific border colors or bright button fills) to ensure they are easily distinguishable.

## 2. Step Color Coding
### Requirement
- **Objective:** Visually distinguish adjacent steps.
- **Implementation:**
  - Each step in the sequence should have a unique or distinct color.
  - Colors should be applied to the step header/arrow and potentially the border of the column to separate it from neighbors clearly.

## 3. Aggressive Column Squeezing (Accordion Layout)
### Requirement
- **Objective:** Maximize screen real estate for the active (expanded) step.
- **Behavior:**
  - When a user expands a specific step (triggering the `StepDetailView` or expanded state):
    - The active column expands to fill the majority of the view.
    - All other non-active `OperationColumn`s must compress significantly.
  - **Collapsed State Dimensions:** The collapsed columns should reduce to a "small sliver" — the absolute minimum width necessary (e.g., 20px - 40px), effectively just showing a vertical color bar or collapsed header.

## 4. Directional Step Headers
### Requirement
- **Objective:** Reinforce the linear left-to-right flow of the data.
- **Style:**
  - The header block for each step name must be styled as a **sharp right-pointing arrow** (chevron/arrow shape).
  - The distinct step colors (from Req #2) should fill this arrow shape.
  - Use CSS `clip-path` or SVG shapes to create a sharp point that visually "points" into the next step column.
