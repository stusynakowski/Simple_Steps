# 008 - Session State Management

## 1. Overview
This specification defines the architectural approach for managing `session_state`. The goal is to create a robust mechanism to store, update, and persist variable data generated during the user's interaction with the application. This state acts as the bridge between the React frontend's interactivity and the Python backend's execution capabilities.

## 2. Requirements
- **Persistence**: Variables must be preserved across page reloads and browser sessions (where applicable).
- **Synchronization**: The frontend state must be synchronized with the backend to ensure the Python execution environment has access to the latest user inputs.
- **Flexibility**: The system must support arbitrary key-value pairs (`Record<string, any>`) to accommodate various data types (strings, numbers, JSON objects).
- **Performance**: Updates should be efficient, minimizing network traffic via debouncing or batching.

## 3. Data Model

### 3.1 Session Structure
The core data structure for the session state is as follows:

```typescript
interface SessionState {
  /** Unique identifier for the current user session */
  sessionId: string;
  
  /** 
   * Dynamic dictionary of variables.
   * Keys are variable names, values can be any JSON-serializable data.
   */
  variables: Record<string, any>;
  
  /** Metadata to track synchronization status */
  meta: {
    lastSyncedAt: number | null;
    isDirty: boolean;
  };
}
```

### 3.2 Backend Representation
On the Python backend, this matches a Pydantic model or dictionary that can be injected into the execution context of workflow steps.

## 4. Frontend Implementation Strategy

### 4.1 State Management (React)
A new React Context (`SessionContext`) or a custom hook (`useSessionState`) will be created to:
1.  Initialize state (load from API or local storage).
2.  Provide a `setVariable(key, value)` method.
3.  Provide a `getVariable(key)` method.
4.  Handle background synchronization.

### 4.2 Synchronization Logic
To avoid hitting the API on every keystroke:
- **Optimistic Updates**: Update the UI immediately.
- **Debouncing**: Wait for a specialized timeout (e.g., 500ms-1000ms) after the last change before sending the payload to the backend.
- **Triggers**: Explicit saves should happen before triggering a workflow "Run" action to ensure the backend has the exact state.

## 5. Backend API Integration

### 5.1 Endpoints
- **GET /api/session/{id}**: Retrieve the current session state.
- **POST /api/session/{id}**: Update/Patch the session state. Validates and merges the provided variables.

### 5.2 Execution Context
When a workflow step is executed:
1.  The backend loads the `session_state` associated with the active session ID.
2.  These variables are made available to the Python function/script executing the step.
3.  Any outputs from the step can optionally update the `session_state` and return the new values to the frontend.

## 6. Security & Validation
- **Validation**: The backend should sanitize inputs to prevent injection attacks if variables are used in code evaluation.
- **Scoping**: Session IDs should be secure and potentially tied to authentication tokens to prevent unauthorized access to another user's state.
