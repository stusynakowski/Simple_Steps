import functools
import inspect
import pandas as pd
from typing import Callable, Any, get_type_hints, Dict, List, Optional
from .models import OperationParam, OperationDefinition

# Global registry for operations
# We will use this to replace the old REGISTRY and DEFINITIONS
OPERATION_REGISTRY: Dict[str, OperationDefinition] = {}
DEFINITIONS_LIST: List[OperationDefinition] = []

def simple_step(name: str = None, category: str = "General", operation_type: str = "map", id: str = None):
    """
    Decorator to transform a vanilla Python function into a SimpleSteps operation.
    
    Args:
        name: Display name for the UI.
        category: For sidebar grouping.
        operation_type: ...
        id: Optional explicit ID. If None, uses function name.
    """
    def decorator(func: Callable):
        # 1. Register Metadata
        op_name = name or func.__name__.replace("_", " ").title()
        op_id = id or func.__name__

        
        # Infer parameters from type hints
        sig = inspect.signature(func)
        type_hints = get_type_hints(func)
        params = []
        for param_name, param in sig.parameters.items():
            if param_name == 'return': continue
            # Map python types to UI types
            py_type = type_hints.get(param_name, Any)
            ui_type = "string"
            if py_type == int: ui_type = "number"
            elif py_type == float: ui_type = "number"
            elif py_type == bool: ui_type = "boolean"
            elif py_type == list or py_type == List: ui_type = "list"
            elif py_type == dict or py_type == Dict: ui_type = "object"
            elif py_type == pd.DataFrame: ui_type = "dataframe"
            
            default_val = param.default if param.default is not inspect.Parameter.empty else None
            params.append(OperationParam(
                name=param_name, 
                type=ui_type, 
                description="No description provided",
                default=default_val
            ))
            
        # 2. Wrap Logic for DataFrame Processing
        @functools.wraps(func)
        def wrapper(inputs: Optional[pd.DataFrame], params: dict) -> pd.DataFrame:
            """
            The Orchestrator calls this wrapper, NOT the original function.
            It handles pulling columns from the DF and applying the logic.
            """
            
            # --- A. SOURCE (Generating Data) ---
            if operation_type == 'source':
                # Pass params directly to function
                # Filter params to only those expected by the function
                func_args = {k: v for k, v in params.items() if k in sig.parameters}
                result = func(**func_args)
                # Ensure output is a DataFrame
                if isinstance(result, pd.DataFrame):
                    return result
                if isinstance(result, list):
                    # If list of dicts, DataFrame(list) works
                    # If list of scalars, DataFrame(list, columns=['output'])
                    if result and isinstance(result[0], dict):
                        return pd.DataFrame(result)
                    return pd.DataFrame(result, columns=['output'])
                return pd.DataFrame([result])

            # --- D. DATAFRAME (Direct DataFrame Manipulation) ---
            if operation_type == 'dataframe':
                # Pass the dataframe and params
                if inputs is None:
                    raise ValueError("Input DataFrame is required for dataframe operations")
                func_args = {k: v for k, v in params.items() if k in sig.parameters}
                # If the function expects the dataframe as an argument
                if 'df' in sig.parameters:
                    func_args['df'] = inputs
                elif 'inputs' in sig.parameters:
                    func_args['inputs'] = inputs
                else: 
                     # Provide as first arg if no name match found, or assume params only?
                     # Let's assume the first arg is the dataframe if not found
                     pass
                
                return func(**func_args)


            # --- B. MAP / EXPAND (Processing Data) ---
            if inputs is None:
                raise ValueError("Input DataFrame is required for map/expand operations")

            # Identify which column from the previous step serves as the main argument
            # For simplicity, assume the first argument of the func maps to the 'active' column
            arg_names = list(sig.parameters.keys())
            
            # If function has no args, standard mapping doesn't make sense, maybe it just adds a constant?
            if not arg_names:
                return inputs

            main_arg = arg_names[0] # The argument that receives the column value
            
            # Smart Column Selection:
            # 1. User specifies '_target_column' in params
            # 2. We use the first column of the input DF
            target_col_name = params.get('_target_column')
            if not target_col_name:
                 if len(inputs.columns) > 0:
                     target_col_name = inputs.columns[0]
                 else:
                     raise ValueError("No columns in input data to map over")
            
            if target_col_name not in inputs.columns:
                raise ValueError(f"Column '{target_col_name}' not found in input data")

            series_input = inputs[target_col_name]
            
            # Prepare other arguments (exclude the main arg and _target_column)
            other_args = {k: v for k, v in params.items() if k in sig.parameters and k != main_arg}
            
            print(f"Running '{op_name}' on column '{target_col_name}'...")

            try:
                # Apply the function to every row
                # We construct the kwargs for the function
                outputs = series_input.apply(lambda x: func(x, **other_args))
            except Exception as e:
                # Basic error handling for row failures
                print(f"Error in row operation '{op_name}': {e}")
                outputs = pd.Series([None] * len(inputs))

            # --- C. HANDLING OUTPUTS ---
            result_df = inputs.copy()
            
            if operation_type == 'expand':
                # If the function returns a list, explode it
                # Logic: create a temp column, explode, then join back? 
                # Or just use the exploded series to create new rows.
                # If we explode, we duplicate the other columns.
                
                # Check if the output is actually a list
                first_valid = outputs.dropna().iloc[0] if not outputs.dropna().empty else None
                if isinstance(first_valid, list):
                    # We need to replicate rows. 
                    # 1. Create a temporary dataframe with index and the new list
                    temp_df = pd.DataFrame({f"{op_name}_out": outputs}, index=inputs.index)
                    # 2. Explode
                    exploded = temp_df.explode(f"{op_name}_out")
                    # 3. Join with original (dropping the target column if we want to replace it? No, keep history)
                    # When exploding, we want to keep the other columns of the original row.
                    result_df = inputs.join(exploded[f"{op_name}_out"], how='right')
                    
                    # If the logical "unit" is now the segment, we might want to rename columns or handle dicts inside
                    # If the list elements are dicts:
                    if exploded[f"{op_name}_out"].apply(lambda x: isinstance(x, dict)).any():
                         # Normalize
                         normalized = pd.json_normalize(exploded[f"{op_name}_out"])
                         normalized.index = result_df.index # Align indices
                         result_df = pd.concat([result_df.drop(columns=[f"{op_name}_out"]), normalized], axis=1)
                    else:
                        result_df[f"{op_name}_output"] = exploded[f"{op_name}_out"]
                        # Drop the temp column if it exists (it shouldn't be in inputs)
                else: 
                     result_df[f"{op_name}_output"] = outputs

            elif isinstance(outputs.iloc[0] if not outputs.empty else None, dict):
                # If function returns dict, expand into columns (Excel-like behavior)
                expanded_cols = pd.json_normalize(outputs)
                # Merge back. Note: json_normalize resets index, we need to be careful
                expanded_cols.index = inputs.index
                result_df = pd.concat([result_df, expanded_cols], axis=1)
            else:
                # Simple scalar return
                result_df[f"{op_name}_output"] = outputs

            return result_df

        # Register
        # Note: We need to store the function callable too, which isn't in Pydantic model
        # So we'll store a tuple or extend the model/registry structure
        # For compatibility with existing engine, we'll store the definition in a list
        # and the function in a dict
        
        definition = OperationDefinition(
            id=op_id,
            label=op_name, 
            description=func.__doc__ or "", 
            params=params
        )
        
        # Store in our registry with extra metadata
        OPERATION_REGISTRY[op_id] = {
            "definition": definition,
            "func": wrapper,
            "category": category,
            "type": operation_type
        }
        DEFINITIONS_LIST.append(definition)
        
        return wrapper
    return decorator
