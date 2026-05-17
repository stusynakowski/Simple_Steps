from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field, model_validator
import uuid


# ── Formula utilities ─────────────────────────────────────────────────────────
# These mirror the buildFormula / parseFormula logic in the frontend
# (frontend/src/utils/formulaParser.ts) so the backend can derive the formula
# from operation_id + config when loading old pipeline files that lack it.

import re as _re

def _is_step_reference(value: str) -> bool:
    """Return True if *value* looks like a step reference token (e.g. ``step1.url``)."""
    return bool(_re.match(r'^step[\w-]*\.\w+$', value, _re.IGNORECASE))


def _format_formula_value(v: Any) -> str:
    """
    Format a config value for inclusion in a formula string.

    * Step references (step1.url) → unquoted
    * Numbers / booleans → unquoted
    * Everything else → double-quoted

    Must match ``formatFormulaValue()`` in formulaParser.ts exactly.
    """
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v).lower()          # true / false
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if s.startswith("="):
        return s
    if _is_step_reference(s):
        return s
    # Pure numeric strings stay unquoted
    if _re.match(r'^-?\d+(\.\d+)?$', s):
        return s
    return f'"{s}"'


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

        build_formula_from_fields("extract_metadata", {"url": "step1.url"}, "map")
        → '=extract_metadata.map(url=step1.url)'

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
        arg_parts.append(f"{k}={_format_formula_value(v)}")

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
    """
    Canonical step shape (v2). A step is just a name + a Python expression::

        { "name": "step_1_metadata",
          "expression": "extract_metadata.rowmap(video_url=step1)",
          "meta": { "label": "Extract Metadata" } }

    The v1 fields (`step_id`, `operation_id`, `config`, `formula`, `label`)
    are exposed as computed properties derived from the expression, so that
    existing call sites continue to work unchanged. They are NOT serialised.
    """

    name: str = ""
    expression: str = ""
    meta: Dict[str, Any] = Field(default_factory=dict)

    # ── v1 compatibility ────────────────────────────────────────────────
    # Older files were shaped { step_id, operation_id, label, config, formula }.
    # `_coerce_v1` normalises both shapes into the v2 fields at load time.

    @model_validator(mode="before")
    @classmethod
    def _coerce_v1(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        # If already v2-shaped, nothing to do.
        if "expression" in data or "name" in data and "step_id" not in data:
            # Ensure meta exists as a dict.
            data.setdefault("meta", {})
            return data

        # Translate v1 fields into v2.
        meta: Dict[str, Any] = dict(data.get("meta") or {})
        if data.get("label"):
            meta.setdefault("label", data["label"])
        if data.get("step_id"):
            meta.setdefault("legacy_step_id", data["step_id"])

        formula = (data.get("formula") or "").strip()
        if not formula and data.get("operation_id"):
            formula = build_formula_from_fields(
                data["operation_id"], data.get("config") or {}
            )
        expression = formula[1:].lstrip() if formula.startswith("=") else formula

        return {
            "name": data.get("step_id") or data.get("name") or "",
            "expression": expression,
            "meta": meta,
        }

    # ── v1 read-only accessors ──────────────────────────────────────────
    @property
    def step_id(self) -> str:
        return self.meta.get("legacy_step_id") or self.name

    @property
    def label(self) -> str:
        return self.meta.get("label") or self.name

    @property
    def formula(self) -> str:
        return f"={self.expression}" if self.expression else ""

    @property
    def _parsed(self) -> Any:
        """Cached parse of the expression — `operation_id` / `config` use this."""
        if not hasattr(self, "__parsed_cache"):
            from .formula_parser import parse_formula
            object.__setattr__(self, "__parsed_cache", parse_formula(self.formula))
        return getattr(self, "__parsed_cache")

    @property
    def operation_id(self) -> str:
        p = self._parsed
        return p.operation_id or ""

    @property
    def config(self) -> Dict[str, Any]:
        p = self._parsed
        cfg: Dict[str, Any] = dict(p.args or {})
        if p.orchestration:
            cfg["_orchestrator"] = p.orchestration
        return cfg


class PipelineFile(BaseModel):
    """
    A single pipeline definition stored as <project_dir>/<name>.simple-steps-workflow.

    On-disk shape (v2)::

        { "format_version": 2,
          "name": "...",
          "meta": {...},          # optional, free-form
          "steps": [StepConfig]  }
    """
    format_version: int = 2
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    steps: List[StepConfig]

    @model_validator(mode="before")
    @classmethod
    def _coerce_pipeline_v1(cls, data: Any) -> Any:
        """Accept both v1 docs ({id, name, steps}) and v2 docs ({format_version,
        name, meta, steps}). Carry forward `meta.legacy_id` if v1 had an opaque
        id."""
        if not isinstance(data, dict):
            return data
        out = dict(data)
        meta: Dict[str, Any] = dict(out.get("meta") or {})
        # v1 had `id` as a separate field; if it's present and looks like a
        # legacy slug, surface it through meta.legacy_id.
        if "format_version" not in out and out.get("id"):
            meta.setdefault("legacy_id", out["id"])
        out["meta"] = meta
        out.setdefault("format_version", 2)
        return out


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
    formula: Optional[str] = None  # raw formula string for eval-mode fallback
    session_id: Optional[str] = None
    result_store: Optional[Literal['memory', 'parquet']] = None

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
