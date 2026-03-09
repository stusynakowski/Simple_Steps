"""
Built-in Orchestration Operations
===================================
These are first-class SimpleSteps operations that expose the orchestration
layer through the formula bar and the standard operation registry.

Instead of using the hidden `.modifier` syntax, a user can write:

    =ss_map(fn="yt_extract_metadata", url=step1.url)
    =ss_filter(fn="is_video_popular", views=step2.views, min_views=1000)
    =ss_expand(fn="segment_text", text=step2.transcript)
    =ss_reduce(fn="generate_report", data=step2)

These map 1-to-1 to vanilla Python calls for notebook export:

    step2 = ss_map(df=step1, fn="yt_extract_metadata", url="url")
    step3 = ss_filter(df=step2, fn="is_video_popular", views="views", min_views=1000)

The `fn` parameter is the registered operation ID string.
All additional kwargs are treated as column-binding or scalar arguments
passed through to the target function.
"""

import inspect
import pandas as pd
from typing import Any, Dict, Optional

from .decorators import simple_step, OPERATION_REGISTRY


# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────────────────────

def _resolve_fn(fn: str):
    """Look up a registered function by its operation ID."""
    if not fn:
        raise ValueError("ss_map/ss_filter/ss_expand/ss_reduce require fn=<operation_id>")
    entry = OPERATION_REGISTRY.get(fn)
    if not entry:
        raise ValueError(
            f"Operation '{fn}' is not registered. "
            f"Available: {sorted(OPERATION_REGISTRY.keys())}"
        )
    return entry["func"]


def _bind_kwargs(func, df: pd.DataFrame, extra: Dict[str, Any]) -> Dict[str, Any]:
    """
    For each kwarg, if the value is a string that matches a column name in df,
    replace it with that column's Series (for row-level ops) or leave as-is.
    Returns a dict of {param: value_or_column_name} suitable for per-row dispatch.
    """
    sig = inspect.signature(func)
    bound: Dict[str, Any] = {}
    for k, v in extra.items():
        if k in sig.parameters:
            bound[k] = v
    return bound


def _col_val(df: pd.DataFrame, row: pd.Series, v: Any) -> Any:
    """
    Resolve a value against a DataFrame row.
    If v is a string matching a column name, return the row's value for it.
    Otherwise return v as-is (scalar / literal).
    """
    if isinstance(v, str) and v in df.columns:
        return row[v]
    return v


# ──────────────────────────────────────────────────────────────────────────────
# ss_map  — apply fn row-by-row, append result columns
# ──────────────────────────────────────────────────────────────────────────────

@simple_step(
    id="ss_map",
    name="Map",
    category="Orchestration",
    operation_type="orchestrator",
)
def ss_map(df: pd.DataFrame, fn: str = "", **kwargs) -> pd.DataFrame:
    """
    Apply a registered operation row-by-row over the input DataFrame.

    Each extra kwarg is a parameter binding:
      - If the value is a column name in df, the column value for that row is used.
      - Otherwise the value is passed as a literal / scalar.

    Returns the original DataFrame with result columns appended.

    Formula:  =ss_map(fn="yt_extract_metadata", url=step1.url)
    Python:   step2 = ss_map(df=step1, fn="yt_extract_metadata", url="url")
    """
    func = _resolve_fn(fn)
    sig = inspect.signature(func)
    # Only pass kwargs that the target function actually accepts
    valid_params = set(sig.parameters.keys())

    results = []
    for _, row in df.iterrows():
        row_kwargs = {
            k: _col_val(df, row, v)
            for k, v in kwargs.items()
            if k in valid_params
        }
        result = func(**row_kwargs)
        results.append(result)

    result_df = df.copy().reset_index(drop=True)

    if results:
        first = results[0]
        if isinstance(first, dict):
            expanded = pd.DataFrame(results).reset_index(drop=True)
            result_df = pd.concat([result_df, expanded], axis=1)
        else:
            result_df[f"{fn}_output"] = results

    return result_df


# ──────────────────────────────────────────────────────────────────────────────
# ss_filter  — keep rows where fn returns True
# ──────────────────────────────────────────────────────────────────────────────

@simple_step(
    id="ss_filter",
    name="Filter",
    category="Orchestration",
    operation_type="orchestrator",
)
def ss_filter(df: pd.DataFrame, fn: str = "", **kwargs) -> pd.DataFrame:
    """
    Keep only the rows of df for which fn(**row_values) returns True.

    Formula:  =ss_filter(fn="is_video_popular", views=step2.views, min_views=1000)
    Python:   step3 = ss_filter(df=step2, fn="is_video_popular", views="views", min_views=1000)
    """
    func = _resolve_fn(fn)
    sig = inspect.signature(func)
    valid_params = set(sig.parameters.keys())

    mask = []
    for _, row in df.iterrows():
        row_kwargs = {
            k: _col_val(df, row, v)
            for k, v in kwargs.items()
            if k in valid_params
        }
        mask.append(bool(func(**row_kwargs)))

    return df[mask].reset_index(drop=True)


# ──────────────────────────────────────────────────────────────────────────────
# ss_expand  — apply fn row-by-row, explode list results into new rows
# ──────────────────────────────────────────────────────────────────────────────

@simple_step(
    id="ss_expand",
    name="Expand",
    category="Orchestration",
    operation_type="orchestrator",
)
def ss_expand(df: pd.DataFrame, fn: str = "", **kwargs) -> pd.DataFrame:
    """
    Apply fn to each row; the function should return a list.
    Each list item becomes a new row (explode). Original row values are kept.

    Formula:  =ss_expand(fn="segment_conversations", transcript=step3.transcript)
    Python:   step4 = ss_expand(df=step3, fn="segment_conversations", transcript="transcript")
    """
    func = _resolve_fn(fn)
    sig = inspect.signature(func)
    valid_params = set(sig.parameters.keys())

    rows_out = []
    for _, row in df.iterrows():
        row_kwargs = {
            k: _col_val(df, row, v)
            for k, v in kwargs.items()
            if k in valid_params
        }
        result = func(**row_kwargs)
        items = result if isinstance(result, list) else [result]
        for item in items:
            base = row.to_dict()
            if isinstance(item, dict):
                base.update(item)
            else:
                base[f"{fn}_output"] = item
            rows_out.append(base)

    return pd.DataFrame(rows_out).reset_index(drop=True) if rows_out else pd.DataFrame()


# ──────────────────────────────────────────────────────────────────────────────
# ss_reduce  — pass the entire DataFrame to fn, return aggregated result
# ──────────────────────────────────────────────────────────────────────────────

@simple_step(
    id="ss_reduce",
    name="Reduce",
    category="Orchestration",
    operation_type="orchestrator",
)
def ss_reduce(df: pd.DataFrame, fn: str = "", **kwargs) -> pd.DataFrame:
    """
    Pass the full DataFrame to fn along with any extra scalar kwargs.
    Intended for aggregation / summary operations.

    Formula:  =ss_reduce(fn="generate_report")
    Python:   step5 = ss_reduce(df=step4, fn="generate_report")
    """
    func = _resolve_fn(fn)
    sig = inspect.signature(func)
    valid_params = set(sig.parameters.keys())

    # Inject df into the first parameter that is annotated as pd.DataFrame,
    # or fall back to passing it positionally.
    call_kwargs: Dict[str, Any] = {}
    df_injected = False
    for param_name, param in sig.parameters.items():
        ann = param.annotation
        if not df_injected and (ann is pd.DataFrame or ann is inspect.Parameter.empty):
            call_kwargs[param_name] = df
            df_injected = True
            continue
        # Pass any matching scalar kwargs
        if param_name in kwargs:
            call_kwargs[param_name] = kwargs[param_name]

    # Also pick up extra kwargs the caller passed that the function accepts
    for k, v in kwargs.items():
        if k in valid_params and k not in call_kwargs:
            call_kwargs[k] = v

    if not df_injected:
        result = func(df, **call_kwargs)
    else:
        result = func(**call_kwargs)

    if isinstance(result, pd.DataFrame):
        return result
    if isinstance(result, list):
        return pd.DataFrame(result) if result and isinstance(result[0], dict) else pd.DataFrame({"output": result})
    if isinstance(result, dict):
        return pd.DataFrame([result])
    return pd.DataFrame({"output": [result]})
