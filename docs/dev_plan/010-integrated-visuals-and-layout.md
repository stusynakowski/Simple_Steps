# 010 - Integrated Visual Refinement & Layout Consolidation

## Overview
This plan consolidates the visual styling requirements from Spec 005 and the layout logic from Spec 006 into a single execution strategy. It supersedes previous visual/layout plans.

## Phase 1: Global Visual Theme (Dark Mode)
**Goal:** Establish a high-contrast dark theme to ensure widget legibility.
- [ ] **Color Tokens:** Update `src/styles/theme.ts` (or CSS variables) to define:
  - `bg-app`: Dark background (e.g., `#1e1e1e`).
  - `text-primary`: High contrast text (White/Off-white).
  - `bg-panel`: Slightly lighter dark for panels/widgets.
- [ ] **Global CSS:** Apply `bg-app` to the body/root in `index.css`.
- [ ] **Button/Widget Remediation:**
  - Update generic button styles to have visible borders or lighter backgrounds (`#333`) so "Run" and "Pause" are legible.

## Phase 2: Top Bar & Global Controls
**Goal:** Repurpose the top area for the Agent Widget and new app-level controls.
- [ ] **Layout Split:** Modify `MainLayout.tsx` and `TopBar.tsx`.
  - Grid/Flex layout: `[Agent Widget (Auto/Fixed)] [Control Bar (Flex Grow)]`.
- [ ] **Agent Widget Size:** Restrict `AgentWidget` max-width so it doesn't span the page.
- [ ] **New Controls Component:** Create `GlobalControls.tsx` containing:
  - `Run Workflow` Button (Play icon).
  - `Pause Workflow` Button (Pause icon).
  - `Backend Status` Indicator (Icon/Text).
  - `Holistic Analysis` Widget (Placeholder).

## Phase 3: Workflow Sequence Layout
**Goal:** A tight, consolidated stream of operations with multi-select capability.
- [ ] **State Logic:**
  - Refactor `useWorkflow` or `App` state to support `expandedStepIds` (Set/Array) instead of single `selectedStepId`.
  - Allow toggling multiple steps open.
- [ ] **Zero-Gap Container:**
  - Update `WorkflowSequence.css`.
  - Remove `gap` between columns.
  - Implement "Arrow" shape headers (from Spec 005) that visually interlock.
- [ ] **Operation Column Updates:**
  - **Minimize Button:** Add a distinct minimize icon/button to the header.
  - **Sliver State:** When collapsed, the column should be a vertical sliver (20-40px) or just the arrow header.
  - **Styles:** Ensure expanded columns retain dark theme legibility.

## Phase 4: Distinct Step Colors
**Goal:** Visual separation of tight steps.
- [ ] **Color Generator:** Implement a utility to assign a unique color per step index (Blue, Purple, Green, etc.).
- [ ] **Apply to Header:**
  - The "Arrow" header background takes the step's assigned color.
  - The column border (if visible) matches the step color.

## Phase 5: "Add Step" Button Placement
**Goal:** Integrate the specific "Add" action into the flow.
- [ ] **Remove Old Card:** Delete the large "Add Step" column at the end of the sequence.
- [ ] **New Button:**
  - Render a small `(+)` button immediately to the right of the *last* step's header.
  - It should float or attach to the header track, occupying distinct "empty space" to the right.

## Verification Checklist
1. App is dark mode; text is readable.
2. Agent widget is compact; Run/Pause/Status controls are visible next to it.
3. Steps touch (no gaps) with interlocking arrow headers.
4. Multiple steps can be expanded simultaneously.
5. Minimize button works on step headers.
6. "Add Step" button is small and located next to the last header.
