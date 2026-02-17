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
    params: List[OperationParam]

# --- 2. Blueprint / Execution ---
class StepConfig(BaseModel):
    step_id: str
    operation_id: str
    config: Dict[str, Any] = Field(default_factory=dict)

class WorkflowDefinition(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    steps: List[StepConfig]

# --- 3. Reference Passing (Run Single Step) ---
class StepRunRequest(BaseModel):
    step_id: str
    operation_id: str
    config: Dict[str, Any]
    input_ref_id: Optional[str] = None
    step_map: Optional[Dict[str, str]] = None # Maps Step Label -> Output Ref ID
    is_preview: bool = False

class StepRunResponse(BaseModel):
    status: Literal['success', 'failed']
    output_ref_id: str
    metrics: Dict[str, Any]  # Changed to Any to allow lists
    error: Optional[str] = None

# --- 4. Global Control Responses ---
class PipelineRunResponse(BaseModel):
    run_id: str

class PipelineStatusResponse(BaseModel):
    run_id: str
    status: Literal['running', 'completed', 'failed', 'stopped']
    current_step_index: int
    step_statuses: Dict[str, Literal['pending', 'running', 'completed', 'failed']]

# --- 5. Data View ---
class DataViewRequest(BaseModel):
    offset: int = 0
    limit: int = 50
