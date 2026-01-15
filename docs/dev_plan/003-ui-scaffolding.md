# Development Step 3: UI Scaffolding & Shell

## Goal
Create the main application layout including global controls and placeholders for the major regions defined in `docs/spec/000-overview.md` and `docs/spec/001-ui-components.md`.

## Key Actions
1. **Global Control Bar:**
   - Create `TopBar` component.
   - Add buttons for "Load", "Save", "Settings".

2. **Agent Widget:**
   - Create `AgentWidget` component.
   - Position it near the top (below or integrated with TopBar).
   - Add basic text input or interaction area (mocked).

3. **Main Layout Container:**
   - Create a layout shell that divides the screen vertically:
     - Header (TopBar + Agent).
     - Workflow Visualizer Area (Placeholder).
     - Step Detail Area (Placeholder).

## Verification
- The app renders the header and empty content areas.
- Layout is responsive and stable.
