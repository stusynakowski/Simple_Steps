from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import pandas as pd
import numpy as np
import traceback as tb_module

from .models import (
    OperationDefinition,
    StepRunRequest,
    StepRunResponse,
    DataViewRequest,
    ProjectInfo,
    PipelineFile,
)
from .operations import DEFINITIONS as OPERATIONS
from .engine import run_operation, get_dataframe
from . import orchestration_ops  # noqa: F401 — registers ss_map, ss_filter, ss_expand, ss_reduce
from .operation_pack import PACK_REGISTRY
from .pack_loader import PackLoader, OpTier, set_loader, get_loader
from .file_manager import (
    list_projects, create_project, delete_project,
    list_pipelines, load_pipeline, save_pipeline, delete_pipeline,
    PROJECTS_DIR,
    WORKSPACE_ROOT,
)
from .agent.routes import router as agent_router
from .pack_manager import get_manifest_pack_dirs, load_manifest
import sys
import os

# ── Workspace-relative discovery ─────────────────────────────────────────────
#
# When a user boots Simple Steps from a directory (`cd ~/my-repo && simple-steps`)
# that directory becomes the "workspace root".  The platform automatically
# discovers:
#
#   <workspace>/projects/   → project folders containing pipeline JSON files
#   <workspace>/packs/      → developer packs (Tier 2) with @simple_step functions
#   <workspace>/ops/        → workspace-level custom operations
#   <workspace>/*.py        → top-level .py files with @simple_step functions
#
# This means any repo that contains a projects/ folder "just works" when you
# run `simple-steps` from inside it.
#
# Tier 1 — System ops: always loaded (operations.py, orchestration_ops.py)
# Tier 2 — Developer packs: packs/ in workspace + any --packs dirs
# Tier 3 — Project ops: per-project custom functions (projects/<name>/**)
#

_PKG_DIR = os.path.dirname(__file__)
_WORKSPACE = os.path.abspath(WORKSPACE_ROOT)

# Developer pack directories (Tier 2)
_DEVELOPER_PACK_DIRS: list[str] = []

# 1. Workspace-local packs/ directory (primary — the user's own packs)
_ws_packs = os.path.join(_WORKSPACE, "packs")
if os.path.isdir(_ws_packs):
    _DEVELOPER_PACK_DIRS.append(_ws_packs)

# 2. Workspace-local ops/ directory (flat custom operations)
_ws_ops = os.path.join(_WORKSPACE, "ops")
if os.path.isdir(_ws_ops):
    _DEVELOPER_PACK_DIRS.append(_ws_ops)

# 3. Workspace root itself — pick up any top-level *.py files with decorators
#    (treated as a pack dir so the loader scans .py files in it)
_ws_has_py = any(
    f.endswith(".py") and not f.startswith("__")
    for f in os.listdir(_WORKSPACE)
    if os.path.isfile(os.path.join(_WORKSPACE, f))
)
if _ws_has_py:
    _DEVELOPER_PACK_DIRS.append(_WORKSPACE)

# 4. Package-bundled packs/ directory (ships with the simple-steps repo itself)
_bundled_packs = os.path.abspath(os.path.join(_PKG_DIR, "../../packs"))
if os.path.isdir(_bundled_packs) and os.path.abspath(_bundled_packs) != os.path.abspath(_ws_packs):
    _DEVELOPER_PACK_DIRS.append(_bundled_packs)

# 5. Legacy sibling directories inside the simple-steps source tree
for _legacy_name in ("youtube_operations", "llm_operations", "webscraping_operations"):
    _legacy = os.path.join(_PKG_DIR, "..", _legacy_name)
    if os.path.isdir(_legacy):
        _DEVELOPER_PACK_DIRS.append(os.path.abspath(_legacy))

# 6. Mock operations (only when running from the simple-steps repo itself)
_mock_dir = os.path.abspath(os.path.join(_PKG_DIR, "../../mock_operations"))
if os.path.isdir(_mock_dir):
    _DEVELOPER_PACK_DIRS.append(_mock_dir)

# 7. Additional pack dirs from environment / CLI flags
_extra_packs = os.environ.get("SIMPLE_STEPS_PACKS_DIR", "")
if _extra_packs:
    _DEVELOPER_PACK_DIRS.extend(p.strip() for p in _extra_packs.split(";") if p.strip())

_extra_ops = os.environ.get("SIMPLE_STEPS_EXTRA_OPS", "")
if _extra_ops:
    _DEVELOPER_PACK_DIRS.extend(p.strip() for p in _extra_ops.split(";") if p.strip())

# 8. Packs declared in simple_steps.toml manifest
_manifest_dirs = get_manifest_pack_dirs(_WORKSPACE)
for _md in _manifest_dirs:
    if _md not in _DEVELOPER_PACK_DIRS:
        _DEVELOPER_PACK_DIRS.append(_md)

# Discover all project directories for Tier 3
def _discover_project_dirs() -> List[str]:
    """Find all project folders that contain Python files anywhere in the tree."""
    projects_root = os.path.abspath(PROJECTS_DIR)
    if not os.path.isdir(projects_root):
        return []
    dirs = []
    for entry in os.listdir(projects_root):
        proj_path = os.path.join(projects_root, entry)
        if not os.path.isdir(proj_path):
            continue
        # Walk the whole project tree looking for at least one .py file
        has_py = False
        for root, _subdirs, files in os.walk(proj_path):
            # Skip __pycache__ and hidden dirs
            _subdirs[:] = [d for d in _subdirs if not d.startswith(".") and d != "__pycache__"]
            if any(f.endswith(".py") and not f.startswith("__") for f in files):
                has_py = True
                break
        if has_py:
            dirs.append(proj_path)
    return dirs

# Initialize and run the Pack Loader
_loader = PackLoader(
    developer_pack_dirs=_DEVELOPER_PACK_DIRS,
    project_dirs=_discover_project_dirs(),
)
_loader.load_all()
set_loader(_loader)


# --- App Initialize ---
app = FastAPI(
    title="Simple Steps Backend",
    description="Orchestrates data operations defined by developers"
)

# --- Agent Router ---
app.include_router(agent_router)

# --- Middleware ---
# Allow any localhost port so multiple Simple Steps instances can co-exist
# (Streamlit-style port auto-increment means we may run on :8001, :8002, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 0. Workspace Info ---
@app.get("/api/workspace")
async def workspace_info():
    """
    Returns information about the current workspace root and what was
    discovered at startup.  The frontend uses this for the sidebar
    header and diagnostics.
    """
    loader = get_loader()
    by_tier = loader.get_ops_by_tier() if loader else {}

    # Count projects and pipelines
    project_count = 0
    pipeline_count = 0
    project_names = []
    if os.path.isdir(PROJECTS_DIR):
        for entry in sorted(os.listdir(PROJECTS_DIR)):
            full = os.path.join(PROJECTS_DIR, entry)
            if os.path.isdir(full):
                project_count += 1
                project_names.append(entry)
                pipeline_count += sum(
                    1 for f in os.listdir(full) if f.endswith(".json")
                )

    return {
        "workspace_root": _WORKSPACE,
        "projects_dir": os.path.abspath(PROJECTS_DIR),
        "project_count": project_count,
        "pipeline_count": pipeline_count,
        "project_names": project_names,
        "has_packs": os.path.isdir(os.path.join(_WORKSPACE, "packs")),
        "has_ops": os.path.isdir(os.path.join(_WORKSPACE, "ops")),
        "has_manifest": os.path.isfile(os.path.join(_WORKSPACE, "simple_steps.toml")),
        "developer_pack_dirs": [os.path.abspath(p) for p in _DEVELOPER_PACK_DIRS],
        "ops_by_tier": by_tier,
        "total_operations": sum(len(ops) for ops in by_tier.values()),
    }


# --- 0b. Pack Management ---
@app.get("/api/packs")
async def api_list_packs():
    """List all packs declared in the workspace manifest."""
    from .pack_manager import list_packs
    entries = list_packs(_WORKSPACE)
    return [
        {
            "name": e.name,
            "source": e.source.value,
            "url": e.url,
            "ref": e.ref,
            "path": e.path,
            "package": e.package,
            "enabled": e.enabled,
        }
        for e in entries
    ]


@app.post("/api/packs")
async def api_add_pack(body: dict = Body(...)):
    """
    Add a pack to the workspace manifest.

    Body:
        source: "git" | "local" | "pip"
        url: git URL (for source=git)
        path: local path (for source=local)
        package: pip package name (for source=pip)
        name: optional custom name
        ref: optional git ref (default: main)
    """
    from .pack_manager import add_pack_git, add_pack_local, add_pack_pip

    source = body.get("source", "")
    name = body.get("name")

    try:
        if source == "git":
            entry = add_pack_git(
                _WORKSPACE, body["url"],
                name=name, ref=body.get("ref", "main"),
                clone=True,
            )
        elif source == "local":
            entry = add_pack_local(_WORKSPACE, body["path"], name=name)
        elif source == "pip":
            entry = add_pack_pip(
                _WORKSPACE, body["package"],
                name=name, install=True,
            )
        else:
            raise HTTPException(400, f"Unknown source: {source}")
    except Exception as e:
        raise HTTPException(400, str(e))

    return {
        "name": entry.name,
        "source": entry.source.value,
        "url": entry.url,
        "path": entry.path,
        "package": entry.package,
    }


@app.delete("/api/packs/{pack_name}")
async def api_remove_pack(pack_name: str, delete_files: bool = False):
    """Remove a pack from the manifest."""
    from .pack_manager import remove_pack
    removed = remove_pack(_WORKSPACE, pack_name, delete_files=delete_files)
    if not removed:
        raise HTTPException(404, f"Pack '{pack_name}' not found in manifest")
    return {"removed": pack_name}


@app.post("/api/packs/install")
async def api_install_packs():
    """Install/sync all packs declared in the manifest."""
    from .pack_manager import install_all
    issues = install_all(_WORKSPACE)
    return {"success": len(issues) == 0, "issues": issues}


# --- 1. Dynamic Discovery ---
@app.get("/api/operations", response_model=List[OperationDefinition])
async def list_operations():
    """
    Returns the catalogue of available Python operations.
    Run on app startup or when developer adds new functions.
    """
    return OPERATIONS


# --- 1.1 Diagnostics / Debug ---
@app.get("/api/debug/registry")
async def debug_registry():
    """
    Returns the raw registry state for debugging — shows every registered
    operation ID, category, type, and the number of params.
    Useful for diagnosing 'function not registered' errors.
    """
    from .decorators import OPERATION_REGISTRY, DEFINITIONS_LIST
    loader = get_loader()
    return {
        "registered_operations": {
            op_id: {
                "label": entry["definition"].label,
                "category": entry["category"],
                "type": entry["type"],
                "tier": entry.get("tier", "system"),
                "source_file": entry.get("source_file", "<built-in>"),
                "params_count": len(entry["definition"].params),
                "func_name": entry["func"].__name__,
                "func_module": getattr(entry["func"], "__module__", "unknown"),
            }
            for op_id, entry in OPERATION_REGISTRY.items()
        },
        "definitions_count": len(DEFINITIONS_LIST),
        "ops_by_tier": loader.get_ops_by_tier() if loader else {},
        "developer_pack_dirs": [os.path.abspath(p) for p in _DEVELOPER_PACK_DIRS],
    }


# --- 1.2 Operation Packs Health ---
@app.get("/api/packs")
async def list_packs():
    """
    Returns status of all registered OperationPacks — useful for
    the Resources dropdown or a developer diagnostics page.
    """
    result = []
    for name, pack in PACK_REGISTRY.items():
        health = pack.health()
        result.append({
            "name": pack.name,
            "version": pack.version,
            "description": pack.description,
            "available": pack.is_available,
            "operation_ids": pack.operation_ids,
            "health": {
                "ok": health.ok,
                "checks": health.checks,
                "errors": health.errors,
            },
        })
    return result

# --- 1.3 Pack Loader Status ---
@app.get("/api/loader")
async def loader_status():
    """
    Returns the three-tier pack loader state — what was loaded from
    where, organized by tier (system / developer_pack / project).
    """
    loader = get_loader()
    if not loader:
        return {"error": "Pack loader not initialized"}

    by_tier = loader.get_ops_by_tier()
    results = loader.get_results()
    return {
        "ops_by_tier": by_tier,
        "total_operations": sum(len(ops) for ops in by_tier.values()),
        "load_results": [
            {
                "file": r.file_path,
                "tier": r.tier.value,
                "success": r.success,
                "ops_registered": r.ops_registered,
                "error": r.error,
            }
            for r in results
        ],
    }


# --- 1.4 Load Project Ops On-Demand ---
@app.post("/api/projects/{project_id}/load-ops")
async def load_project_ops(project_id: str):
    """
    Scan a project's directory recursively and register any @simple_step
    functions found.  Call this when switching projects or after adding
    new .py files to a project.
    """
    loader = get_loader()
    if not loader:
        raise HTTPException(status_code=500, detail="Pack loader not initialized")

    project_dir = os.path.join(os.path.abspath(PROJECTS_DIR), project_id)
    if not os.path.isdir(project_dir):
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    results = loader.load_project(project_dir)
    return {
        "project_id": project_id,
        "files_scanned": len(results),
        "ops_registered": [op for r in results if r.success for op in r.ops_registered],
        "errors": [{"file": r.file_path, "error": r.error} for r in results if not r.success],
    }


# --- 1.5 Developer Packs Directory Listing ---
@app.get("/api/developer-packs")
async def list_developer_packs():
    """
    Returns every known developer pack directory with the operations
    it contributed.  The UI uses this to show which packs are available
    and let users toggle them.
    """
    loader = get_loader()
    if not loader:
        return []

    results = loader.get_results()
    # Group load results by top-level developer-pack directory
    pack_map: dict = {}
    for r in results:
        if r.tier != OpTier.DEVELOPER_PACK:
            continue
        # Identify which developer pack dir this file belongs to
        abs_file = os.path.abspath(r.file_path) if r.file_path else ""
        parent_pack_dir = None
        for d in _DEVELOPER_PACK_DIRS:
            abs_d = os.path.abspath(d)
            if abs_file.startswith(abs_d):
                parent_pack_dir = abs_d
                break
        if not parent_pack_dir:
            parent_pack_dir = os.path.dirname(abs_file) if abs_file else "unknown"

        if parent_pack_dir not in pack_map:
            pack_map[parent_pack_dir] = {
                "id": os.path.basename(parent_pack_dir),
                "name": os.path.basename(parent_pack_dir).replace("_", " ").title(),
                "path": parent_pack_dir,
                "operations": [],
                "errors": [],
                "enabled": True,  # currently all discovered packs are auto-loaded
            }
        if r.success:
            pack_map[parent_pack_dir]["operations"].extend(r.ops_registered)
        if r.error:
            pack_map[parent_pack_dir]["errors"].append(r.error)

    return list(pack_map.values())


# --- 1.6 Project / Pipeline Management ---

# Projects (folders)
@app.get("/api/projects", response_model=List[ProjectInfo])
async def get_projects():
    """List all project folders with their pipeline filenames."""
    return list_projects()

@app.post("/api/projects", response_model=ProjectInfo)
async def create_new_project(body: dict = Body(...)):
    """Create a new project folder."""
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    return create_project(name)

@app.delete("/api/projects/{project_id}")
async def remove_project(project_id: str):
    """Delete an entire project folder and all its pipelines."""
    if not delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted"}

# Pipelines (files inside a project folder)
@app.get("/api/projects/{project_id}/pipelines", response_model=List[PipelineFile])
async def get_pipelines(project_id: str):
    """List all pipeline definitions in a project."""
    return list_pipelines(project_id)

@app.get("/api/projects/{project_id}/pipelines/{pipeline_id}", response_model=PipelineFile)
async def get_pipeline(project_id: str, pipeline_id: str):
    """Load a single pipeline definition."""
    pipeline = load_pipeline(project_id, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipeline

@app.post("/api/projects/{project_id}/pipelines", response_model=PipelineFile)
async def upsert_pipeline(project_id: str, pipeline: PipelineFile):
    """Create or overwrite a pipeline file inside a project."""
    return save_pipeline(project_id, pipeline)

@app.delete("/api/projects/{project_id}/pipelines/{pipeline_id}")
async def remove_pipeline(project_id: str, pipeline_id: str):
    """Delete a single pipeline file."""
    if not delete_pipeline(project_id, pipeline_id):
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return {"status": "deleted"}


# --- 2. Step Execution (Command) ---
@app.post("/api/run", response_model=StepRunResponse)
async def execute_step(payload: StepRunRequest):
    """
    Executes a single step.
    Receives: Config + Input Reference ID + Reference Map
    Returns: New Output Reference ID
    """
    try:
        # The Engine handles the heavy lifting
        # It never transmits the full DataFrame over HTTP
        out_ref, metrics = run_operation(
            payload.operation_id,
            payload.config,
            payload.input_ref_id,
            payload.step_map,
            payload.is_preview
        )
        
        return StepRunResponse(
            status="success",
            output_ref_id=out_ref,
            metrics=metrics
        )
    except Exception as e:
        # Return structured error with traceback for frontend log panel
        error_tb = tb_module.format_exc()
        print(f"❌ Step execution failed: {e}")
        print(error_tb)
        return JSONResponse(
            status_code=400,
            content={
                "detail": str(e),
                "error_type": type(e).__name__,
                "traceback": error_tb,
                "operation_id": payload.operation_id,
                "step_id": payload.step_id,
            }
        )

# --- 3. Data View (Query) ---
@app.get("/api/data/{ref_id}")
async def get_data_view(
    ref_id: str, 
    offset: int = 0, 
    limit: int = 50
):
    """
    Returns a slice of data for the Frontend Grid.
    This is lightweight and fast.
    """
    df = get_dataframe(ref_id)
    if df is None:
        raise HTTPException(status_code=404, detail="Data reference expired")
    
    # Slice the dataframe safely
    subset = df.iloc[offset : offset + limit]
    
    cells = []
    
    if subset.empty:
        return []

    # Reset index to ensure we iterate cleanly 0..N within this page
    # In a real app, we might want to keep the original index
    subset_reset = subset.reset_index(drop=True)

    for i, row in subset_reset.iterrows():
        # The absolute row index (for pagination context)
        current_row_idx = offset + int(i)

        for col_name, val in row.items():
            # Handle list/array values correctly to avoid ValueError
            if isinstance(val, (list, tuple, np.ndarray)):
                display_val = str(val)
                actual_val = val
            elif pd.isna(val):
                display_val = ""
                actual_val = None
            else:
                display_val = str(val)
                actual_val = val

            cells.append({
                "row_id": current_row_idx,
                "column_id": str(col_name),
                "value": actual_val,
                "display_value": display_val
            })

    return cells

# ── Serve bundled frontend (SPA) ────────────────────────────────────────────
# The built React app lives in the package at SIMPLE_STEPS/frontend_dist/.
# When installed via pip, the dist is bundled into the package.
# This MUST come after all /api/* routes so API takes precedence.

_FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend_dist")

if os.path.isdir(_FRONTEND_DIR):
    from fastapi.responses import FileResponse

    # Serve static assets (JS, CSS, images)
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_FRONTEND_DIR, "assets")),
        name="frontend-assets",
    )

    # Serve other static files at root level (vite.svg, etc.)
    @app.get("/vite.svg")
    async def vite_svg():
        path = os.path.join(_FRONTEND_DIR, "vite.svg")
        if os.path.exists(path):
            return FileResponse(path, media_type="image/svg+xml")
        raise HTTPException(status_code=404)

    # SPA fallback: any non-API route serves index.html
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Don't intercept API routes (they're already mounted above)
        if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("openapi"):
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(_FRONTEND_DIR, "index.html"))
else:
    @app.get("/")
    async def no_frontend():
        return {
            "message": "Simple Steps API is running. Frontend not bundled.",
            "hint": "Run 'simple-steps-build' to bundle the frontend, or use the Vite dev server at http://localhost:5173",
            "docs": "/docs",
        }


if __name__ == "__main__":
    import uvicorn
    # Use reload=True for dev experience
    uvicorn.run("SIMPLE_STEPS.main:app", host="0.0.0.0", port=8000, reload=True)
