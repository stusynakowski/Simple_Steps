# Development Step 6: Integration & State Logic

## Goal
Connect the components with the state management logic defined in `docs/spec/003-workflow-logic.md` and simulate the backend interaction.

## Key Actions
1. **State Management:**
   - Implement `useWorkflow` hook or Context.
   - Functions: `addStep`, `updateStepConfig`, `removeStep`, `selectStep`.

2. **Mock Backend API:**
   - Create a service `api.ts`.
   - Implement `runStep(stepId, config)` returning a Promise that resolves after a delay.
   - Return updated status and mock output data.

3. **Wiring It Up:**
   - Connect "Run" button in Toolbar to the API call.
   - Connect "Add" button in Visualizer to `addStep`.
   - Connect "Delete" to `removeStep`.
   - Update Step status in UI upon API completion.

## Verification
- **Full User Flow:** 
  - User can add a step.
  - User can select it.
  - User can click "Run" -> Status changes to "Running" -> "Completed".
  - Output grid populates with new data upon completion.

## Progress
- Implemented a mock API service (`frontend/src/services/api.ts`) with `runStep(stepId, config)` that resolves with a completed status and mock output.
- Updated `useWorkflow` hook to call the mock API and update step status/output on completion or `error` on failure.
- Wired the existing toolbar `Run` button to the flow and added/updated tests to verify the end-to-end run behavior.

## Next Tasks (detailed)
- Add cancellation/abort semantics for running jobs and surface `Stop` behavior in the toolbar.
- Extend mock API to simulate errors and streaming/progress events for more robust UI handling and tests.
- Add E2E tests to validate the full workflow including persistence and workflow save/load.
