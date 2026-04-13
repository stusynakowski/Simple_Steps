# Pipeline Persistence

This document describes how workflows are saved, loaded, and hydrated — including backward compatibility with legacy formats.

## Storage Layout

Pipelines are stored as plain JSON files inside project folders:

```
projects/
├── my-youtube-analysis/
│   ├── channel-scrape.json      ← PipelineFile
│   └── sentiment-v2.json        ← PipelineFile
└── data-cleaning/
    └── normalize.json
```

**File:** `src/SIMPLE_STEPS/file_manager.py`

The file manager provides CRUD operations:
- `list_projects()` → scan `projects/` for directories
- `list_pipelines(project_id)` → scan project folder for `.json` files
- `save_pipeline(project_id, pipeline)` → write JSON
- `load_pipeline(project_id, pipeline_id)` → read and validate JSON
- `create_project(name)` / `delete_project(id)` → manage folders

### Workspace Root

The workspace root is the directory the user launched `simple-steps` from:

```python
WORKSPACE_ROOT = os.environ.get("SIMPLE_STEPS_WORKSPACE", os.getcwd())
PROJECTS_DIR = os.environ.get("SIMPLE_STEPS_PROJECTS_DIR", os.path.join(WORKSPACE_ROOT, "projects"))
```

### File Naming

Pipeline filenames are slugified from the pipeline ID/name:
- `"YouTube Channel Analysis"` → `youtube-channel-analysis.json`
- Slugification: lowercase, replace non-alphanumeric with `-`, strip leading/trailing `-`

## PipelineFile Model

**File:** `src/SIMPLE_STEPS/models.py`

```python
class PipelineFile(BaseModel):
    id: str                     # Unique pipeline identifier (= filename slug)
    name: str                   # Display name
    created_at: str = ""        # ISO timestamp
    updated_at: str = ""        # ISO timestamp
    steps: List[StepConfig]     # Ordered list of steps

class StepConfig(BaseModel):
    step_id: str                # Unique step identifier
    operation_id: str           # Registered operation ID
    label: str = ""             # Display label ("Step 1", "Fetch Videos")
    config: Dict[str, Any]      # Configuration dict (includes _-prefixed internal keys)
    formula: str = ""           # Canonical formula string
```

### The `formula` Field

The `formula` field is the **single source of truth** for what a step does. When present and valid, `operation_id` and `config` are derived from it on load.

Example pipeline JSON:

```json
{
  "id": "youtube-analysis",
  "name": "YouTube Analysis",
  "steps": [
    {
      "step_id": "step-001",
      "operation_id": "fetch_videos",
      "label": "Fetch Videos",
      "config": {
        "channel_url": "https://youtube.com/@mkbhd",
        "_orchestrator": "source"
      },
      "formula": "=fetch_videos.source(channel_url=\"https://youtube.com/@mkbhd\")"
    },
    {
      "step_id": "step-002",
      "operation_id": "extract_metadata",
      "label": "Extract Metadata",
      "config": {
        "url": "step1.url",
        "_orchestrator": "map"
      },
      "formula": "=extract_metadata.map(url=step1.url)"
    }
  ]
}
```

## Save Flow

**Frontend:** `useWorkflow.ts` → `saveWorkflow()`

```typescript
const pipeline: PipelineFile = {
    id: pipelineId,           // slugified from name
    name: pipelineName,
    created_at: current.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    steps: current.steps.map((s) => ({
        step_id: s.id,
        operation_id: s.process_type,
        label: s.label,
        config: s.configuration,
        formula: s.formula ?? s.operation ?? '',  // always persist formula
    })),
};
```

Key invariant: `formula` is always persisted. The `operation_id` and `config` fields are also saved for backward compatibility but are considered secondary.

**Backend:** `file_manager.py` → `save_pipeline()`

```python
def save_pipeline(project_id: str, pipeline: PipelineFile) -> PipelineFile:
    pipeline.updated_at = datetime.now().isoformat()
    if not pipeline.created_at:
        pipeline.created_at = datetime.now().isoformat()
    path = os.path.join(_project_dir(project_id), f"{pipeline_slug}.json")
    with open(path, "w") as f:
        f.write(pipeline.model_dump_json(indent=2))
    return pipeline
```

## Load Flow

### Backend: Model Validation

When a `StepConfig` is instantiated (whether from a JSON file or an API request), a Pydantic model validator ensures the formula is populated:

```python
class StepConfig(BaseModel):
    # ...
    
    @model_validator(mode="after")
    def derive_formula_if_missing(self) -> "StepConfig":
        if not self.formula and self.operation_id:
            self.formula = build_formula_from_fields(
                self.operation_id,
                self.config,
            )
        return self
```

This means old pipeline files that were saved before the `formula` field existed automatically get a reconstructed formula when loaded.

### Frontend: Hydration

**File:** `frontend/src/hooks/useWorkflow.ts` → `hydrateStep()`

When loading a pipeline, each `StepConfig` is converted to a runtime `Step`:

```typescript
function hydrateStep(s: PipelineFile['steps'][number], i: number): Step {
    const savedFormula = s.formula ?? '';
    const parsed = savedFormula ? parseFormula(savedFormula) : null;
    const formulaIsUsable = parsed?.isValid && !!parsed.operationId;

    // Derive process_type from formula or fall back to saved operation_id
    const processType = formulaIsUsable
        ? parsed!.operationId!
        : (s.operation_id ?? 'noop');

    // Merge internal keys + formula args (or fall back to full saved config)
    const internalKeys = Object.fromEntries(
        Object.entries(s.config ?? {}).filter(([k]) => k.startsWith('_'))
    );
    const formulaArgs = formulaIsUsable ? (parsed!.args ?? {}) : {};
    const legacyConfig = (formulaIsUsable && Object.keys(formulaArgs).length > 0)
        ? {}
        : Object.fromEntries(Object.entries(s.config ?? {}).filter(([k]) => !k.startsWith('_')));
    const configuration = { ...internalKeys, ...legacyConfig, ...formulaArgs };

    // Use saved formula if valid, otherwise reconstruct
    const formula = formulaIsUsable
        ? savedFormula
        : buildFormula(processType, configuration, internalKeys._orchestrator ?? null);

    return {
        id: s.step_id,
        sequence_index: i,
        label: s.label || `Step ${i + 1}`,
        formula,
        process_type: processType,
        configuration,
        status: 'pending',
    };
}
```

### Three Hydration Scenarios

| Scenario | Formula Field | What Happens |
|---|---|---|
| **Modern save** | Valid formula present | Derive `process_type` + `config` from formula |
| **Legacy save** | Empty/missing | `model_validator` reconstructs from `operation_id` + `config`; `hydrateStep` rebuilds via `buildFormula()` |
| **Corrupted** | Invalid formula | `hydrateStep` falls back to `operation_id` + `config` and reconstructs |

## Backward Compatibility

### Pre-Formula Pipeline Files

Old pipeline files look like:

```json
{
  "step_id": "step-001",
  "operation_id": "fetch_videos",
  "config": {
    "channel_url": "https://test.com",
    "_orchestrator": "source"
  }
}
```

(No `formula` field.)

**Backend handling:**
`StepConfig.derive_formula_if_missing` auto-generates:
```
=fetch_videos.source(channel_url="https://test.com")
```

**Frontend handling:**
`hydrateStep()` detects missing/invalid formula and calls `buildFormula()` to reconstruct.

### Internal Keys Convention

Keys prefixed with `_` in the `config` dict are internal metadata:

| Key | Purpose |
|---|---|
| `_orchestrator` | Orchestration mode override (source, map, filter, etc.) |
| `_ref` | Pass-through reference token |
| `_target_column` | Explicit column target for orchestrators |

These keys are:
- **Persisted** in the config dict in JSON
- **NOT included** in the formula string
- **Carried through** during formula ↔ config sync
- **Filtered out** before passing to the Python function (`config.items()` skips `_`-prefixed keys in `engine.py`)

## Pipeline Identity

The pipeline ID is derived from the name by slugification. This ensures the filename on disk always matches the in-memory ID:

```typescript
const pipelineId = pipelineName
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'pipeline';
```

When loading, `list_pipelines()` reconciles the on-disk filename with the stored `id` to prevent mismatches:

```python
file_slug = fname[:-5]  # strip ".json"
if _slugify(pf.id) != file_slug:
    pf.id = file_slug  # filesystem wins
```

## Testing

Pipeline persistence is tested in `tests/test_formula_alignment.py` → `TestPipelineJsonAlignment`:

1. **Save with formula** — verify formula field is non-empty.
2. **Load without formula** — verify reconstruction from `operation_id` + `config`.
3. **Round-trip** — save → serialize → deserialize → hydrate → verify formula survives.
4. **Existing files** — scan all `.json` files in `projects/` and flag any missing formulas.
