from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
import uuid


# --- 1. Dynamic Discovery ---
class OperationParam(BaseModel):
    name: str
    type: Literal['string', 'number', 'boolean', 'list', 'object', 'dataframe']
    description: str = ""
    default: Optional[Any] = None
    # Whether the parameter has no default — read off core's ToolParam.required.
    required: bool = False
    # 'resource' params are injected by the engine from the resource container
    # and are not user-editable form fields. Mirrors core's ToolParam.kind.
    kind: Literal['data', 'resource'] = 'data'
    # Allowed values for a Literal-annotated parameter, read off core's
    # derived input_schema. None means unconstrained (render a text field);
    # a list means render a dropdown and reject anything else.
    options: Optional[List[Any]] = None


class OperationReturn(BaseModel):
    """What a tool gives back. Derived from its return annotation + docstring."""
    type: str = "Any"
    # core's cardinality word for tabular returns: 'grid' | 'column' | None.
    form: Optional[Literal['grid', 'column', 'scalar']] = None
    description: str = ""


class OperationDefinition(BaseModel):
    id: str
    label: str
    description: str
    # 'step' is the v0.2 single-cell default — one call, one return value,
    # no row iteration.  The other modes are tabular orchestrations kept
    # available for power users.
    type: Literal['step', 'source', 'map', 'filter', 'expand', 'dataframe', 'raw_output', 'orchestrator', 'verb'] = 'dataframe'
    category: str = 'General'
    params: List[OperationParam]
    # ── Contract fields sourced from simple_steps_core's ToolDefinition ──
    # See core_bridge.core_contract(). `returns` and per-param descriptions
    # are shimmed locally — docs/core-proposals/008-core-changes.md C3.
    returns: Optional[OperationReturn] = None
    # The resource this tool is bound to, if any ('reshape', 'file_system', …).
    resource: Optional[str] = None
    # Resource container keys the engine must inject for this tool to run.
    dependencies: List[str] = Field(default_factory=list)

# --- 2. Blueprint / Execution ---
# Keys the formula parser adds to `args` itself; they are re-derived on load.
_PARSER_KEYS = {"_literal", "_ref"}


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
        # Settings the expression cannot carry — the Orchestration choice and
        # its verb settings (`_orchestrator`, `_name`, `_retry`, …). Without
        # this they were dropped on save and lost on reopen.
        settings = {k: v for k, v in (data.get("config") or {}).items()
                    if k.startswith("_") and k not in _PARSER_KEYS}
        if settings:
            meta["settings"] = settings

        formula = (data.get("formula") or "").strip()
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
    def _parsed(self) -> Dict[str, Any]:
        """Cached parse of the expression — `operation_id` / `config` use this."""
        if not hasattr(self, "__parsed_cache"):
            from .operation_formula import describe
            object.__setattr__(self, "__parsed_cache", describe(self.formula))
        return getattr(self, "__parsed_cache")

    @property
    def operation_id(self) -> str:
        return self._parsed["operationId"] or ""

    @property
    def config(self) -> Dict[str, Any]:
        cfg: Dict[str, Any] = dict(self._parsed["args"])
        cfg.update(self.meta.get("settings") or {})
        return cfg

    def ui_dict(self) -> Dict[str, Any]:
        """The on-disk v2 fields plus the v1 fields the UI hydrates from
        (`useWorkflow.hydrateStep` reads `formula`, `label`, `step_id`,
        `config`). Properties are not serialised by pydantic, so without this
        a reopened step arrived with no formula and fell back to `noop`."""
        return {
            **self.model_dump(),
            "step_id": self.step_id,
            "label": self.label,
            "formula": self.formula,
            "operation_id": self.operation_id,
            "config": self.config,
        }


class PipelineFile(BaseModel):
    """
    A single pipeline definition stored as <project_dir>/<name>.simple-steps-workflow.

    On-disk shape (v2)::

        { "format_version": 2,
          "name": "...",
          "meta": {...},          # optional, free-form
          "resources": {...},     # optional: resources the steps use (core 007)
          "steps": [StepConfig]  }

    Sections this model doesn't name are kept, not dropped (``extra="allow"``),
    so a file written by a newer app survives a load and save here.
    """
    model_config = ConfigDict(extra="allow")

    format_version: int = 2
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    meta: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    steps: List[StepConfig]
    #: name → {"source": "defined", "type": "<Class>", "settings": {...}}
    resources: Dict[str, Any] = Field(default_factory=dict)

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
    formula: Optional[str] = None
    # step name → output ref, for a formula run outside a workflow.
    step_map: Optional[Dict[str, str]] = None
    # NOTE: ``session_id`` is intentionally NOT a request field.  It is
    # resolved server-side from the ``ss_session`` HttpOnly cookie via
    # ``SIMPLE_STEPS.session.get_session_id``.  The client cannot set,
    # read, or spoof it.
    result_store: Optional[Literal['memory', 'parquet']] = None
    # The workflow's `resources` section — declarations (type + literal
    # settings), never objects. The server keeps the live objects per session.
    resources: Optional[Dict[str, Any]] = None
    # The whole workflow — every step's {id, name, formula, ref} — and which
    # workflow it is. With them a core-syntax step runs in the session's one
    # core workflow: its kernel (kernels.py, dev_plan/124 phase 2).
    workflow_key: Optional[str] = None
    workflow_steps: Optional[List[Dict[str, Any]]] = None


class WorkflowSyncRequest(BaseModel):
    """Declare the workflow's steps without running them (after an edit)."""
    workflow_key: str
    workflow_steps: List[Dict[str, Any]]
    resources: Optional[Dict[str, Any]] = None

class StepRunResponse(BaseModel):
    status: Literal['success', 'failed']
    output_ref_id: str
    metrics: Dict[str, Any]
    error: Optional[str] = None

# --- 6. Data View ---
class DataViewRequest(BaseModel):
    offset: int = 0
    limit: int = 50
