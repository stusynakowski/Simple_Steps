import pandas as pd
import uuid
from typing import Dict, Optional, Any
from .decorators import OPERATION_REGISTRY
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
    Orchestrates the running of a single step with dynamic wrappers.
    """
    
    # 1. Resolve Input
    df_in = None
    if input_ref_id:
        df_in = get_dataframe(input_ref_id)
        # We don't error out if df_in is None immediately, maybe source step

    # 2. Find Operation
    op_def = OPERATION_REGISTRY.get(op_id)
    if not op_def:
        raise ValueError(f"Operation {op_id} not registered")
    
    # Extract function and metadata from registry
    # NOTE: The registry structure depends on decorators.py. 
    # Assuming op_def is the dict we stored: {"definition": def, "func": func}
    func = op_def['func']
    # Get suggested op type from definition
    definition = op_def.get('definition')
    # Default to 'dataframe' if not found or if the decorator logic is complex
    suggested_op_type = 'dataframe' 
    # TODO: We need to pull `operation_type` from the metadata. 
    # Currently `OperationDefinition` likely doesn't have it explicitly stored?
    # Let's assume we can pass it or it defaults to 'dataframe'
    
    # Allow config override: { "_orchestrator": "map" }
    # Use underscore to avoid collision with function args
    orchestrator_type = config.get('_orchestrator', suggested_op_type)
    
    # If the user specifically decorated it with a type, we might want to respect that *unless* overridden
    # But for now, we rely on the override or default.
    
    from .orchestrators import ORCHESTRATORS
    wrapper = ORCHESTRATORS.get(orchestrator_type)
    
    # 3. Resolve Arguments / Config
    resolved_config = {}
    
    # Simple reference resolution (can be expanded)
    for k, v in config.items():
        if k.startswith('_'): continue 
        resolved_config[k] = v

    # Inject input dataframe
    # The wrappers in orchestrators.py often look for a DataFrame in kwargs
    if df_in is not None:
        resolved_config['_input_df'] = df_in
    
    if not wrapper:
        # If no wrapper found (or none requested), use raw function
        executable_func = func
    else:
        # Wrap the raw function with the chosen logic
        executable_func = wrapper(func)
    
    # Execute
    print(f"Running '{op_id}' with orchestrator '{orchestrator_type}'")
    try:
        # The wrapper handles pulling the right column, applying the function, etc.
        result_df = executable_func(**resolved_config)
        
        # Ensure result is a DataFrame (wrappers usually guarantee this, but to be safe)
        if not isinstance(result_df, pd.DataFrame):
             print(f"Warning: Operation {op_id} returned {type(result_df)}, expected DataFrame")
             if isinstance(result_df, list):
                 result_df = pd.DataFrame(result_df)
             else:
                 result_df = pd.DataFrame([result_df])
                 
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise ValueError(f"Error executing step {op_id}: {str(e)}")

    # 4. Save Result
    out_ref = save_dataframe(result_df)
    
    metrics = {
        "rows": len(result_df),
        "columns": list(result_df.columns)
    }
    
    return out_ref, metrics
