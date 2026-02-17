from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import pandas as pd

from .models import (
    OperationDefinition, 
    StepRunRequest, 
    StepRunResponse,
    DataViewRequest
)
from .operations import DEFINITIONS as OPERATIONS
from .engine import run_operation, get_dataframe
# Import custom modules to register their operations
from . import youtube_ops 


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
            if pd.isna(val):
                display_val = ""
                actual_val = None
            else:
                display_val = str(val)
                actual_val = val if not pd.isna(val) else None

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
