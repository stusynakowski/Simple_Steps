# Development Step 5: Step Detail View & Grid Integration

## Goal
Build the detailed inspection view that appears when a step is selected, featuring the control toolbar and the data output grid.

## Key Actions
1. **Detail Container:**
   - Create `StepDetailView` component.
   - Display it only when a step is selected.

2. **Operation Toolbar:**
   - Create `StepToolbar` component.
   - Add controls: Configuration inputs (based on JSON config), "Run" button, "Delete" button.
   - Display current status text.

3. **Glide Data Grid:**
   - Integrate `@glideapps/glide-data-grid`.
   - Create `DataOutputGrid` component.
   - Map the `Cell`/`output_preview` data from the selected Step to the Grid's required format.
   - specific implementation:
     - `getData` callback for the grid.
     - Column definitions.

## Verification
- Selecting a step reveals the detail view.
- The Glide Grid renders the mock data associated with that step.
- Toolbar buttons are visible and click events are logged.
