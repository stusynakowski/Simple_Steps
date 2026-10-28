# Data Flow & API Contract

This document describes the REST API surface between the frontend and backend, the request/response shapes, and the complete data flow for key operations.

## API Base URL

| Mode | URL |
|---|---|
| Production (bundled) | Same origin: `http://localhost:8000/api` |
| Development (Vite) | Proxy from `:5173` → `http://localhost:8000/api` |
| Custom | Set via `VITE_API_BASE` env var |

## Endpoints

### Operations

| Method | Path | Description |
|---|---|---|
| GET | `/api/operations` | Catalogue of all registered operations |

**Response:** `OperationDefinition[]`

```json
[
  {
    "id": "extract_metadata",
    "label": "Extract Video Metadata",
    "description": "...",
    "type": "map",
    "category": "YouTube",
    "params": [
      { "name": "url", "type": "string", "description": "...", "default": null }
    ]
  }
]
```

### Step Execution

| Method | Path | Description |
|---|---|---|
| POST | `/api/run` | Execute a single step |

**Request:** `StepRunRequest`

```json
{
  "step_id": "step-abc123",
  "operation_id": "extract_metadata",
  "config": {
    "_orchestrator": "map",
    "url": "step1.url"
  },
  "input_ref_id": "uuid-of-previous-step-output",
  "step_map": {
    "step-xyz": "uuid-...",
    "Step 1": "uuid-...",
    "step1": "uuid-..."
  },
  "is_preview": false
}
```

**Response:** `StepRunResponse`

```json
{
  "status": "success",
  "output_ref_id": "uuid-of-this-step-output",
  "metrics": {
    "rows": 100,
    "columns": ["url", "title", "views", "author"]
  }
}
```

**Error Response (400):**

```json
{
  "detail": "Error executing step extract_metadata: ...",
  "error_type": "ValueError",
  "traceback": "Traceback (most recent call last):\n  ...",
  "operation_id": "extract_metadata",
  "step_id": "step-abc123"
}
```

### Data Retrieval

| Method | Path | Description |
|---|---|---|
| GET | `/api/data/{ref_id}?offset=0&limit=50` | Paginated data slice |

**Response:** `Cell[]`

```json
[
  { "row_id": 0, "column_id": "url", "value": "https://...", "display_value": "https://..." },
  { "row_id": 0, "column_id": "title", "value": "My Video", "display_value": "My Video" },
  { "row_id": 1, "column_id": "url", "value": "https://...", "display_value": "https://..." }
]
```

The response is a flat array of cells, not a table. The frontend reconstructs the grid from `row_id` × `column_id` pairs. Special value handling:
- `pd.NaT` / `pd.NA` → `{ "value": null, "display_value": "" }`
- Lists/arrays → `{ "value": [...], "display_value": "[...]" }`
- NumPy arrays → converted to Python lists for JSON serialization

### Project & Pipeline Management

| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | List all project folders |
| POST | `/api/projects` | Create a new project |
| DELETE | `/api/projects/{id}` | Delete a project and all pipelines |
| GET | `/api/projects/{id}/pipelines` | List all pipelines in a project |
| GET | `/api/projects/{id}/pipelines/{pid}` | Load a single pipeline |
| POST | `/api/projects/{id}/pipelines` | Create or overwrite a pipeline |
| DELETE | `/api/projects/{id}/pipelines/{pid}` | Delete a pipeline |

**PipelineFile model:**

```json
{
  "id": "my-pipeline",
  "name": "My Pipeline",
  "created_at": "2026-04-13T00:00:00Z",
  "updated_at": "2026-04-13T00:00:00Z",
  "steps": [
    {
      "step_id": "step-001",
      "operation_id": "fetch_videos",
      "label": "Fetch Videos",
      "config": { "channel_url": "https://...", "_orchestrator": "source" },
      "formula": "=fetch_videos.source(channel_url=\"https://...\")"
    }
  ]
}
```

### Workspace & Diagnostics

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspace` | Workspace root, discovered projects/packs, operation counts |
| GET | `/api/debug/registry` | Raw registry state for debugging |
| GET | `/api/loader` | Three-tier pack loader state and load results |
| GET | `/api/developer-packs` | Developer pack directories with operations |
| POST | `/api/projects/{id}/load-ops` | Scan a project for @simple_step functions |

### Pack Management

| Method | Path | Description |
|---|---|---|
| GET | `/api/packs` | List manifest packs with health |
| POST | `/api/packs` | Add a pack (body: `{ source, url/path/package, name? }`) |
| DELETE | `/api/packs/{name}` | Remove a pack from manifest |
| POST | `/api/packs/install` | Install/sync all declared packs |

### Agent (Optional)

| Method | Path | Description |
|---|---|---|
| POST | `/api/agent/chat` | Single-shot agent chat turn |
| WS | `/api/agent/chat/stream` | Streaming chat via WebSocket |
| GET | `/api/agent/config` | Read agent configuration |
| PATCH | `/api/agent/config` | Update agent configuration |
| GET | `/api/agent/health` | Check agent dependency status |

## Step Map: The Wiring Backbone

The `step_map` is how the backend resolves step references. It's built by the frontend from all executed steps:

```typescript
// Frontend: useWorkflow.ts → runStep()
const stepMap: Record<string, string> = {};
for (const [index, s] of currentSteps.entries()) {
    if (s.outputRefId) {
        stepMap[s.id] = s.outputRefId;              // "step-abc123" → "uuid-..."
        stepMap[s.label] = s.outputRefId;            // "Fetch Videos" → "uuid-..."
        stepMap[`step${index + 1}`] = s.outputRefId; // "step1" → "uuid-..."
    }
}
```

This means a formula can reference previous steps by:
- **Step ID:** `step-abc123.url` (stable, used by wiring UI)
- **Label:** `Fetch Videos.url` (human-readable, may break if renamed)
- **Position:** `step1.url` (concise, breaks if steps are reordered)

The backend's `resolve_reference()` looks up the step key in the map, retrieves the DataFrame from `DATA_STORE`, and extracts the requested column.

## Complete Data Flow: Run a Step

```
    Frontend                           Network                    Backend
    ────────                           ───────                    ───────

1.  User clicks Run on Step 2
    │
2.  parseFormula("=op.map(url=step1.url)")
    → { operationId: "op", args: { url: "step1.url" } }
    │
3.  Build config: { _orchestrator: "map", url: "step1.url" }
    Build stepMap: { "step-xyz": "ref-1", "step1": "ref-1", ... }
    │
4.  ──── POST /api/run ──────────────────────────►
    │  { operation_id: "op",                       │
    │    config: { _orchestrator: "map",           │
    │             url: "step1.url" },              │
    │    input_ref_id: "ref-1",                    │
    │    step_map: { "step1": "ref-1" } }          │
    │                                               │
    │                                    5. run_operation("op", config, "ref-1", step_map)
    │                                       │
    │                                       ├── df_in = DATA_STORE["ref-1"]
    │                                       ├── wrapper = ORCHESTRATORS["map"]
    │                                       ├── resolve "step1.url" → df_in["url"] (Series)
    │                                       ├── wrapper(func)(url=<Series>, _input_df=df_in)
    │                                       ├── result_df = 100 rows × 8 cols
    │                                       └── DATA_STORE["ref-2"] = result_df
    │                                               │
    │  ◄─── { status: "success",  ──────────────────┘
    │        output_ref_id: "ref-2",
    │        metrics: { rows: 100, columns: [...] } }
    │
6.  ──── GET /api/data/ref-2?offset=0&limit=50 ──►
    │                                               │
    │                                    7. Slice df.iloc[0:50]
    │                                       Convert to Cell[] array
    │                                               │
    │  ◄─── Cell[] (2500 cells: 50 rows × 50 cols) ┘
    │
8.  Column diff: newCols = output cols - step1.outputColumns
    Filter cells to only newCols for display
    │
9.  Update step state:
    - status: "completed"
    - outputRefId: "ref-2"
    - outputColumns: ["url", "title", "views", ...]
    - output_preview: filteredCells
```

## Complete Data Flow: Save & Load Workflow

### Save

```
Frontend                               Backend
────────                               ───────

1. User clicks Save
   │
2. Build PipelineFile from workflow state:
   steps.map(s => ({
     step_id: s.id,
     operation_id: s.process_type,
     label: s.label,
     config: s.configuration,
     formula: s.formula          ← canonical field
   }))
   │
3. ──── POST /api/projects/{pid}/pipelines ───►
   │                                            │
   │                              4. PipelineFile(**data) — Pydantic validates
   │                              5. Write to projects/{pid}/{slug}.json
   │                                            │
   │  ◄─── PipelineFile (with timestamps) ──────┘
```

### Load

```
Frontend                               Backend
────────                               ───────

1. User opens a pipeline
   │
2. ──── GET /api/projects/{pid}/pipelines/{id} ──►
   │                                               │
   │                              3. Read JSON file
   │                              4. PipelineFile(**data)
   │                              5. model_validator: if step.formula is empty,
   │                                 → build_formula_from_fields(op_id, config)
   │                                               │
   │  ◄─── PipelineFile (with derived formulas) ───┘
   │
6. pipeline.steps.map(hydrateStep):
   │
   ├── If formula is valid: derive process_type + config from it
   ├── If formula is missing: buildFormula(operation_id, config)
   └── Result: Step with formula, process_type, configuration all in sync
   │
7. Set workflow state → UI renders with correct formula bar + details
```
