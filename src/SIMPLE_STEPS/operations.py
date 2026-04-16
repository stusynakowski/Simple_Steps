from typing import List, Callable, Dict, Any, Optional
import pandas as pd
import json
from .models import OperationDefinition
from .decorators import simple_step, OPERATION_REGISTRY, DEFINITIONS_LIST

# --- Standard Library of Operations ---

@simple_step(name="Load CSV", category="File IO", operation_type="source", id="load_csv")
def load_csv(filepath: str) -> pd.DataFrame:
    """Load a standard CSV file from a path"""
    if not filepath:
        raise ValueError("Filepath is required")
    return pd.read_csv(filepath)


@simple_step(name="Define Data", category="Data Sources", operation_type="source", id="define_data")
def define_data(data: str = '{"column1": ["a", "b", "c"]}') -> pd.DataFrame:
    """
    Create a step from inline data. Accepts a JSON object where keys
    are column names and values are lists of row values.

    Examples:
        =define_data(data='{"name": ["alice", "bob"], "score": [85, 92]}')
        =define_data(data='[{"name": "alice", "score": 85}, {"name": "bob", "score": 92}]')
    """
    if not data or not data.strip():
        raise ValueError("data is required — provide a JSON object or array of objects")

    parsed = json.loads(data)

    if isinstance(parsed, dict):
        # {"col": [values]} → DataFrame
        return pd.DataFrame(parsed)
    elif isinstance(parsed, list):
        if len(parsed) == 0:
            return pd.DataFrame()
        if isinstance(parsed[0], dict):
            # [{"col": val}, ...] → DataFrame
            return pd.DataFrame(parsed)
        else:
            # ["a", "b", "c"] → single column
            return pd.DataFrame({"value": parsed})
    else:
        # Scalar → 1×1
        return pd.DataFrame({"value": [parsed]})


@simple_step(name="Define Value", category="Data Sources", operation_type="source", id="define_value")
def define_value(value: str = "", type: str = "auto") -> pd.DataFrame:
    """
    Create a step from a single raw value. The value is stored in a
    one-cell table that you can reference from later steps.

    The 'type' parameter controls how the string is interpreted:
      - "auto"   → tries JSON first, then number, then keeps as string
      - "string" → always keeps as a string
      - "number" → parse as int or float
      - "json"   → parse as JSON (object, array, etc.)
      - "list"   → parse a JSON array into rows

    Examples:
        =define_value(value="hello world")
        =define_value(value="42", type="number")
        =define_value(value='{"key": "val"}', type="json")
        =define_value(value='[1, 2, 3, 4]', type="list")
    """
    if type == "string":
        return pd.DataFrame({"value": [value]})
    elif type == "number":
        try:
            parsed = int(value)
        except ValueError:
            parsed = float(value)
        return pd.DataFrame({"value": [parsed]})
    elif type == "json":
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return pd.DataFrame([parsed])
        elif isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
            return pd.DataFrame(parsed)
        else:
            return pd.DataFrame({"value": [parsed]})
    elif type == "list":
        parsed = json.loads(value)
        if not isinstance(parsed, list):
            raise ValueError(f"Expected a JSON array, got {type(parsed).__name__}")
        return pd.DataFrame({"value": parsed})
    else:
        # auto — try JSON → number → string
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                if parsed and all(isinstance(v, (list, tuple)) for v in parsed.values()):
                    return pd.DataFrame(parsed)
                return pd.DataFrame([parsed])
            elif isinstance(parsed, list):
                if parsed and isinstance(parsed[0], dict):
                    return pd.DataFrame(parsed)
                return pd.DataFrame({"value": parsed})
            elif isinstance(parsed, (int, float, bool)):
                return pd.DataFrame({"value": [parsed]})
            else:
                return pd.DataFrame({"value": [parsed]})
        except (json.JSONDecodeError, ValueError):
            # Not JSON — try number
            try:
                num = int(value)
                return pd.DataFrame({"value": [num]})
            except ValueError:
                try:
                    num = float(value)
                    return pd.DataFrame({"value": [num]})
                except ValueError:
                    pass
            # Keep as string
            return pd.DataFrame({"value": [value]})


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
