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


@simple_step(name="To Rows", category="Data Sources", operation_type="source", id="to_rows")
def to_rows(data: str = '{"column1": ["a", "b", "c"]}') -> pd.DataFrame:
    """
    Expand inline data into rows. Accepts a JSON string — a list, an object
    with column→values, or a list of records.

    Examples:
        =to_rows(data='[1, 2, 3]')
        =to_rows(data='{"name": ["alice", "bob"], "score": [85, 92]}')
        =to_rows(data='[{"name": "alice", "score": 85}, {"name": "bob", "score": 92}]')
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


@simple_step(name="Extract JSON", category="Data Reshaping", operation_type="map", id="extract_json")
def extract_json(cell: str, path: str = "", fallback: str = "") -> str:
    """
    Parse a JSON string and extract a value at a dot-separated path.
    Returns the extracted value as a string (or JSON string for nested objects/arrays).

    Use this as a map operation on a column that contains JSON strings.

    Args:
        cell:     The JSON string to parse (typically a cell reference like step1.data)
        path:     Dot-separated key path, e.g. "meta.city" or "scores.0"
                  Empty string returns the parsed root.
        fallback: Value returned when the path doesn't exist.

    Examples:
        =extract_json(cell=step1.value, path="name")
        =extract_json(cell=step1.value, path="meta.city")
        =extract_json(cell=step1.value, path="scores.0")
        =extract_json(cell=step1.value, path="items", fallback="[]")
    """
    if not cell or not str(cell).strip():
        return fallback

    try:
        obj = json.loads(str(cell))
    except (json.JSONDecodeError, TypeError):
        return fallback

    if not path:
        return json.dumps(obj) if isinstance(obj, (dict, list)) else str(obj)

    keys = path.split(".")
    for key in keys:
        if isinstance(obj, dict):
            obj = obj.get(key, None)
        elif isinstance(obj, list):
            try:
                obj = obj[int(key)]
            except (ValueError, IndexError):
                return fallback
        else:
            return fallback
        if obj is None:
            return fallback

    return json.dumps(obj) if isinstance(obj, (dict, list)) else str(obj)


@simple_step(name="Flatten JSON", category="Data Reshaping", operation_type="dataframe", id="flatten_json")
def flatten_json(df: pd.DataFrame, column: str, prefix: str = "", max_depth: int = 1) -> pd.DataFrame:
    """
    Take a column of JSON strings and flatten it into multiple columns.
    Each top-level key becomes a new column. Nested objects stay as JSON strings.

    Args:
        df:        Input DataFrame
        column:    Name of the column containing JSON strings
        prefix:    Optional prefix for new column names (e.g. "meta_")
        max_depth: How many levels deep to flatten (default 1 = top-level keys only)

    Examples:
        =flatten_json(column="data")
        =flatten_json(column="response", prefix="resp_")
    """
    if df is None or column not in df.columns:
        return df if df is not None else pd.DataFrame()

    def _parse_row(val):
        if pd.isna(val) or not str(val).strip():
            return {}
        try:
            parsed = json.loads(str(val))
            if isinstance(parsed, dict):
                # Convert nested dicts/lists back to JSON strings
                return {
                    k: (json.dumps(v) if isinstance(v, (dict, list)) else v)
                    for k, v in parsed.items()
                }
            return {"value": val}
        except (json.JSONDecodeError, TypeError):
            return {"value": val}

    expanded = df[column].apply(_parse_row).apply(pd.Series)
    if prefix:
        expanded = expanded.add_prefix(prefix)

    return pd.concat([df.drop(columns=[column]), expanded], axis=1)


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
