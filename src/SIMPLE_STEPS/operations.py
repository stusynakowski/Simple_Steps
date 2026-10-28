import json

import pandas as pd

from .decorators import simple_step_tool

# --- Standard Library of Operations ---

@simple_step_tool(name="Load CSV", category="File IO", operation_type="source", id="load_csv")
def load_csv(filepath: str) -> pd.DataFrame:
    """Load a standard CSV file from a path"""
    if not filepath:
        raise ValueError("Filepath is required")
    return pd.read_csv(filepath)


@simple_step_tool(name="To Rows", category="Data Sources", operation_type="source", id="to_rows")
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


@simple_step_tool(name="Extract JSON", category="Data Reshaping", operation_type="map", id="extract_json")
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


@simple_step_tool(name="Flatten JSON", category="Data Reshaping", operation_type="dataframe", id="flatten_json")
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


@simple_step_tool(name="Filter Rows", category="Data Cleaning", operation_type="dataframe", id="filter_rows")
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

@simple_step_tool(name="Clean Missing Values", category="Data Cleaning", operation_type="dataframe", id="drop_na")
def drop_na(df: pd.DataFrame) -> pd.DataFrame:
    """Drop rows with missing data"""
    if df is None: return pd.DataFrame()
    return df.dropna()


# ─── Data Reshaping & Transformation Operations ─────────────────────────────

@simple_step_tool(name="Cast Column", category="Data Reshaping", operation_type="dataframe", id="cast_column")
def cast_column(df: pd.DataFrame, column: str = "", to_type: str = "string") -> pd.DataFrame:
    """
    Convert a column's data type.

    Args:
        df:      Input DataFrame
        column:  Column to cast
        to_type: Target type: "string", "int", "float", "bool", "datetime"

    Examples:
        =cast_column(column="price", to_type="float")
        =cast_column(column="date", to_type="datetime")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    if not column.strip():
        raise ValueError("Must specify a column to cast")
    col = column.strip()
    if col not in df.columns:
        raise ValueError(f"Column '{col}' not found. Available: {list(df.columns)}")
    result = df.copy()
    type_map = {
        "string": str, "str": str,
        "int": "Int64", "integer": "Int64",
        "float": float,
        "bool": bool, "boolean": bool,
        "datetime": "datetime64[ns]",
    }
    target = type_map.get(to_type.strip().lower())
    if target is None:
        raise ValueError(f"Unknown type '{to_type}'. Choose from: {list(type_map.keys())}")
    if to_type.strip().lower() in ("datetime",):
        result[col] = pd.to_datetime(result[col], errors="coerce")
    elif target == str:
        result[col] = result[col].astype(str)
    else:
        result[col] = result[col].astype(target)
    return result


@simple_step_tool(name="Add Column", category="Data Reshaping", operation_type="dataframe", id="add_column")
def add_column(df: pd.DataFrame, name: str = "new_col", expression: str = "") -> pd.DataFrame:
    """
    Add a new column computed from an expression referencing existing columns.
    Uses pandas eval for simple math, or fills a constant value.

    Args:
        df:         Input DataFrame
        name:       Name for the new column
        expression: A pandas expression like "price * quantity" or a constant like "hello"

    Examples:
        =add_column(name="total", expression="price * quantity")
        =add_column(name="label", expression="ready")
        =add_column(name="ratio", expression="score / max_score * 100")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    result = df.copy()
    expr = expression.strip()
    if not expr:
        result[name] = None
        return result
    try:
        result[name] = result.eval(expr)
    except Exception:
        # Fall back to constant value
        result[name] = expr
    return result


@simple_step_tool(name="Unpivot / Melt", category="Data Reshaping", operation_type="dataframe", id="unpivot")
def unpivot(df: pd.DataFrame, id_columns: str = "", value_name: str = "value", var_name: str = "variable") -> pd.DataFrame:
    """
    Unpivot (melt) columns into rows — the inverse of pivot.

    Args:
        df:         Input DataFrame
        id_columns: Comma-separated columns to keep fixed (everything else gets melted)
        value_name: Name for the values column
        var_name:   Name for the variable/category column

    Examples:
        =unpivot(id_columns="name", value_name="score", var_name="subject")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    id_cols = [c.strip() for c in id_columns.split(",") if c.strip()] if id_columns.strip() else []
    return pd.melt(df, id_vars=id_cols or None, value_name=value_name, var_name=var_name)


@simple_step_tool(name="Sample Rows", category="Data Reshaping", operation_type="dataframe", id="sample_rows")
def sample_rows(df: pd.DataFrame, n: int = 5, random: str = "false") -> pd.DataFrame:
    """
    Take a subset of rows — either the first N or a random sample.

    Args:
        df:     Input DataFrame
        n:      Number of rows to return
        random: "true" for random sample, "false" for first N rows

    Examples:
        =sample_rows(n=10)
        =sample_rows(n=20, random="true")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    n = min(int(n), len(df))
    if random.strip().lower() in ("true", "1", "yes"):
        return df.sample(n=n).reset_index(drop=True)
    return df.head(n).reset_index(drop=True)


@simple_step_tool(name="Format String", category="Data Reshaping", operation_type="map", id="format_string")
def format_string(cell: str = "", template: str = "{value}") -> str:
    """
    Format a cell value into a string template.

    Args:
        cell:     The cell value to format
        template: A Python format string. Use {value} for the cell value.

    Examples:
        =format_string(cell=step1.name, template="Hello, {value}!")
        =format_string(cell=step1.price, template="${value:.2f}")
    """
    try:
        return template.format(value=cell)
    except (ValueError, KeyError):
        return template.replace("{value}", str(cell))
