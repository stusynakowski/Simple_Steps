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
    Receives: Config + Input Reference ID
    Returns: New Output Reference ID
    """
    try:
        # The Engine handles the heavy lifting
        # It never transmits the full DataFrame over HTTP
        out_ref, metrics = run_operation(
            payload.operation_id,
            payload.config,
            payload.input_ref_id
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
    # Handling potential out-of-bounds with python slicing
    subset = df.iloc[offset : offset + limit]
    
    # Convert to JSON-friendly dict
    # orient='records' -> [{col1: val, col2: val}, ...]
    return subset.to_dict(orient="records")

if __name__ == "__main__":
    import uvicorn
    # Use reload=True for dev experience
    uvicorn.run("SIMPLE_STEPS.main:app", host="0.0.0.0", port=8000, reload=True)
