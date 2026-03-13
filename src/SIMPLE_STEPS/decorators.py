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
            # Skip *args and **kwargs — they don't map to UI fields
            if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                continue
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
            
        # 2. Register Metadata and Raw Function
        definition = OperationDefinition(
            id=op_id,
            label=op_name, 
            description=func.__doc__ or "", 
            type=operation_type, # This becomes the "Default Recommendation"
            category=category,
            params=params
        )
        
        # Store in registry
        OPERATION_REGISTRY[op_id] = {
            "definition": definition,
            "func": func,  # The raw, unwrapped function
            "category": category,
            "type": operation_type
        }
        DEFINITIONS_LIST.append(definition)
        
        # We return the original function unmodified. 
        # This allows Python tests to run the unit logic easily without 
        # the complexity of orchestration, which is handled by the engine.
        return func

    return decorator


def register_operation(
    func,
    op_id: str,
    name: str,
    category: str = "General",
    operation_type: str = "dataframe",
    params: Optional[list] = None,
    description: Optional[str] = None,
):
    """
    Register a plain Python function into the operation registry without
    using the @simple_step decorator.

    Parameters
    ----------
    func           : the callable to register
    op_id          : unique operation ID used in formula bar  e.g. "yt_fetch_videos"
    name           : human-readable label shown in the UI sidebar
    category       : sidebar grouping  e.g. "YouTube"
    operation_type : "source" | "map" | "filter" | "dataframe" | "expand" | "raw_output"
    params         : explicit param list (dicts with name/type/default keys).
                     If None, inferred from the function's type annotations.
    description    : override docstring shown in the UI.

    Usage (at the bottom of any .py file in the scanned src/ folders):

        register_operation(my_func, "my_op", "My Operation", "MyCategory", "map")
    """
    if params is None:
        params = _infer_params(func)

    definition = OperationDefinition(
        id=op_id,
        label=name,
        description=description or func.__doc__ or "",
        type=operation_type,
        category=category,
        params=params,
    )

    OPERATION_REGISTRY[op_id] = {
        "definition": definition,
        "func":       func,
        "category":   category,
        "type":       operation_type,
    }
    DEFINITIONS_LIST.append(definition)
    return func   # safe to use as a decorator if desired


def _infer_params(func) -> list:
    """Infer OperationParam objects from a function's signature and type annotations."""
    sig = inspect.signature(func)
    type_hints = {}
    try:
        type_hints = get_type_hints(func)
    except Exception:
        pass

    params = []
    for pname, p in sig.parameters.items():
        if pname == "return":
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if pname in ("df", "data", "_input_df"):
            continue   # conventional DataFrame args — injected by engine, not UI params

        py_type = type_hints.get(pname, Any)
        if py_type in (int, float):
            ui_type = "number"
        elif py_type == bool:
            ui_type = "boolean"
        elif py_type in (list, List):
            ui_type = "list"
        elif py_type in (dict, Dict):
            ui_type = "object"
        elif py_type == pd.DataFrame:
            ui_type = "dataframe"
        else:
            ui_type = "string"

        default = None if p.default is inspect.Parameter.empty else p.default
        params.append(OperationParam(
            name=pname,
            type=ui_type,
            description="No description provided",
            default=default,
        ))
    return params
