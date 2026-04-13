from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field, model_validator
import uuid


# ── Formula utilities ─────────────────────────────────────────────────────────
# These mirror the buildFormula / parseFormula logic in the frontend
# (frontend/src/utils/formulaParser.ts) so the backend can derive the formula
# from operation_id + config when loading old pipeline files that lack it.

def build_formula_from_fields(
    operation_id: str,
    config: Dict[str, Any],
    orchestration: Optional[str] = None,
) -> str:
    """
    Build a canonical formula string from an operation ID and config dict.

    Examples:
        build_formula_from_fields("fetch_videos", {"channel_url": "https://..."}, "source")
        → '=fetch_videos.source(channel_url="https://...")'

    This is the Python equivalent of `buildFormula()` in formulaParser.ts.
    Both MUST produce identical output for the same inputs.
    """
    if not operation_id or operation_id in ("noop", "passthrough", ""):
        return ""

    effective_mode = orchestration or config.get("_orchestrator")
    modifier = f".{effective_mode}" if effective_mode else ""

    arg_parts = []
    for k, v in config.items():
        if k.startswith("_"):
            continue  # internal keys (_orchestrator, _ref, etc.)
        if isinstance(v, str) and not str(v).startswith("="):
            val_str = f'"{v}"'
        else:
            val_str = str(v) if v is not None else ""
        arg_parts.append(f"{k}={val_str}")

    args = ", ".join(arg_parts)
    return f"={operation_id}{modifier}({args})"

# --- 1. Dynamic Discovery ---
class OperationParam(BaseModel):
    name: str
    type: Literal['string', 'number', 'boolean', 'list', 'object', 'dataframe']
    description: str
    default: Optional[Any] = None

class OperationDefinition(BaseModel):
    id: str
    label: str
    description: str
    type: Literal['source', 'map', 'filter', 'expand', 'dataframe', 'raw_output', 'orchestrator'] = 'dataframe'
    category: str = 'General'
    params: List[OperationParam]

# --- 2. Blueprint / Execution ---
class StepConfig(BaseModel):
    step_id: str
    operation_id: str
    label: str = ""
    config: Dict[str, Any] = Field(default_factory=dict)
    # Canonical formula — the single source of truth for what this step executes.
    # operation_id and config are derived from this on load.
    # e.g. "=filter_rows(column=\"score\", value=\"5\", mode=\"equals\")"
    formula: str = ""

    @model_validator(mode="after")
    def derive_formula_if_missing(self) -> "StepConfig":
        """
        Automatically derive the formula from operation_id + config when the
        formula field is empty.  This ensures that old pipeline JSON files
        (which predate the formula field) produce a proper formula when loaded,
        so the frontend formula bar always shows the function + arguments.
        """
        if not self.formula and self.operation_id:
            self.formula = build_formula_from_fields(
                self.operation_id,
                self.config,
            )
        return self

class PipelineFile(BaseModel):
    """
    A single pipeline definition stored as <project_dir>/<name>.json.
    Contains only the workflow blueprint — no runtime data.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: str = ""
    updated_at: str = ""
    steps: List[StepConfig]

# --- 3. Project (folder) ---
class ProjectInfo(BaseModel):
    """Lightweight descriptor returned by GET /api/projects."""
    id: str          # folder name (safe slug)
    name: str        # display name  (= folder name for now)
    pipelines: List[str]  # list of pipeline filenames inside the folder

# --- 4. Reference Passing (Run Single Step) ---
class StepRunRequest(BaseModel):
    step_id: str
    operation_id: str
    config: Dict[str, Any]
    input_ref_id: Optional[str] = None
    step_map: Optional[Dict[str, str]] = None
    is_preview: bool = False

class StepRunResponse(BaseModel):
    status: Literal['success', 'failed']
    output_ref_id: str
    metrics: Dict[str, Any]
    error: Optional[str] = None

# --- 5. Global Control Responses ---
class PipelineRunResponse(BaseModel):
    run_id: str

class PipelineStatusResponse(BaseModel):
    run_id: str
    status: Literal['running', 'completed', 'failed', 'stopped']
    current_step_index: int
    step_statuses: Dict[str, Literal['pending', 'running', 'completed', 'failed']]

# --- 6. Data View ---
class DataViewRequest(BaseModel):
    offset: int = 0
    limit: int = 50

# ── Legacy shims (kept so existing file_manager.py compiles) ──────────────
class ProjectMetadata(BaseModel):
    id: str
    name: str
    description: Optional[str] = ""
    updated_at: str

class WorkflowDefinition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    steps: List[StepConfig]

class Project(BaseModel):
    metadata: ProjectMetadata
    workflow: WorkflowDefinition

class ProjectListResponse(BaseModel):
    projects: List[ProjectMetadata]
