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


# ─── Data Reshaping & Transformation Operations ─────────────────────────────

@simple_step(name="Select Columns", category="Data Reshaping", operation_type="dataframe", id="select_columns")
def select_columns(df: pd.DataFrame, columns: str = "") -> pd.DataFrame:
    """
    Keep only the specified columns (drop everything else).

    Args:
        df:      Input DataFrame
        columns: Comma-separated column names, e.g. "name, score, city"

    Examples:
        =select_columns(columns="name, score")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    cols = [c.strip() for c in columns.split(",") if c.strip()]
    if not cols:
        return df
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"Columns not found: {missing}. Available: {list(df.columns)}")
    return df[cols]


@simple_step(name="Drop Columns", category="Data Reshaping", operation_type="dataframe", id="drop_columns")
def drop_columns(df: pd.DataFrame, columns: str = "") -> pd.DataFrame:
    """
    Remove the specified columns, keep everything else.

    Args:
        df:      Input DataFrame
        columns: Comma-separated column names to drop, e.g. "temp, debug_info"

    Examples:
        =drop_columns(columns="temp, debug_info")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    cols = [c.strip() for c in columns.split(",") if c.strip()]
    if not cols:
        return df
    return df.drop(columns=[c for c in cols if c in df.columns])


@simple_step(name="Rename Columns", category="Data Reshaping", operation_type="dataframe", id="rename_columns")
def rename_columns(df: pd.DataFrame, mapping: str = "") -> pd.DataFrame:
    """
    Rename columns using old=new pairs.

    Args:
        df:      Input DataFrame
        mapping: Comma-separated old=new pairs, e.g. "name=full_name, val=score"

    Examples:
        =rename_columns(mapping="name=full_name, val=score")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    if not mapping.strip():
        return df
    rename_map = {}
    for pair in mapping.split(","):
        pair = pair.strip()
        if "=" in pair:
            old, new = pair.split("=", 1)
            rename_map[old.strip()] = new.strip()
    return df.rename(columns=rename_map)


@simple_step(name="Sort By", category="Data Reshaping", operation_type="dataframe", id="sort_by")
def sort_by(df: pd.DataFrame, column: str = "", direction: str = "asc") -> pd.DataFrame:
    """
    Sort rows by one or more columns.

    Args:
        df:        Input DataFrame
        column:    Comma-separated column names to sort by, e.g. "score, name"
        direction: "asc" for ascending, "desc" for descending (applies to all columns)

    Examples:
        =sort_by(column="score", direction="desc")
        =sort_by(column="category, name")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    cols = [c.strip() for c in column.split(",") if c.strip()]
    if not cols:
        return df
    ascending = direction.strip().lower() != "desc"
    return df.sort_values(by=cols, ascending=ascending).reset_index(drop=True)


@simple_step(name="Group By", category="Data Reshaping", operation_type="dataframe", id="group_by")
def group_by(df: pd.DataFrame, column: str = "", agg: str = "count") -> pd.DataFrame:
    """
    Group rows by a column and aggregate the rest.

    Args:
        df:     Input DataFrame
        column: Column to group by (comma-separated for multiple)
        agg:    Aggregation function: "count", "sum", "mean", "min", "max", "first", "last"

    Examples:
        =group_by(column="category", agg="sum")
        =group_by(column="city, status", agg="count")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    cols = [c.strip() for c in column.split(",") if c.strip()]
    if not cols:
        raise ValueError("Must specify at least one column to group by")
    agg_fn = agg.strip().lower()
    valid_aggs = {"count", "sum", "mean", "min", "max", "first", "last"}
    if agg_fn not in valid_aggs:
        raise ValueError(f"Unknown agg '{agg_fn}'. Choose from: {valid_aggs}")
    if agg_fn == "count":
        return df.groupby(cols).size().reset_index(name="count")
    return df.groupby(cols).agg(agg_fn).reset_index()


@simple_step(name="Pivot", category="Data Reshaping", operation_type="dataframe", id="pivot")
def pivot(df: pd.DataFrame, index: str = "", columns: str = "", values: str = "", agg: str = "first") -> pd.DataFrame:
    """
    Pivot rows into columns (like a spreadsheet pivot table).

    Args:
        df:      Input DataFrame
        index:   Column(s) to keep as rows
        columns: Column whose values become new column headers
        values:  Column whose values fill the cells
        agg:     Aggregation if there are duplicates: "first", "sum", "mean", "count"

    Examples:
        =pivot(index="date", columns="category", values="revenue", agg="sum")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    if not index or not columns or not values:
        raise ValueError("pivot requires index, columns, and values parameters")
    idx = [c.strip() for c in index.split(",") if c.strip()]
    result = df.pivot_table(index=idx, columns=columns.strip(), values=values.strip(), aggfunc=agg.strip())
    result.columns = [str(c) for c in result.columns]
    return result.reset_index()


@simple_step(name="Aggregate", category="Data Reshaping", operation_type="dataframe", id="aggregate")
def aggregate(df: pd.DataFrame, column: str = "", functions: str = "count") -> pd.DataFrame:
    """
    Compute summary statistics on a column (or all numeric columns).

    Args:
        df:        Input DataFrame
        column:    Column to aggregate (leave empty for all numeric columns)
        functions: Comma-separated: "count", "sum", "mean", "min", "max", "std", "median"

    Examples:
        =aggregate(column="score", functions="mean, min, max")
        =aggregate(functions="count, sum")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    fns = [f.strip() for f in functions.split(",") if f.strip()]
    if not fns:
        fns = ["count"]
    if column.strip():
        col = column.strip()
        if col not in df.columns:
            raise ValueError(f"Column '{col}' not found. Available: {list(df.columns)}")
        result = df[[col]].agg(fns)
        return result.reset_index().rename(columns={"index": "statistic"})
    else:
        result = df.select_dtypes(include="number").agg(fns)
        return result.reset_index().rename(columns={"index": "statistic"})


@simple_step(name="Merge Steps", category="Data Reshaping", operation_type="dataframe", id="merge_steps")
def merge_steps(df: pd.DataFrame, right_data: str = "", on: str = "", how: str = "inner") -> pd.DataFrame:
    """
    Join/merge two datasets on a shared key column.

    Args:
        df:         Left DataFrame (from upstream step)
        right_data: JSON string of the right dataset, or a step reference
        on:         Column name to join on (must exist in both)
        how:        Join type: "inner", "left", "right", "outer"

    Examples:
        =merge_steps(right_data=step2.value, on="id", how="left")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    if not on.strip():
        raise ValueError("Must specify 'on' — the column to join on")
    try:
        right = pd.DataFrame(json.loads(right_data)) if isinstance(right_data, str) else right_data
    except (json.JSONDecodeError, TypeError):
        raise ValueError("right_data must be valid JSON or a step reference")
    return pd.merge(df, right, on=on.strip(), how=how.strip())


@simple_step(name="Cast Column", category="Data Reshaping", operation_type="dataframe", id="cast_column")
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


@simple_step(name="Add Column", category="Data Reshaping", operation_type="dataframe", id="add_column")
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


@simple_step(name="Unpivot / Melt", category="Data Reshaping", operation_type="dataframe", id="unpivot")
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


@simple_step(name="Deduplicate", category="Data Cleaning", operation_type="dataframe", id="deduplicate")
def deduplicate(df: pd.DataFrame, columns: str = "", keep: str = "first") -> pd.DataFrame:
    """
    Remove duplicate rows.

    Args:
        df:      Input DataFrame
        columns: Comma-separated columns to check for duplicates (empty = all columns)
        keep:    Which duplicate to keep: "first", "last", or "none" (drop all dupes)

    Examples:
        =deduplicate(columns="email")
        =deduplicate(columns="name, date", keep="last")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    cols = [c.strip() for c in columns.split(",") if c.strip()] if columns.strip() else None
    keep_val = keep.strip().lower()
    if keep_val == "none":
        keep_val = False
    return df.drop_duplicates(subset=cols, keep=keep_val).reset_index(drop=True)


@simple_step(name="Sample Rows", category="Data Reshaping", operation_type="dataframe", id="sample_rows")
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


@simple_step(name="Pandas", category="Data Reshaping", operation_type="dataframe", id="pandas_eval")
def pandas_eval(df: pd.DataFrame, expr: str = "df") -> pd.DataFrame:
    """
    Run any pandas expression directly on the incoming DataFrame.
    The DataFrame is available as 'df' in the expression.
    Must return a DataFrame.

    Args:
        df:   Input DataFrame (from upstream step)
        expr: A Python/pandas expression. Use 'df' to reference the data.

    Examples:
        =pandas_eval(expr="df.groupby('category')['score'].mean().reset_index()")
        =pandas_eval(expr="df[df['score'] > 80].sort_values('name')")
        =pandas_eval(expr="df.describe()")
        =pandas_eval(expr="df.pivot_table(index='date', columns='type', values='amount', aggfunc='sum')")
        =pandas_eval(expr="df.merge(df.groupby('category')['price'].mean().rename('avg_price'), on='category')")
    """
    if df is None or df.empty:
        return pd.DataFrame()
    # Restricted namespace — only pandas and the DataFrame
    namespace = {"df": df, "pd": pd}
    result = eval(expr, {"__builtins__": {}}, namespace)  # noqa: S307
    if isinstance(result, pd.Series):
        return result.to_frame()
    if isinstance(result, pd.DataFrame):
        return result.reset_index(drop=True) if result.index.name or not result.index.equals(pd.RangeIndex(len(result))) else result
    # Scalar result → wrap in 1×1 DataFrame
    return pd.DataFrame({"value": [result]})


@simple_step(name="Format String", category="Data Reshaping", operation_type="map", id="format_string")
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
