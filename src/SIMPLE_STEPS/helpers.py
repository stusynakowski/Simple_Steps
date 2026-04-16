"""
Orchestration Helpers — Use any function with step broadcasting
================================================================
These helpers let you use *any* plain Python function (no decorator needed)
with SimpleSteps' orchestration.  They work identically in standalone
scripts and in the eval-mode formula bar.

Two flavors:

  **Tabular** — function returns dicts → unpacked into multiple columns
    map_each, apply_to, filter_by, expand_each

  **Raw / cell-level** — function return value stored as-is in one column
    val, col

    from simple_steps import step, map_each, val, col

    step1 = step({"name": ["alice", "bob"]})

    # Tabular: dict keys become columns
    step2 = map_each(fetch, url=step1.url)     # → columns: title, views, …

    # Raw cell: return value goes into one column
    step3 = val(str.upper, step1.name)          # → column: upper_output = "ALICE", "BOB"
    step4 = val(len, step1.name)                # → column: len_output = 5, 3
    step5 = col(np.cumsum, step1.score)         # → whole-column operation
"""

from __future__ import annotations

import pandas as pd
from typing import Callable, Any

from .decorators import _auto_broadcast
from .step_proxy import (
    StepProxy,
    ColumnProxy,
    step as make_step,
    unwrap_step,
)


# ─────────────────────────────────────────────────────────────────────────────
# map_each  —  row-wise broadcast (like dragging a formula down)
# ─────────────────────────────────────────────────────────────────────────────

def map_each(fn: Callable, *args, **kwargs) -> StepProxy:
    """
    Apply *fn* to each row, broadcasting over any ColumnProxy arguments.

        def fetch(url: str) -> dict:
            return requests.get(url).json()

        step2 = map_each(fetch, url=step1.url)

    Equivalent to decorating *fn* with @simple_step(operation_type="map").
    """
    wrapped = _auto_broadcast(fn, operation_type="map")
    return wrapped(*args, **kwargs)


# ─────────────────────────────────────────────────────────────────────────────
# apply_to  —  pass the whole column / DataFrame at once
# ─────────────────────────────────────────────────────────────────────────────

def apply_to(fn: Callable, *args, **kwargs) -> StepProxy:
    """
    Call *fn* once, passing full columns (Series) or steps (DataFrame).

        step2 = apply_to(np.mean, step1.score)
        step2 = apply_to(my_model.predict, features=step1)

    Equivalent to decorating *fn* with @simple_step(operation_type="dataframe").
    """
    wrapped = _auto_broadcast(fn, operation_type="dataframe")
    result = wrapped(*args, **kwargs)
    # Ensure we always return a StepProxy
    if isinstance(result, StepProxy):
        return result
    return make_step(
        _to_df(result),
        label=getattr(fn, "__name__", "apply_to"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# filter_by  —  keep rows where fn returns True
# ─────────────────────────────────────────────────────────────────────────────

def filter_by(fn: Callable, *args, **kwargs) -> StepProxy:
    """
    Keep rows where *fn* returns True.

    Works in two styles:

    1. Row-wise predicate (receives one scalar per row):

        def is_long(text: str) -> bool:
            return len(text) > 10

        step2 = filter_by(is_long, text=step1.name)

    2. Vectorised predicate (receives Series, returns bool Series):

        step2 = filter_by(lambda s: s > 50, step1.score)

    When the function returns a boolean Series, it's used as a mask directly.
    When it returns a scalar bool, it's applied row-wise.
    """
    # Collect ColumnProxy / StepProxy to find source step
    all_vals = list(kwargs.values()) + list(args)
    source_step = None
    for v in all_vals:
        if isinstance(v, ColumnProxy):
            source_step = v._step
            break
        if isinstance(v, StepProxy):
            source_step = v
            break

    if source_step is None:
        raise ValueError("filter_by requires at least one step/column argument")

    input_df = unwrap_step(source_step)

    # Try vectorised path first: unwrap proxies and call once
    unwrapped_args = [_unwrap_arg(a) for a in args]
    unwrapped_kwargs = {k: _unwrap_arg(v) for k, v in kwargs.items()}

    try:
        result = fn(*unwrapped_args, **unwrapped_kwargs)
        if isinstance(result, pd.Series) and result.dtype == bool:
            filtered = input_df[result.values].reset_index(drop=True)
            return make_step(filtered, label=getattr(fn, "__name__", "filter_by"))
    except Exception:
        pass

    # Fall back to row-wise: wrap as map, keep rows where result is truthy
    wrapped = _auto_broadcast(fn, operation_type="map")
    mapped = wrapped(*args, **kwargs)
    mapped_df = unwrap_step(mapped)

    # The mapped result has an output column — use it as the mask
    output_col = f"{fn.__name__}_output" if hasattr(fn, "__name__") else None
    if output_col and output_col in mapped_df.columns:
        mask = mapped_df[output_col].astype(bool)
    else:
        # Last column is the result
        mask = mapped_df.iloc[:, -1].astype(bool)

    filtered = input_df[mask.values].reset_index(drop=True)
    return make_step(filtered, label=getattr(fn, "__name__", "filter_by"))


# ─────────────────────────────────────────────────────────────────────────────
# expand_each  —  one row → many rows
# ─────────────────────────────────────────────────────────────────────────────

def expand_each(fn: Callable, *args, **kwargs) -> StepProxy:
    """
    Apply *fn* to each row; fn should return a list.  Each list item
    becomes its own row in the output.

        def split_tags(text: str) -> list:
            return text.split(",")

        step2 = expand_each(split_tags, text=step1.tags)
    """
    all_vals = list(kwargs.values()) + list(args)
    source_step = None
    for v in all_vals:
        if isinstance(v, ColumnProxy):
            source_step = v._step
            break
        if isinstance(v, StepProxy):
            source_step = v
            break

    input_df = unwrap_step(source_step) if source_step else pd.DataFrame()

    # Use map-mode broadcast to call fn per row
    wrapped = _auto_broadcast(fn, operation_type="map")
    mapped = wrapped(*args, **kwargs)
    mapped_df = unwrap_step(mapped)

    # Find the output column (the one added by the function)
    input_cols = set(input_df.columns) if not input_df.empty else set()
    new_cols = [c for c in mapped_df.columns if c not in input_cols]
    expand_col = new_cols[0] if new_cols else mapped_df.columns[-1]

    # Explode the list column
    exploded = mapped_df.explode(expand_col).reset_index(drop=True)
    return make_step(exploded, label=getattr(fn, "__name__", "expand_each"))


# ─────────────────────────────────────────────────────────────────────────────
# Internals
# ─────────────────────────────────────────────────────────────────────────────

def _find_source_step(*args, **kwargs):
    """Find the first StepProxy among args/kwargs (for input_df recovery)."""
    for v in list(kwargs.values()) + list(args):
        if isinstance(v, ColumnProxy):
            return v._step
        if isinstance(v, StepProxy):
            return v
    return None


def _col_name(fn: Callable, name: str | None) -> str:
    """Derive an output column name."""
    if name:
        return name
    fn_name = getattr(fn, "__name__", None) or "output"
    if fn_name == "<lambda>":
        fn_name = "result"
    return fn_name


# ─────────────────────────────────────────────────────────────────────────────
# val  —  row-wise, raw single-cell output
# ─────────────────────────────────────────────────────────────────────────────

def val(fn: Callable, *args, name: str | None = None, **kwargs) -> StepProxy:
    """
    Apply *fn* to each row.  The return value — whatever it is — is stored
    as-is in a single new column.  Dicts, lists, strings, numbers … all go
    into one cell.  Think of it as a spreadsheet formula that puts one
    result per cell.

        step2 = val(str.upper, step1.name)                # "ALICE", "BOB", …
        step2 = val(len, step1.name)                      # 5, 3, …
        step2 = val(json.loads, step1.raw_json)            # stores parsed dicts in cells
        step2 = val(lambda x: x ** 2, step1.score)        # 7225, 8464, …
        step2 = val(my_func, step1.url, name="api_result") # custom column name

    The output step keeps all existing columns and adds one new column.
    """
    source_step = _find_source_step(*args, **kwargs)
    input_df = unwrap_step(source_step) if source_step else pd.DataFrame()

    # Collect ColumnProxy positions for row-wise iteration
    col_proxies_kw = {k: v for k, v in kwargs.items() if isinstance(v, ColumnProxy)}
    scalar_kw = {k: v for k, v in kwargs.items() if not isinstance(v, (ColumnProxy, StepProxy))}
    col_proxies_pos = [a for a in args if isinstance(a, ColumnProxy)]
    scalar_pos = [a for a in args if not isinstance(a, (ColumnProxy, StepProxy))]

    n_rows = (
        len(next(iter(col_proxies_kw.values()))) if col_proxies_kw else
        len(col_proxies_pos[0]) if col_proxies_pos else 0
    )

    out_col = _col_name(fn, name)
    values = []
    for i in range(n_rows):
        row_args = list(scalar_pos) + [cp._series.iloc[i] for cp in col_proxies_pos]
        row_kwargs = dict(scalar_kw)
        for k, cp in col_proxies_kw.items():
            row_kwargs[k] = cp._series.iloc[i]
        values.append(fn(*row_args, **row_kwargs))

    result_df = input_df.copy().reset_index(drop=True) if not input_df.empty else pd.DataFrame()
    result_df[out_col] = values
    return make_step(result_df, label=out_col)


# ─────────────────────────────────────────────────────────────────────────────
# col  —  whole-column, raw single-column output
# ─────────────────────────────────────────────────────────────────────────────

def col(fn: Callable, *args, name: str | None = None, **kwargs) -> StepProxy:
    """
    Call *fn* once with the full column (Series) or step (DataFrame).
    The result is stored as a single new column on the source step.

    Use this for vectorised operations that return a same-length Series
    or array, or for aggregations that return a scalar (which gets
    broadcast to every row).

        step2 = col(np.cumsum, step1.score)                 # running total
        step2 = col(lambda s: s.rank(), step1.score)         # ranks
        step2 = col(lambda s: s - s.mean(), step1.score)     # de-mean
        step2 = col(lambda s: s.str.len(), step1.name)       # string lengths
        step2 = col(np.mean, step1.score)                    # scalar → broadcast

    The output step keeps all existing columns and adds one new column.
    """
    source_step = _find_source_step(*args, **kwargs)
    input_df = unwrap_step(source_step) if source_step else pd.DataFrame()

    unwrapped_args = [_unwrap_arg(a) for a in args]
    unwrapped_kwargs = {k: _unwrap_arg(v) for k, v in kwargs.items()}

    result = fn(*unwrapped_args, **unwrapped_kwargs)
    out_col = _col_name(fn, name)

    result_df = input_df.copy().reset_index(drop=True) if not input_df.empty else pd.DataFrame()

    if isinstance(result, pd.Series):
        result_df[out_col] = result.values
    elif isinstance(result, pd.DataFrame):
        # If the function returned a full DF, merge all its columns
        for c in result.columns:
            result_df[c] = result[c].values
    elif hasattr(result, '__len__') and not isinstance(result, str) and len(result) == len(result_df):
        # Array-like, same length as input
        result_df[out_col] = result
    else:
        # Scalar or single value — broadcast to all rows
        result_df[out_col] = result

    return make_step(result_df, label=out_col)

def _unwrap_arg(obj):
    """ColumnProxy → Series, StepProxy → DataFrame, else pass-through."""
    if isinstance(obj, ColumnProxy):
        return obj._series
    if isinstance(obj, StepProxy):
        return unwrap_step(obj)
    return obj


def _to_df(obj) -> pd.DataFrame:
    """Best-effort conversion of anything into a DataFrame."""
    if isinstance(obj, pd.DataFrame):
        return obj
    if isinstance(obj, pd.Series):
        return obj.to_frame()
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict):
            return pd.DataFrame(obj)
        return pd.DataFrame({"output": obj})
    if isinstance(obj, dict):
        return pd.DataFrame([obj])
    return pd.DataFrame([{"output": obj}])
