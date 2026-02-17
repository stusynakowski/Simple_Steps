from typing import List, Callable, Dict, Any, Optional
import pandas as pd
from .models import OperationDefinition
from .decorators import simple_step, OPERATION_REGISTRY, DEFINITIONS_LIST

# --- Standard Library of Operations ---

@simple_step(name="Load CSV", category="File IO", operation_type="source", id="load_csv")
def load_csv(filepath: str) -> pd.DataFrame:
    """Load a standard CSV file from a path"""
    if not filepath:
        raise ValueError("Filepath is required")
    return pd.read_csv(filepath)

@simple_step(name="Filter Rows", category="Data Cleaning", operation_type="dataframe", id="filter_rows")
def filter_rows(df: pd.DataFrame, column: str, value: str, mode: str = "equals") -> pd.DataFrame:
    """Keep rows where a column matches a condition"""
    if df is None: raise ValueError("No input data")
    
    if column in df.columns:
        if mode == 'equals':
             if df[column].dtype == 'int64' and value.isdigit(): 
                 return df[df[column] == int(value)]
             return df[df[column] == value]
        elif mode == 'contains':
            return df[df[column].astype(str).str.contains(value, na=False)]
    return df

@simple_step(name="Clean Missing Values", category="Data Cleaning", operation_type="dataframe", id="drop_na")
def drop_na(df: pd.DataFrame) -> pd.DataFrame:
    """Drop rows with missing data"""
    if df is None: return pd.DataFrame()
    return df.dropna()

# --- Re-export for Engine Compatibility ---

# Use list directly so appends in other modules are reflected
DEFINITIONS = DEFINITIONS_LIST

# Proxy for function lookups so it's always up-to-date with OPERATION_REGISTRY
class RegistryProxy(dict):
    def __getitem__(self, key):
        return OPERATION_REGISTRY[key]['func']
    def get(self, key, default=None):
        if key in OPERATION_REGISTRY:
            return OPERATION_REGISTRY[key]['func']
        return default
    def __contains__(self, key):
        return key in OPERATION_REGISTRY
    def items(self):
        # Return iterator of (id, func)
        return ((k, v['func']) for k, v in OPERATION_REGISTRY.items())

REGISTRY = RegistryProxy()
