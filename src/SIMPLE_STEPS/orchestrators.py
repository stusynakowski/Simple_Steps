import pandas as pd
from typing import Callable, Any, List, Dict, Optional
import inspect

# --- Helper Functions ---

def _extract_df(kwargs: Dict[str, Any], args: tuple) -> Optional[pd.DataFrame]:
    """Finds the first DataFrame in arguments."""
    for v in kwargs.values():
        if isinstance(v, pd.DataFrame): return v
    for v in args:
        if isinstance(v, pd.DataFrame): return v
    return None

def _determine_target_col(df: pd.DataFrame, kwargs: Dict[str, Any], func: Callable = None) -> str:
    """
    Determines which column to operate on.
    Priority:
    1. Argument name matches a column name (e.g. url="video_url")
    2. Explicit '_target_column' in kwargs
    3. First column of the DataFrame
    """
    if df is None or df.empty: return None
    
    # 1. Check if any kwarg key matches a function argument AND value matches a column
    if func:
        sig = inspect.signature(func)
        for param_name in sig.parameters:
            if param_name in kwargs:
                val = kwargs[param_name]
                if isinstance(val, str) and val in df.columns:
                    return val

    # 2. explicit target
    if '_target_column' in kwargs and kwargs['_target_column'] in df.columns:
        return kwargs['_target_column']
        
    # 3. Default to first column
    return df.columns[0]

# --- Orchestrator Wrappers ---

def source_wrapper(func: Callable) -> Callable:
    """
    Wraps a function that returns a list of items (or single item).
    Returns a DataFrame where the result is in a column 'output'.
    """
    def wrapper(*args, **kwargs) -> pd.DataFrame:
        print(f"[Orchestrator:Source] Executing {func.__name__}...")
        # Source operations don't use the input DataFrame — strip it
        kwargs.pop('_input_df', None)
        result = func(*args, **kwargs)
        
        if result is None:
            return pd.DataFrame()

        # If it's a DataFrame already, return it
        if isinstance(result, pd.DataFrame):
            return result

        # If it's a list, check content
        if isinstance(result, list):
            if not result:
                return pd.DataFrame(columns=['output'])
            # If list of dicts -> DataFrame with keys as cols
            if isinstance(result[0], dict):
                return pd.DataFrame(result)
            # If list of scalars -> DataFrame with 'output' col
            return pd.DataFrame({'output': result})
        
        # If it's a dict, it might be a single row
        if isinstance(result, dict):
            return pd.DataFrame([result])
            
        # Fallback for scalars
        return pd.DataFrame({'output': [result]})
    return wrapper

def rowmap_wrapper(func: Callable) -> Callable:
    """
    Wraps a function designed for a single item (e.g., str -> dict).
    Iterates over rows of the input DataFrame.
    """
    def wrapper(*args, **kwargs) -> pd.DataFrame:
        input_df = _extract_df(kwargs, args)
        
        if input_df is None:
            # Fallback: Treat as a single scalar call
            print(f"[Orchestrator:Map] No DataFrame input, executing {func.__name__} once.")
            single_res = func(*args, **kwargs)
            if isinstance(single_res, pd.DataFrame): return single_res
            if isinstance(single_res, dict): return pd.DataFrame([single_res])
            return pd.DataFrame({'output': [single_res]})

        target_col = _determine_target_col(input_df, kwargs, func)
        print(f"[Orchestrator:Map] Mapping {func.__name__} over column '{target_col}'")
        
        # Determine the argument name to pass the value to
        sig = inspect.signature(func)
        # Default to first argument
        main_arg_name = list(sig.parameters.keys())[0] if sig.parameters else None

        # Prepare valid kwargs for the function (exclude the dataframe itself if not expected)
        func_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters and not isinstance(v, pd.DataFrame)}

        # Apply logic
        try:
            # We construct a wrapper for applying to handle the main argument logic
            def apply_func(val):
                # Inject the row value into the main argument
                if main_arg_name:
                    func_kwargs[main_arg_name] = val
                return func(**func_kwargs)

            applied = input_df[target_col].apply(apply_func)
            
            # Construct Result
            result_df = input_df.copy().reset_index(drop=True)
            
            # If every returned value is a dict, expand keys into separate columns so
            # that the new fields align 1-to-1 with the original rows.
            # This prevents metadata misalignment when a map function returns a dict.
            first_val = applied.iloc[0] if len(applied) > 0 else None
            if isinstance(first_val, dict):
                expanded = applied.apply(pd.Series).reset_index(drop=True)
                result_df = pd.concat([result_df, expanded], axis=1)
            else:
                new_col_name = f"{func.__name__}_output"
                result_df[new_col_name] = applied.reset_index(drop=True)
                
            return result_df
            
        except Exception as e:
            print(f"[Orchestrator:Map] Error: {e}")
            raise e

    return wrapper

def filter_wrapper(func: Callable) -> Callable:
    """
    Expects a function that returns True/False.
    Filters the input DataFrame rows based on the column value.
    """
    def wrapper(*args, **kwargs) -> pd.DataFrame:
        input_df = _extract_df(kwargs, args)
        if input_df is None: return pd.DataFrame()

        target_col = _determine_target_col(input_df, kwargs, func)
        print(f"[Orchestrator:Filter] Filtering on '{target_col}' using {func.__name__}")

        # Prepare kwargs
        sig = inspect.signature(func)
        func_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters and not isinstance(v, pd.DataFrame)}
        main_arg_name = list(sig.parameters.keys())[0] if sig.parameters else None

        def check_func(val):
            if main_arg_name:
                func_kwargs[main_arg_name] = val
            return bool(func(**func_kwargs))

        mask = input_df[target_col].apply(check_func)
        return input_df[mask].reset_index(drop=True)
    return wrapper

def expand_wrapper(func: Callable) -> Callable:
    """
    Expects a function that returns a List.
    Explodes the dataframe so one row becomes N rows.
    """
    def wrapper(*args, **kwargs) -> pd.DataFrame:
        input_df = _extract_df(kwargs, args)
        if input_df is None:
            # Fallback for scalar input -> just run generic source/expand logic
            # Creates a single-row DF then explodes it
            seed = func(*args, **kwargs)
            if isinstance(seed, list):
                return pd.DataFrame({'expanded': seed})
            return pd.DataFrame({'expanded': [seed]})

        target_col = _determine_target_col(input_df, kwargs, func)
        print(f"[Orchestrator:Expand] Exploding '{target_col}' using {func.__name__}")

        # Prepare kwargs
        sig = inspect.signature(func)
        func_kwargs = {k: v for k, v in kwargs.items() if k in sig.parameters and not isinstance(v, pd.DataFrame)}
        main_arg_name = list(sig.parameters.keys())[0] if sig.parameters else None

        def get_list(val):
            if main_arg_name:
                func_kwargs[main_arg_name] = val
            res = func(**func_kwargs)
            return res if isinstance(res, list) else [res]

        # 1. Apply function to generate lists
        temp_col = f"__{func.__name__}_list"
        input_df[temp_col] = input_df[target_col].apply(get_list)
        
        # 2. Explode
        expanded = input_df.explode(temp_col)
        
        # 3. Handle complex objects in list?
        # For now, just rename the temp column to output
        expanded = expanded.rename(columns={temp_col: f"{func.__name__}_output"})
        
        # If the output is dicts, normalize?
        # (This can be expensive, maybe optional?)
        
        return expanded.reset_index(drop=True)
    return wrapper

def dataframe_op_wrapper(func: Callable) -> Callable:
    """
    Wraps a function that natively expects a DataFrame.
    Extracts _input_df from kwargs and injects it as the 'df' or 'data'
    parameter (whichever the function expects), then calls the function.
    """
    def wrapper(*args, **kwargs) -> pd.DataFrame:
        print(f"[Orchestrator:DataFrame] Executing {func.__name__}...")
        
        # Extract the injected DataFrame and remap it to the function's
        # expected parameter name (typically 'df' or 'data').
        input_df = kwargs.pop('_input_df', None)
        if input_df is not None:
            sig = inspect.signature(func)
            # Find the parameter that expects a DataFrame
            df_param = None
            for pname, p in sig.parameters.items():
                hints = {}
                try:
                    from typing import get_type_hints
                    hints = get_type_hints(func)
                except Exception:
                    pass
                if pname in ('df', 'data') or hints.get(pname) is pd.DataFrame:
                    df_param = pname
                    break
            if df_param and df_param not in kwargs:
                kwargs[df_param] = input_df
            elif df_param is None:
                # No recognized DataFrame param — pass as first positional arg
                args = (input_df,) + tuple(args)
        
        res = func(*args, **kwargs)
        if not isinstance(res, pd.DataFrame):
            return pd.DataFrame({'result': [res]})
        return res
    return wrapper

def raw_output_wrapper(func: Callable) -> Callable:
    """
    Calls the function with no orchestration — no DataFrame injection, no row mapping.
    Whatever the function returns is normalized into a DataFrame for visualization:
      - DataFrame  → returned as-is
      - list of dicts → DataFrame with dict keys as columns
      - list of scalars → single-column DataFrame ('output')
      - dict → single-row DataFrame
      - scalar → single-cell DataFrame ('output')
    This lets the user inspect the raw return value of a function before any
    orchestration decorator is applied.
    """
    def wrapper(*args, **kwargs) -> pd.DataFrame:
        # Strip internal plumbing keys before calling the raw function
        clean_kwargs = {k: v for k, v in kwargs.items() if not k.startswith('_')}
        print(f"[Orchestrator:RawOutput] Executing {func.__name__} with no orchestration...")
        result = func(*clean_kwargs) if not clean_kwargs else func(**clean_kwargs)

        if isinstance(result, pd.DataFrame):
            return result
        if isinstance(result, list):
            if not result:
                return pd.DataFrame(columns=['output'])
            if isinstance(result[0], dict):
                return pd.DataFrame(result)
            return pd.DataFrame({'output': result})
        if isinstance(result, dict):
            return pd.DataFrame([result])
        # Scalar fallback
        return pd.DataFrame({'output': [result]})
    return wrapper

# Wrapper Registry
ORCHESTRATORS = {
    "source": source_wrapper,
    "map": rowmap_wrapper,
    "rowmap": rowmap_wrapper,
    "filter": filter_wrapper,
    "expand": expand_wrapper,
    "dataframe": dataframe_op_wrapper,
    "raw_output": raw_output_wrapper,
}
