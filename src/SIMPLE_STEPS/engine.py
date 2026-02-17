import pandas as pd
import uuid
from typing import Dict, Optional, Any
from .operations import REGISTRY
import re

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

def resolve_reference(value: Any, dataset_store: Dict[str, pd.DataFrame], step_id_map: Dict[str, str]) -> Any:
    """
    Resolves Excel-like references in the format =Step Label!Column
    Example: =Step 1!COLA
    """
    if isinstance(value, str) and value.startswith('='):
        # Parse syntax: =StepName!ColumnName
        match = re.match(r'=([^!]+)!(.+)', value[1:])
        if match:
            step_label = match.group(1).strip()
            col_name = match.group(2).strip()
            
            # Find the step ID from the label (this requires passing a mapping of labels to IDs)
            # For this quick implementation, we might need to adjust how we find the dataframe.
            # Assuming we can find the dataframe by label or some lookup.
            # But the current engine works with ref_ids.
            
            # NOTE: To fully implement label-based lookup, we need access to the workflow state 
            # or a mapping. Here is a placeholder logic.
            
            # For now, let's assume the user might actually pass an ID or we need a way 
            # to lookup the ref_id from the step label during the engine execution.
            # Since this function is called inside run_operation, it might be tricky 
            # without the full context.
            pass
            
    return value

def run_operation(
    op_id: str, 
    config: Any, 
    input_ref_id: Optional[str],
    step_label_map: Optional[Dict[str, str]] = None,
    is_preview: bool = False
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
        # Resolve config references
        resolved_config = {}
        for k, v in config.items():
            if isinstance(v, str) and v.startswith('='):
                 # Simple parsing for =StepName!Column
                 # This requires us to have access to previous steps' outputs.
                 # In this isolated function, we only have one input_ref_id.
                 # To support arbitrary step references, the engine needs access to all previous outputs.
                 
                 # PARSING LOGIC:
                 parts = v[1:].split('!')
                 if len(parts) == 2 and step_label_map:
                     step_name, col_name = parts
                     if step_name in step_label_map:
                         ref_id = step_label_map[step_name]
                         step_df = get_dataframe(ref_id)
                         if step_df is not None and col_name in step_df.columns:
                             # For now, let's return the first value or the series depending on need.
                             # If the operation expects a scalar, we might need a specific cell ref like !A1
                             # If it expects a list, we accept the column.
                             resolved_config[k] = step_df[col_name].tolist()
                         else:
                             resolved_config[k] = v # Could not resolve
                     else:
                         resolved_config[k] = v # Step not found
                 else:
                     resolved_config[k] = v
            else:
                resolved_config[k] = v

        # Pass the DataFrame + Config to the developer's function
        # Note: We abstract away the ID management from the developer.
        # They just write: (df, config) -> df
        
        # If the function accepts 'is_preview', pass it. 
        # Otherwise, just call it (most simple ops won't care).
        # For this PoC, we just pass df and config.
        # Future improvement: inspect signature.
        
        # If is_preview is True, we could potentially pass a subset of df_in 
        # to make it faster (e.g. head(5)).
        if is_preview and df_in is not None:
             # Create a lightweight copy for preview
             df_in_run = df_in.head(10).copy()
        else:
             df_in_run = df_in

        df_out = func(df_in_run, resolved_config)
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
