import pandas as pd
import uuid
from typing import Dict, Optional, Any
from .operations import REGISTRY

# --- The "Reference Passing" Store ---
# In production, this might be Redis, Parquet files on disk, or a Database.
# For now, it's a simple Dictionary in RAM.
DATA_STORE: Dict[str, pd.DataFrame] = {}


def get_dataframe(ref_id: str) -> Optional[pd.DataFrame]:
    return DATA_STORE.get(ref_id)

def save_dataframe(df: pd.DataFrame) -> str:
    ref_id = str(uuid.uuid4())
    DATA_STORE[ref_id] = df
    return ref_id

def run_operation(
    op_id: str, 
    config: Any, 
    input_ref_id: Optional[str]
) -> tuple[str, dict]:
    """
    Orchestrates the running of a single step.
    1. Fetches input data (if any).
    2. Runs the registered python function.
    3. Saves result.
    4. Returns new Ref ID + Metrics.
    """
    
    # 1. Resolve Input
    df_in = None
    if input_ref_id:
        df_in = get_dataframe(input_ref_id)
        if df_in is None:
            raise ValueError(f"Input reference {input_ref_id} not found/expired")

    # 2. Find Operation
    func = REGISTRY.get(op_id)
    if not func:
        raise ValueError(f"Operation {op_id} not registered")

    # 3. Execute (with basic error handling)
    try:
        # Pass the DataFrame + Config to the developer's function
        # Note: We abstract away the ID management from the developer.
        # They just write: (df, config) -> df
        df_out = func(df_in, config)
    except Exception as e:
        raise RuntimeError(f"Operation failed: {str(e)}")

    if not isinstance(df_out, pd.DataFrame):
        raise RuntimeError("Operation did not return a DataFrame")

    # 4. Save Output Reference
    out_ref = save_dataframe(df_out)

    # 5. Metrics
    metrics = {
        "rows": len(df_out),
        "columns": list(df_out.columns)
    }

    return out_ref, metrics
