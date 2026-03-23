from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
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
from .file_manager import (
    list_projects, create_project, delete_project,
    list_pipelines, load_pipeline, save_pipeline, delete_pipeline,
)
import sys
import os
import importlib.util

# --- USER CONFIGURATION ---
# Add any folder path here. The system will recursively find all _ops.py files.
PLUGIN_PATHS = [
    # 1. Built-in sibling directories (relative to this file)
    os.path.join(os.path.dirname(__file__), "../youtube_operations"),
    os.path.join(os.path.dirname(__file__), "../llm_operations"),
    os.path.join(os.path.dirname(__file__), "../webscraping_operations"),
    
    # 2. Mock operations (for development / demo)
    os.path.join(os.path.dirname(__file__), "../../mock_operations"),
    
    # 3. Add your custom absolute paths here:
    # "/Users/myname/projets/my_custom_ops"
]

# --- Plugin Discovery Logic ---
def register_plugins(paths: List[str]):
    """
    Crawls provided paths for python files ending in '_ops.py' 
    and imports them to trigger registrations.
    """
    for folder_path in paths:
        # Resolve absolute path
        abs_path = os.path.abspath(folder_path)
        
        if not os.path.exists(abs_path):
            continue # Skip missing optional folders
            
        print(f"📂 Scanning: {abs_path}")
        
        # Add to sys.path to allow internal relative imports within those plugins
        if abs_path not in sys.path:
            sys.path.append(abs_path)

        # Walk through the directory (in case they are nested)
        for root, dirs, files in os.walk(abs_path):
            for file in files:
                if file.endswith("_ops.py") or file.startswith("ops_"):
                    full_path = os.path.join(root, file)
                    module_name = file[:-3]
                    
                    try:
                        spec = importlib.util.spec_from_file_location(module_name, full_path)
                        if spec and spec.loader:
                            module = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(module)
                            print(f"  ✅ Registered: {module_name}")
                    except Exception as e:
                        print(f"  ❌ Error loading {file}: {e}")

# Run registration immediately
register_plugins(PLUGIN_PATHS)


# --- App Initialize ---
app = FastAPI(
    title="Simple Steps Backend",
    description="Orchestrates data operations defined by developers"
)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Frontend Port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    return {
        "registered_operations": {
            op_id: {
                "label": entry["definition"].label,
                "category": entry["category"],
                "type": entry["type"],
                "params_count": len(entry["definition"].params),
                "func_name": entry["func"].__name__,
                "func_module": getattr(entry["func"], "__module__", "unknown"),
            }
            for op_id, entry in OPERATION_REGISTRY.items()
        },
        "definitions_count": len(DEFINITIONS_LIST),
        "plugin_paths_scanned": [os.path.abspath(p) for p in PLUGIN_PATHS],
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

# --- 1.5 Project / Pipeline Management ---

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

if __name__ == "__main__":
    import uvicorn
    # Use reload=True for dev experience
    uvicorn.run("SIMPLE_STEPS.main:app", host="0.0.0.0", port=8000, reload=True)
