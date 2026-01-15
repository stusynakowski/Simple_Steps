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
