# Design Strategies for Backend Integration

**Date:** January 15, 2026
**Context:** Moving from Stage 1 (Frontend Foundation) to Stage 2 (Backend Integration).

based on the "Simple Steps" architecture (React Frontend + Python Data Backend), here are four key design strategies to ensure effective integration.

## 1. "Contract-First" Integration (Type Safety)

Since we have a TypeScript frontend and a Python backend, the biggest risk is the two languages disagreeing on what the data looks like.

*   **Strategy:** Don't just write a Python endpoint and try to match it in React. Define the "Contract" first.
*   **Implementation:** Use **Pydantic** models in Python to define request/response structures. Then, use tools (like `datamodel-code-generator` or OpenAPI generators) to automatically generate the TypeScript interfaces (`types/models.ts`) from those Python models.
*   **Benefit:** If a field changes in the backend, the frontend build will fail immediately, preventing runtime bugs.

## 2. The "Opaque Handle" Pattern (Data Handling)

As identified in `ADR 004`, we cannot pass huge DataFrames to the browser.

*   **Strategy:** Treat data as "Handles" or "References" in the frontend. The frontend should never try to parse the actual logic of the data; it only holds an ID (e.g., `dataset_id: "xyz-123"`).
*   **Implementation:**
    *   **Workflow Logic:** Deeply managed by the Backend.
    *   **Visualization:** The specific "Grid Component" asks the backend: *"Give me rows 100-150 for dataset `xyz-123`."*
*   **Benefit:** The application logic remains fast and light because it never holds the heavy data payload, only the *ticket* to retrieve it.

## 3. Asynchrony & Optimistic UI (User Experience)

Running a data step is slow. Waiting for the server to reply feels "broken" to a user.

*   **Strategy:** Separate the "Request to Run" from the "Result of Run".
*   **Implementation:**
    *   **Phase 1 (Request):** User clicks Run. The UI *immediately* sets the status to `pending` (Optimistic Update) and sends the request.
    *   **Phase 2 (Polling/Push):** The server returns a `job_id`. The frontend polls `GET /jobs/{id}` or listens to a WebSocket.
    *   **Phase 3 (Result):** Only when the job finishes does the UI fetch the final metadata.
*   **Benefit:** The UI remains responsive. If the network fails, we can "roll back" the optimistic update to an Error state.

## 4. The Anti-Corruption Layer (Architecture)

We currently have `frontend/src/services/api.ts`. Keep this strict boundary!

*   **Strategy:** Never let API logic leak into React Components (`StepDetailView`, etc.).
*   **Implementation:**
    *   **Bad:** Calling `fetch('/api/run')` inside a generic component.
    *   **Good:** Calling `workflowService.runStep(id)` which returns a clean domain object, not raw JSON.
*   **Benefit:** When we swap the Mock API for the real Python FastApi/Flask backend, we only have to rewrite the file `services/api.ts`. The rest of the UI components won't even know the backend changed.
