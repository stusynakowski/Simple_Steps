from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field
import uuid

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
    type: Literal['source', 'map', 'filter', 'expand', 'dataframe'] = 'dataframe'
    category: str = 'General'
    params: List[OperationParam]

# --- 2. Blueprint / Execution ---
class StepConfig(BaseModel):
    step_id: str
    operation_id: str
    label: str = ""
    config: Dict[str, Any] = Field(default_factory=dict)

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
