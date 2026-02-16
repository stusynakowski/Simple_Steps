from typing import List, Callable, Dict, Any, Optional
import pandas as pd
from .models import OperationDefinition, OperationParam

# Concept: A registry where developers register their python functions
REGISTRY: Dict[str, Callable] = {}
DEFINITIONS: List[OperationDefinition] = []

def register_operation(
    id: str, 
    label: str, 
    description: str,
    params: List[OperationParam]
):
    """Decorator to register a function as a SimpleStep operation."""
    def decorator(func):
        REGISTRY[id] = func
        DEFINITIONS.append(OperationDefinition(
            id=id,
            label=label,
            description=description,
            params=params
        ))
        return func
    return decorator

# --- Standard Library of Operations ---

@register_operation(
    id="load_csv",
    label="Load CSV",
    description="Load a standard CSV file from a path",
    params=[
        OperationParam(name="filepath", type="string", description="Absolute path to CSV file")
    ]
)
def op_load_csv(df: Optional[pd.DataFrame], config: dict) -> pd.DataFrame:
    # In a real app, this would handle security/context
    path = config.get("filepath")

    if not path:
        raise ValueError("Filepath is required")
    return pd.read_csv(path)

@register_operation(
    id="filter_rows",
    label="Filter Rows",
    description="Keep rows where a column matches a condition",
    params=[
        OperationParam(name="column", type="string", description="Column to check"),
        OperationParam(name="value", type="string", description="Value to match"),
        OperationParam(name="mode", type="string", description="equals, contains, etc")
    ]
)
def op_filter(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: raise ValueError("No input data")
    
    col = config.get("column")
    val = config.get("value")
    
    # Simple implementation
    if col in df.columns:
        return df[df[col] == val]
    return df

@register_operation(
    id="drop_na",
    label="Clean Missing Values",
    description="Drop rows with missing data",
    params=[]
)
def op_dropna(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: return pd.DataFrame()
    return df.dropna()
