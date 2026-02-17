import pandas as pd
import inspect
from typing import Callable, List, Any, Optional, Union, Dict
from .operations import register_operation, OperationParam

def adapt_function(
    func: Callable,
    op_id: str,
    label: str,
    description: str,
    params: List[OperationParam],
    output_column: str = "result",
    explode_output: bool = False
):
    """
    Wraps a standard Python function into a Simple Steps operation.
    
    Args:
        func: The domain function to call (e.g., fetch_videos(url)).
        op_id: Unique ID for the operation.
        label: UI Label.
        params: List of UI parameters.
        output_column: If the function returns a single value, what column name to use.
        explode_output: If True, assumes the function returns a list and creates one row per item.
    """
    
    @register_operation(id=op_id, label=label, description=description, params=params)
    def wrapped_operation(df: Optional[pd.DataFrame], config: Dict[str, Any]) -> pd.DataFrame:
        # 1. Map Config/Input to Function Arguments
        # We assume the config keys match the function argument names
        func_args = {}
        sig = inspect.signature(func)
        
        for param_name in sig.parameters:
            if param_name in config:
                val = config[param_name]
                # If the value is a list (from a reference like =Step1!Col), we might need to iterate
                # But for a "Source" operation (no input DF), we usually expect a single scalar config value.
                func_args[param_name] = val
            elif df is not None and param_name in df.columns:
                # If the argument name matches a column in the input DF, we'll use that column
                # This implies an iteration/apply over the rows
                pass

        # 2. Determine Execution Strategy based on Input
        
        # Scentario A: Source Operation (No Input DataFrame)
        # e.g. fetch_channel_videos(url="...")
        if df is None or df.empty:
            try:
                result = func(**func_args)
            except Exception as e:
                # Graceful error for preview
                return pd.DataFrame({"error": [str(e)]})

            # Handle List output (Explode)
            if isinstance(result, list):
                if explode_output:
                    # One row per item
                    # Try to maintain dict structure if items are dicts
                    if result and isinstance(result[0], dict):
                        return pd.DataFrame(result)
                    else:
                        return pd.DataFrame({output_column: result})
                else:
                    # treat list as single cell value? rarely desired in Source ops
                    return pd.DataFrame({output_column: [result]})
            
            # Handle Dict output
            elif isinstance(result, dict):
                return pd.DataFrame([result])
                
            # Handle Scalar
            else:
                return pd.DataFrame({output_column: [result]})

        # Scenario B: Transformation Operation (Has Input DataFrame)
        # e.g. extract_metadata(url_column=...)
        # We need to apply the function to every row
        else:
            results = []
            
            # Identify which arg comes from the column reference
            # The config might say: {"url_arg": "video_url_column"}
            # The user maps function args TO column names in the UI config.
            
            # Simple assumption for this adapter:
            # The UI param name matches the function arg name.
            # The VALUE of that param is the Column Name to use.
            
            for index, row in df.iterrows():
                row_args = {}
                for arg_name, arg_value in config.items():
                    # If config value is a column name in the DF, use the cell value
                    if isinstance(arg_value, str) and arg_value in df.columns:
                        row_args[arg_name] = row[arg_value]
                    else:
                        # Otherwise use the literal config value
                        row_args[arg_name] = arg_value
                
                # Filter args to only those accepted by func to avoid TypeError
                valid_args = {k: v for k, v in row_args.items() if k in sig.parameters}
                
                try:
                    res = func(**valid_args)
                    results.append(res)
                except Exception:
                    results.append(None)
            
            # Combine results
            if explode_output:
                 # If function returns list, we explode the rows
                 # This is complex to merge back with original DF, so we might just return new rows
                 return pd.DataFrame({output_column: results}).explode(output_column)
            
            # Standard enrichment (1-to-1)
            # If result is dict, expand to columns
            if results and isinstance(results[0], dict):
                new_cols = pd.DataFrame(results)
                # Reset index to ensure alignment
                return pd.concat([df.reset_index(drop=True), new_cols.reset_index(drop=True)], axis=1)
            else:
                return df.assign(**{output_column: results})

    return wrapped_operation
