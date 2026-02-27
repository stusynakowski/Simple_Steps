from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import pandas as pd
import numpy as np

from .models import (
    OperationDefinition, 
    StepRunRequest, 
    StepRunResponse,
    DataViewRequest
)
from .operations import DEFINITIONS as OPERATIONS
from .engine import run_operation, get_dataframe
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
    
    # 2. Add your custom absolute paths here:
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
        # In production, log error details
        raise HTTPException(status_code=400, detail=str(e))

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
