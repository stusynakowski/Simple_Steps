"""
file_manager.py
===============
Projects are *folders* inside the top-level ``projects/`` directory.

    projects/
        my-youtube-analysis/
            channel_scrape.json
            sentiment_v2.json
        data-cleaning/
            normalize.json

Each workflow file (``*.simple-steps-workflow`` or legacy ``*.json``)
is a ``PipelineFile`` (steps + metadata, no runtime data).
"""

import json
import os
import re
import base64
from typing import List, Optional
from datetime import datetime

from .models import PipelineFile, ProjectInfo


# ── v2 → v1 adapter ──────────────────────────────────────────────────────────
# The on-disk workflow format described in docs/dev_plan/102 is "v2":
#   { format_version: 2, name, meta?, steps: [{ name, expression, meta? }] }
#
# The runtime/UI still operates on the v1 PipelineFile shape:
#   { id, name, steps: [{ step_id, operation_id, label, config, formula }] }
#
# Until the rest of the stack is ported to read v2 directly, the loader
# normalises v2 files into v1 in memory. Saves still write v1; the next
# time we touch the writer we'll switch it to v2 and drop this shim.

def _adapt_v2_to_v1(data: dict) -> dict:
    """If `data` is a v2 workflow file, return an equivalent v1 dict.
    Otherwise pass through unchanged. Pure / non-mutating on its input."""
    if data.get("format_version") != 2:
        return data

    name = data.get("name", "Untitled")
    meta = data.get("meta") or {}
    legacy_id = meta.get("legacy_id") or name

    v1_steps: list = []
    for i, s in enumerate(data.get("steps") or []):
        step_meta = s.get("meta") or {}
        legacy_step_id = step_meta.get("legacy_step_id") or s.get("name") or f"step-{i}"
        label = step_meta.get("label") or s.get("name") or f"Step {i + 1}"

        expression = (s.get("expression") or "").strip()
        formula = f"={expression}" if expression else ""

        # Parse the expression to recover operation_id + config (best-effort;
        # if it fails the StepConfig validator will still run, just with
        # operation_id="" and config={}).
        operation_id = ""
        config: dict = {}
        orchestration: Optional[str] = None
        try:
            from .formula_parser import parse_formula as _parse_fm
            parsed = _parse_fm(formula)
            if parsed.operation_id:
                operation_id = parsed.operation_id
            if parsed.args:
                config = dict(parsed.args)
            orchestration = parsed.orchestration
        except Exception:
            pass

        # v2 expressions don't carry orchestration modifiers — fall back to the
        # operation's default type registered in OPERATION_REGISTRY.
        if not orchestration and operation_id:
            try:
                from .decorators import OPERATION_REGISTRY  # type: ignore
                op_def = OPERATION_REGISTRY.get(operation_id)
                if op_def:
                    default_type = op_def.get("type") if isinstance(op_def, dict) else getattr(op_def, "type", None)
                    if default_type and default_type != "orchestrator":
                        orchestration = default_type
            except Exception:
                pass
        if orchestration:
            config.setdefault("_orchestrator", orchestration)

        v1_steps.append({
            "step_id": legacy_step_id,
            "operation_id": operation_id,
            "label": label,
            "config": config,
            "formula": formula,
        })

    return {
        "id": legacy_id,
        "name": name,
        "created_at": data.get("created_at", ""),
        "updated_at": data.get("updated_at", ""),
        "steps": v1_steps,
    }


# ── Workspace root ───────────────────────────────────────────────────────────
# The "workspace" is the directory the user launched simple-steps from.
# All project/pipeline storage is relative to this root.

WORKSPACE_ROOT = os.environ.get(
    "SIMPLE_STEPS_WORKSPACE",
    os.getcwd(),
)

PROJECTS_DIR = os.environ.get(
    "SIMPLE_STEPS_PROJECTS_DIR",
    os.path.join(WORKSPACE_ROOT, "projects"),
)

_WORKSPACE_PROJECT_PREFIX = "ws_"
WORKFLOW_EXT = ".simple-steps-workflow"
LEGACY_WORKFLOW_EXT = ".json"
WORKFLOW_EXTENSIONS = (WORKFLOW_EXT, LEGACY_WORKFLOW_EXT)


# ── helpers ──────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Convert a display name to a safe directory / file slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "project"


def _project_dir(project_id: str) -> str:
    # Project IDs from list_projects() are already the raw folder name on disk.
    # Just sanitize away anything truly dangerous (path traversal, etc.)
    safe = re.sub(r"[^a-z0-9A-Z\-_]", "", project_id)
    return os.path.join(PROJECTS_DIR, safe)


def _encode_workspace_project_id(abs_dir: str) -> str:
    """Encode an absolute workspace subdirectory as a URL-safe virtual project id."""
    rel = os.path.relpath(abs_dir, WORKSPACE_ROOT)
    token = base64.urlsafe_b64encode(rel.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{_WORKSPACE_PROJECT_PREFIX}{token}"


def _decode_workspace_project_id(project_id: str) -> Optional[str]:
    """Decode a virtual workspace project id back into an absolute directory."""
    if not project_id.startswith(_WORKSPACE_PROJECT_PREFIX):
        return None
    token = project_id[len(_WORKSPACE_PROJECT_PREFIX):]
    if not token:
        return None
    pad = "=" * ((4 - len(token) % 4) % 4)
    try:
        rel = base64.urlsafe_b64decode((token + pad).encode("ascii")).decode("utf-8")
    except Exception:
        return None
    abs_dir = os.path.abspath(os.path.join(WORKSPACE_ROOT, rel))
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    if not abs_dir.startswith(workspace_abs):
        return None
    return abs_dir


def _resolve_project_dir(project_id: str) -> Optional[str]:
    """Resolve either a normal project id or a virtual workspace project id."""
    ws_dir = _decode_workspace_project_id(project_id)
    if ws_dir:
        return ws_dir
    return _project_dir(project_id)


def _is_workflow_filename(name: str) -> bool:
    return any(name.endswith(ext) for ext in WORKFLOW_EXTENSIONS)


def _strip_workflow_extension(name: str) -> str:
    for ext in WORKFLOW_EXTENSIONS:
        if name.endswith(ext):
            return name[:-len(ext)]
    return name


def _pipeline_filename_candidates(pipeline_id: str) -> List[str]:
    """Return candidate workflow filenames for a given pipeline id."""
    base_input = _strip_workflow_extension(pipeline_id)
    slug = _slugify(base_input)
    safe = re.sub(r"[^a-z0-9A-Z\-_]", "", base_input)
    bases = [b for b in (slug, safe, base_input) if b]

    # Dedupe while preserving order
    uniq_bases = []
    for b in bases:
        if b not in uniq_bases:
            uniq_bases.append(b)

    candidates = []
    for b in uniq_bases:
        for ext in (WORKFLOW_EXT, LEGACY_WORKFLOW_EXT):
            candidates.append(f"{b}{ext}")
    return candidates


def _find_pipeline_path(folder: str, pipeline_id: str) -> Optional[str]:
    for candidate in _pipeline_filename_candidates(pipeline_id):
        path = os.path.join(folder, candidate)
        if os.path.exists(path):
            return path
    return None


def _discover_workspace_project_dirs() -> List[str]:
    """Find directories under workspace (outside PROJECTS_DIR) with workflow files."""
    workspace_abs = os.path.abspath(WORKSPACE_ROOT)
    projects_abs = os.path.abspath(PROJECTS_DIR)
    discovered = set()

    skip_names = {
        ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"
    }

    for root, dirs, files in os.walk(workspace_abs):
        dirs[:] = [d for d in dirs if d not in skip_names and not d.startswith(".")]

        root_abs = os.path.abspath(root)
        if root_abs.startswith(projects_abs):
            continue

        if any(_is_workflow_filename(f) for f in files):
            discovered.add(root_abs)

    return sorted(discovered)


def _pipeline_path(project_id: str, pipeline_id: str) -> str:
    folder = _project_dir(project_id)
    found = _find_pipeline_path(folder, pipeline_id)
    if found:
        return found
    # Default path for new saves when nothing exists yet.
    slug = _slugify(_strip_workflow_extension(pipeline_id))
    return os.path.join(folder, f"{slug}{WORKFLOW_EXT}")


def ensure_projects_dir():
    os.makedirs(PROJECTS_DIR, exist_ok=True)


# ── Project-level operations ─────────────────────────────────────────────────

def list_projects() -> List[ProjectInfo]:
    ensure_projects_dir()
    result = []

    # 1) Standard project folders under PROJECTS_DIR
    for entry in sorted(os.listdir(PROJECTS_DIR)):
        full = os.path.join(PROJECTS_DIR, entry)
        if os.path.isdir(full):
            pipelines = [
                _strip_workflow_extension(f)
                for f in sorted(os.listdir(full))
                if _is_workflow_filename(f)
            ]
            result.append(ProjectInfo(id=entry, name=entry.replace("-", " ").title(), pipelines=pipelines))

    # 2) Virtual workspace projects for any json-bearing directories below workspace
    for abs_dir in _discover_workspace_project_dirs():
        rel = os.path.relpath(abs_dir, WORKSPACE_ROOT)
        pipelines = [
            _strip_workflow_extension(f)
            for f in sorted(os.listdir(abs_dir))
            if _is_workflow_filename(f)
        ]
        if not pipelines:
            continue
        result.append(
            ProjectInfo(
                id=_encode_workspace_project_id(abs_dir),
                name=f"Workspace / {rel}",
                pipelines=pipelines,
            )
        )

    return result


def create_project(name: str) -> ProjectInfo:
    ensure_projects_dir()
    project_id = _slugify(name)
    os.makedirs(_project_dir(project_id), exist_ok=True)
    return ProjectInfo(id=project_id, name=name, pipelines=[])


def delete_project(project_id: str) -> bool:
    # Prevent deleting virtual workspace projects through the project-delete API.
    if project_id.startswith(_WORKSPACE_PROJECT_PREFIX):
        return False
    import shutil
    path = _project_dir(project_id)
    if os.path.isdir(path):
        shutil.rmtree(path)
        return True
    return False


# ── Pipeline-level operations ────────────────────────────────────────────────

def list_pipelines(project_id: str) -> List[PipelineFile]:
    """Return all pipeline definitions inside a project folder."""
    folder = _resolve_project_dir(project_id)
    if not os.path.isdir(folder):
        return []
    results = []
    for fname in sorted(os.listdir(folder)):
        if _is_workflow_filename(fname):
            try:
                with open(os.path.join(folder, fname)) as f:
                    data = json.load(f)
                data = _adapt_v2_to_v1(data)
                pf = PipelineFile(**data)
                # Ensure the id matches the on-disk filename slug so that
                # load_pipeline(_slugify(id)) will find the right file.
                file_slug = _strip_workflow_extension(fname)
                if _slugify(pf.id) != file_slug:
                    pf.id = file_slug
                results.append(pf)
            except Exception as e:
                print(f"Error reading {fname}: {e}")
    return results


def load_pipeline(project_id: str, pipeline_id: str) -> Optional[PipelineFile]:
    resolved_dir = _resolve_project_dir(project_id)
    if not resolved_dir:
        return None

    path = _find_pipeline_path(resolved_dir, pipeline_id)
    if not path:
        return None
    try:
        with open(path) as f:
            return PipelineFile(**_adapt_v2_to_v1(json.load(f)))
    except Exception as e:
        print(f"Error loading pipeline {pipeline_id}: {e}")
        return None


def save_pipeline(project_id: str, pipeline: PipelineFile) -> PipelineFile:
    """Save (create or overwrite) a pipeline file inside a project folder."""
    target_dir = _resolve_project_dir(project_id)
    if not target_dir:
        raise ValueError(f"Invalid project_id: {project_id}")

    # Ensure the target folder exists
    os.makedirs(target_dir, exist_ok=True)

    now = datetime.now().isoformat()
    if not pipeline.created_at:
        pipeline.created_at = now
    pipeline.updated_at = now

    # Use pipeline id as filename slug
    pipeline_slug = _slugify(pipeline.id) or _slugify(pipeline.name)
    path = os.path.join(target_dir, f"{pipeline_slug}{WORKFLOW_EXT}")
    with open(path, "w") as f:
        f.write(pipeline.model_dump_json(indent=2))

    return pipeline


def delete_pipeline(project_id: str, pipeline_id: str) -> bool:
    resolved_dir = _resolve_project_dir(project_id)
    if not resolved_dir:
        return False

    path = _find_pipeline_path(resolved_dir, pipeline_id)
    if not path:
        return False
    os.remove(path)
    return True

