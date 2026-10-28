# Frontend Architecture

The frontend is a React + TypeScript single-page application built with Vite. It provides the visual pipeline builder, formula bar, data grid, and all user interactions.

## Component Tree

```
App
└── MainLayout
    ├── MenuBar                     # File menu, project/pipeline management
    ├── UnifiedToolbar              # Global controls (run/pause/stop pipeline)
    │   └── WorkflowTabs           # Pipeline tab strip
    ├── WorkflowSequence            # Horizontal step canvas (arrow icons)
    │   └── StepIcon[]             # Individual arrow-shaped step icons
    ├── OperationColumn[]           # Expanded step panels
    │   ├── StepToolbar            # Formula bar + autocomplete
    │   ├── [Details Tab]          # Operation selector + parameter inputs
    │   │   └── PreviousStepDataPicker  # Column/cell reference picker
    │   ├── [Data Tab]
    │   │   ├── DataOutputGrid     # Glide Data Grid showing step output
    │   │   └── StagedDataGrid     # Preview grid (before execution)
    │   └── [Settings Tab]
    ├── Sidebar                     # Operation catalogue grouped by category
    ├── ActivityBar                 # Vertical icon bar (sidebar toggle)
    ├── ExecutionLog                # Timestamped log entries
    ├── ChatSidebar                 # Agent chat panel
    │   └── AgentWidget            # Chat input + streaming display
    └── DetachedStepWindow[]       # Floating step windows (dragged out)
```

## State Management: `useWorkflow`

**File:** `frontend/src/hooks/useWorkflow.ts`

The `useWorkflow` hook is the central state manager. It owns the workflow, step execution, persistence, and all mutation functions. There is **no external state library** (no Redux, no Zustand) — React's `useState` + `useCallback` + `useRef` pattern handles everything.

### Core State

```typescript
const [workflow, setWorkflow] = useState<Workflow>(initialWorkflow);
const [availableOperations, setAvailableOperations] = useState<OperationDefinition[]>([]);
const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(...);
const [maximizedStepId, setMaximizedStepId] = useState<string | null>(null);
const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'running' | 'paused'>('idle');
const [executionLogs, setExecutionLogs] = useState<LogEntry[]>([]);
```

### Key Functions

| Function | What it Does |
|---|---|
| `addStepAt(index)` | Insert a new empty step at a position |
| `updateStep(id, updates)` | Update any step field (formula, config, status, etc.) |
| `deleteStep(id)` | Remove a step from the workflow |
| `runStep(id)` | Execute a single step via the backend API |
| `previewStep(id)` | Run with `isPreview=true` (doesn't mark as completed) |
| `runPipeline()` | Execute all steps sequentially (from first incomplete) |
| `pausePipeline()` / `stopPipeline()` | Control pipeline execution |
| `saveWorkflow(projectId, name)` | Persist to backend as pipeline JSON |
| `loadWorkflow(projectId, pipelineId)` | Load from backend and hydrate |
| `loadWorkflowObject(wf)` | Replace state with any Workflow object |

### runStep Flow

```
runStep(id)
    │
    ├── Find step in workflow.steps
    ├── Parse step.formula → operationId + args
    ├── Build resolvedConfig = { ...internalKeys, ...formulaArgs }
    ├── Build stepMap from all executed steps
    │     { step-id: outputRefId, label: outputRefId, stepN: outputRefId }
    ├── Log: "Running step..."
    ├── Set step status → 'running'
    │
    ├── POST /api/run { operation_id, config, input_ref_id, step_map }
    ├── GET /api/data/:ref_id → Cell[]
    │
    ├── Column diff: new columns = output cols - previous step's cols
    ├── Filter preview cells to only show this step's new columns
    ├── Set step status → 'completed', store outputRefId + outputColumns + output_preview
    │
    └── Log: "Step completed — N rows, M columns"
```

### Pipeline Execution

`runPipeline()` calls `runSequence(startIndex)` which recursively calls `runStep()` for each step. Between steps, it checks `pipelineStatusRef.current` to support pause/stop.

## Step Wiring Context

**File:** `frontend/src/context/StepWiringContext.tsx`

The wiring context enables Excel-like cell/column reference selection across steps:

```
┌─ StepWiringProvider (wraps MainLayout)
│   wiringState: { receivingStepId, receivingStepIndex, inputRef }
│
├── OperationColumn (Step N) → calls activateWiring() when formula bar is focused
│    └── StepToolbar → formula bar input registers as wiring target
│
└── OperationColumn (Step M, M < N) → isWiringSource=true
     └── DataOutputGrid → renders in "wiring mode"
          → clicking a column header inserts "step-M.columnName" at cursor
          → clicking a cell inserts "step-M[row=R, col=C]" at cursor
```

### How Wiring Works

1. User focuses the formula bar on Step 3 → `activateWiring(step3Id, 2, inputRef)`.
2. Steps 1 and 2 detect `isWiringSource = true` (their index < receivingStepIndex).
3. Their data grids render with clickable column headers.
4. User clicks "url" column on Step 1 → `injectReference("step-abc.url")`.
5. The reference token is spliced into the formula bar at the cursor position.
6. Formula bar triggers `handleFormulaUpdate()` → step state updates.

### PreviousStepDataPicker

An alternative to the wiring grid — shows a dropdown of available columns from previous steps as clickable badges. Uses `handlePickerTokenSelect()` to inject tokens directly.

## Key Components

### OperationColumn (`OperationColumn.tsx`)

The main step panel. Contains:
- **StepToolbar** — formula bar input with autocomplete
- **Tabs**: Summary, Details, Data, Settings
- **Bidirectional sync** via `handleUiUpdate` / `handleFormulaUpdate`
- **Staged preview** — shows predicted output before execution

Key state: `liveFormula` tracks what the user is actively typing (may differ from committed `step.formula`).

### StepToolbar (`StepToolbar.tsx`)

The formula bar component. Features:
- Text input bound to `liveFormula`
- Autocomplete dropdown showing matching operations
- On change → `handleFormulaUpdate()` (parses and updates step)
- On focus → activates wiring context
- On blur → deactivates wiring (with delay for click events)

### DataOutputGrid (`DataOutputGrid.tsx`)

Glide Data Grid wrapper that renders step output as a spreadsheet-like table. In wiring mode, column headers become clickable to inject references.

### StagedDataGrid (`StagedDataGrid.tsx`)

Preview grid that shows predicted output BEFORE the step is executed. Uses the `useStagedPreview` hook to simulate the operation locally with upstream data.

### WorkflowSequence (`WorkflowSequence.tsx`)

The horizontal pipeline visualization — step icons (arrow shapes) arranged left-to-right. Shows step status via color, allows reordering, and adding new steps.

### DetachedStepWindow (`DetachedStepWindow.tsx`)

When a user drags a step header far enough, it "detaches" into a floating window. This allows side-by-side inspection of multiple steps.

## Type Definitions

**File:** `frontend/src/types/models.ts`

```typescript
interface Step {
  id: string;
  sequence_index: number;
  label: string;
  formula: string;              // Canonical source of truth
  process_type: string;         // Derived from formula
  configuration: StepConfiguration;  // Derived from formula + internal keys
  status: StepStatus;           // pending | running | completed | error | paused | stopped
  outputRefId?: string;         // Backend reference ID
  outputColumns?: string[];     // Full column list (for step diffing)
  output_preview?: Cell[];      // Cached preview cells
}

interface Workflow {
  id: string;
  name: string;
  created_at: string;
  steps: Step[];
}
```

## API Client

**File:** `frontend/src/services/api.ts`

The API client resolves the base URL automatically:
- If served by the backend (bundled): same-origin
- If Vite dev server (:5173): proxy to `http://localhost:8000/api`
- If `VITE_API_BASE` env var is set: use that

Key functions:

| Function | Endpoint | Description |
|---|---|---|
| `getOperations()` | GET /api/operations | Fetch operation catalogue |
| `runStep(...)` | POST /api/run | Execute a step |
| `fetchDataView(refId)` | GET /api/data/:ref_id | Get paginated output cells |
| `listProjects()` | GET /api/projects | List all projects |
| `savePipeline(...)` | POST /api/projects/:id/pipelines | Save a workflow |
| `loadPipeline(...)` | GET /api/projects/:id/pipelines/:pid | Load a workflow |

## Staged Preview System

**File:** `frontend/src/hooks/useStagedPreview.ts`

When a user types a formula but hasn't run the step yet, the staged preview system shows a simulated output:

1. Parse the live formula to get the operation and args.
2. Look up the operation definition to get expected output shape.
3. Apply a local simulation using upstream data (column names, sample values).
4. Render in `StagedDataGrid` with a visual indicator that this is a preview.

This gives immediate feedback without making a backend round-trip.

## CSS Architecture

Each component has a co-located `.css` file (e.g., `OperationColumn.css`). The styling uses CSS custom properties extensively — `--step-color` propagates the step's assigned color through the component tree.
