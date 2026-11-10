# Test Plan Overview

## 1. Introduction
This document outlines the testing strategy for the Simple Steps UI. It ensures that the application meets the requirements defined in the `docs/spec/` folder. We will focus on UI component behavior, workflow logic, and data handling integration.

## 2. Testing Levels
1.  **Unit Tests:** Focus on individual React components (e.g., StepIcon, Button, Grid).
2.  **Integration Tests:** Focus on the interaction between components (e.g., Workflow Manager adding a Step).
3.  **End-to-End (E2E) Tests:** Focus on full user journeys (e.g., Create workflow -> Add Step -> Run -> View Output).

## 3. Requirement Mapping
The following table maps requirements from `docs/archive/spec/000-overview.md` (archived) to specific test cases.

| ID | Requirement | Test Case ID | Test Description | Priority |
|:---|:---|:---|:---|:---|
| **REQ-UI-001** | Display workflow as horizontal arrow icons | `TC-UI-01` | Verify `WorkflowVisualizer` renders list of steps horizontally. | High |
| **REQ-UI-002** | Add functionality for steps | `TC-UI-02` | Verify clicking "Add" inserts a new step in the state. | High |
| **REQ-UI-002** | Remove/Modify functionality | `TC-UI-03` | Verify clicking "Delete" removes step; Verify modifying config updates state. | Medium |
| **REQ-UI-003** | Step expansion to Detail View | `TC-UI-04` | Verify clicking a step toggles the `StepDetailView`. | High |
| **REQ-UI-003** | Detail View contents | `TC-UI-05` | Verify Detail View contains Toolbar and Data Grid. | High |
| **REQ-UI-004** | Agent Widget presence | `TC-UI-06` | Verify Agent Widget is visible in the viewport. | Low |
| **REQ-UI-005** | Global controls (Load/Save) | `TC-UI-07` | Verify Save/Load buttons trigger API calls. | Medium |
| **REQ-Data-001** | Step Abstraction | `TC-DATA-01` | Verify JSON payload for a Step matches Schema (id, sequence, config). | High |
| **REQ-Data-002** | Async Status Updates | `TC-DATA-02` | Mock a "Running" process and verify UI updates from specific polling/socket event. | High |
| **REQ-API-001** | Backend Communication | `TC-API-01` | Mock API response for `run_step` and verify `output_preview` is populated. | High |

## 4. Test Scenarios (Detailed)

### UI Components Group
- **[TEST-COMP-01] Workflow Visualizer Rendering**
  - **Input:** A list of 5 mocked steps.
  - **Expected:** 5 Arrow components rendered in correct order (index 0 to 4).
- **[TEST-COMP-02] Data Grid Virtualization**
  - **Input:** A mocked dataset of 10,000 rows.
  - **Expected:** Grid renders without crashing; scrolling loads visible rows.

### Workflow Logic Group
- **[TEST-LOGIC-01] Dependencies**
  - **Action:** Delete Step 2 in a 3-step workflow.
  - **Expected:** Step 3's index updates to 2.
- **[TEST-LOGIC-02] Configuration State**
  - **Action:** Change a param in Step 1.
  - **Expected:** Step 1 status reverts to "Pending" (invalidates previous run).

## 5. Tools & Environment
- **Framework:** Jest + React Testing Library (Unit/Integration)
- **E2E Tool:** Cypress or Playwright (TBD)
- **Mocking:** MSW (Mock Service Worker) for API simulation.

### Run Feedback Group ([spec 009](../spec/009-run-feedback.md))
| ID | Requirement | Test | File |
|:---|:---|:---|:---|
| **REQ-RUN-001** | Run metrics carry core's warnings | `TEST-RUN-01` | `tests/test_run_feedback.py` |
| **REQ-RUN-002** | Warnings are logged and shown on the step | `TEST-RUN-02` | `frontend/src/hooks/useWorkflow.runFeedback.test.tsx` |
| **REQ-RUN-003** | Run metrics count uncaught failed rows | `TEST-RUN-03` | `tests/test_run_feedback.py` |
| **REQ-RUN-004** | Run All stops on an uncaught failure | `TEST-RUN-04` | `frontend/src/hooks/useWorkflow.runFeedback.test.tsx` |
| **REQ-RUN-005** | The suggested verb is re-asked when the input runs | `TEST-RUN-05` | `frontend/src/components/ToolEditor.test.tsx` |

### Examples Group ([spec 010](../spec/010-examples.md))
| ID | Requirement | Test | File |
|:---|:---|:---|:---|
| **REQ-EX-001**, **REQ-EX-002** | The examples' structure | (by construction; `TEST-EX-01/02` fail if a part is missing) | — |
| **REQ-EX-003** | Each sub-example's runme passes | `TEST-EX-01` | `tests/test_examples.py` |
| **REQ-EX-006** | Bad examples go wrong as listed; fixes run cleanly | `TEST-EX-01` (`bad_examples`) | `tests/test_examples.py` |
| **REQ-EX-004** | The main example's runme passes | `TEST-EX-02` | `tests/test_examples.py` |
| **REQ-EX-005** | Checks run in tests and from an install | `TEST-EX-01/02`; `scripts/smoke_install.py` stage "`python examples/runme.py` passes from the installed copy" | — |

### Tools Group ([spec 011](../spec/011-tools-are-core-handles.md))
| ID | Requirement | Test | File |
|:---|:---|:---|:---|
| **REQ-TOOL-001** | A tool is core's handle; brackets build a core step, unregistered | `TEST-TOOL-01` | `tests/test_tool_handle.py` |
| **REQ-TOOL-002** | Every other call behaves as before | `TEST-TOOL-02` | `tests/test_tool_handle.py` |

### Switching Group ([spec 012](../spec/012-switching-tools-and-verbs.md))
| ID | Requirement | Test | File |
|:---|:---|:---|:---|
| **REQ-FORM-001** | One shape verb per step, refused when written | `TEST-FORM-01` | `tests/test_formula_switching.py` |
| **REQ-FORM-002** | A verb that applies no tool keeps its default tool | `TEST-FORM-02` | `tests/test_formula_switching.py` |
| **REQ-FORM-003** | Choosing a shape verb replaces the step's verb | `TEST-FORM-03`, `TEST-FORM-03a–c` | `tests/test_formula_switching.py`, `frontend/src/utils/formulaParts.test.ts`, `frontend/src/components/ToolEditor.switching.test.tsx` |
| **REQ-FORM-004** | A no-tool verb brings its default tool | `TEST-FORM-03`, `TEST-FORM-04`, `TEST-FORM-04b–c` | same three files |
| **REQ-FORM-005** | `auto` is made explicit only with the current tool's verb | `TEST-FORM-05a–b` | `frontend/src/utils/formulaParts.test.ts`, `frontend/src/components/ToolEditor.switching.test.tsx` |
| **REQ-FORM-006** | Every tool, switched to and run, runs or says why | `TEST-FORM-06`, `TEST-FORM-06b` | `tests/test_formula_switching.py` (+ `tests/fixtures/switch_sweep.py`), `frontend/src/components/ToolEditor.switching.test.tsx` |
| **REQ-FORM-007** | Example formulas round-trip through the editor's parts | `TEST-FORM-07` | `tests/test_formula_switching.py` |

### Environment Group ([spec 013](../spec/013-environment-explorer.md))
| ID | Requirement | Test | File |
|:---|:---|:---|:---|
| **REQ-ENV-001** | `/api/environment` lists every tool, typed, built-ins included | `TEST-ENV-01` | `tests/test_environment.py` |
| **REQ-ENV-002** | A resource input names the types that fit it | `TEST-ENV-02` | `tests/test_environment.py` |
| **REQ-ENV-003** | Resource types and ready-made resources | `TEST-ENV-03` | `tests/test_environment.py` |
| **REQ-ENV-004** | The explorer lists tools and resources, one filter | `TEST-ENV-04` | `frontend/src/components/EnvironmentExplorer.test.tsx` |
| **REQ-ENV-005** | A tool's details: inputs, types, output, formula | `TEST-ENV-05a–b` | `frontend/src/utils/environment.test.ts`, `frontend/src/components/EnvironmentExplorer.test.tsx` |
| **REQ-ENV-006** | A resource's and a type's details, bound tools | `TEST-ENV-06` | `frontend/src/components/EnvironmentExplorer.test.tsx` |
| **REQ-ENV-007** | User Docs shows docs/usage_docs, bundled | `TEST-ENV-07a–c` | `frontend/src/utils/docs.test.ts`, `frontend/src/components/DocsPanel.test.tsx` |
| **REQ-ENV-008** | A docs change marks the bundle stale | `TEST-ENV-08` | `tests/test_environment.py` |
