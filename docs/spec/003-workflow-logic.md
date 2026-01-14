# Specification: Workflow Logic

## 1. Step Management
### Adding a Step
- **Action:** User clicks "+" button between steps or at the end.
- **Logic:** 
  1. New Step object created with default status "pending".
  2. Inserted into Workflow's `steps` array.
  3. UI re-renders Step Sequence.

### Modifying a Step
- **Action:** User changes configuration in Toolbar.
- **Logic:**
  1. Update `step.configuration`.
  2. Invalidate `step.status` (set to "pending") if input changed.
  3. Clear previous outputs if necessary.

### Removing a Step
- **Action:** User selects Delete.
- **Logic:**
  1. Remove Step from array.
  2. Update `sequence_index` of subsequent steps.
  3. (Optional) Invalidate downstream steps if dependencies exist.

## 2. Execution Flow
- **Trigger:** User clicks "Run" on a specific step or "Run All".
- **Process:**
  1. Frontend sends payload `(step_id, configuration, input_data_reference)` to Backend API.
  2. Step status updates to "running".
  3. UI polls for status or listens to WebSocket.
  4. Backend executes Python script.
  5. On completion, Backend returns `(status, output_data_reference)`.
  6. Frontend updates Step status to "completed" and fetches/renders Output Grid.

## 3. Data Flow between Steps
- **Implicit Dependency:** Step N usually consumes the output of Step N-1.
- **Reference Passing:** Instead of passing full datasets to the UI, steps pass "references" (e.g., a DataFrame ID stored in the backend session).
- **Visualization:** The Output Grid fetches only the viewable slice of data for the `output_data_reference`.
