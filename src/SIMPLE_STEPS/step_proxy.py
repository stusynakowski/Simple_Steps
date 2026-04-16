"""
Step Proxy — Makes steps behave like Python variables
=====================================================
A StepProxy wraps a pandas DataFrame so that step references in the formula
bar (and in standalone Python scripts) feel like native Python objects:

    step1.url          → ColumnProxy (lazy reference to a column)
    step1              → the proxy itself (DataFrame-like)
    len(step1)         → row count
    step1.columns      → column names
    step1.df           → the raw DataFrame

When a @simple_step-decorated function receives a ColumnProxy argument,
the engine auto-broadcasts the call row-wise (map) and collects results
into a new DataFrame.  This means the same code works in the formula bar
AND in a plain Python script:

    # Formula bar (eval mode):
    =extract_metadata(url=step1.url)

    # Python script:
    from simple_steps import step, extract_metadata
    step1 = step(pd.read_csv("videos.csv"))
    step2 = extract_metadata(url=step1.url)   # identical call
    step2.df  # ← the resulting DataFrame

ColumnProxy is a *lazy* reference — it stores the Series but also carries
metadata about where it came from (step label, column name) so the
orchestrator can produce helpful logging.
"""

from __future__ import annotations

import pandas as pd
import numpy as np
from typing import Any, Optional, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    pass


class ColumnProxy:
    """
    Lazy reference to a single column of a step's DataFrame.

    Acts like a pd.Series in most contexts but carries provenance metadata.
    When passed to a @simple_step function, signals that the engine should
    broadcast the function row-wise over this column's values.
    """

    __slots__ = ("_series", "_step", "_col_name")

    def __init__(self, series: pd.Series, step: "StepProxy", col_name: str):
        self._series = series
        self._step = step
        self._col_name = col_name

    # ── Pandas-like interface ────────────────────────────────────────────
    @property
    def values(self):
        return self._series.values

    @property
    def name(self) -> str:
        return self._col_name

    @property
    def series(self) -> pd.Series:
        return self._series

    def __len__(self) -> int:
        return len(self._series)

    def __iter__(self):
        return iter(self._series)

    def __getitem__(self, key):
        return self._series[key]

    def __repr__(self) -> str:
        return f"<ColumnProxy {self._step._label}.{self._col_name} ({len(self._series)} rows)>"

    def __str__(self) -> str:
        return repr(self)

    # ── Comparison operators (for filter expressions) ────────────────────
    def __gt__(self, other):  return self._series > other
    def __ge__(self, other):  return self._series >= other
    def __lt__(self, other):  return self._series < other
    def __le__(self, other):  return self._series <= other
    def __eq__(self, other):  return self._series == other
    def __ne__(self, other):  return self._series != other

    # ── Arithmetic (for computed columns) ────────────────────────────────
    def __add__(self, other):
        o = other._series if isinstance(other, ColumnProxy) else other
        return self._series + o

    def __sub__(self, other):
        o = other._series if isinstance(other, ColumnProxy) else other
        return self._series - o

    def __mul__(self, other):
        o = other._series if isinstance(other, ColumnProxy) else other
        return self._series * o

    def __truediv__(self, other):
        o = other._series if isinstance(other, ColumnProxy) else other
        return self._series / o

    def __floordiv__(self, other):
        o = other._series if isinstance(other, ColumnProxy) else other
        return self._series // o

    def __mod__(self, other):
        o = other._series if isinstance(other, ColumnProxy) else other
        return self._series % o

    # ── String methods passthrough ───────────────────────────────────────
    @property
    def str(self):
        return self._series.str

    # ── Let pandas recognize this as Series-like ─────────────────────────
    def astype(self, dtype):
        return self._series.astype(dtype)

    def apply(self, func, **kwargs):
        return self._series.apply(func, **kwargs)

    def map(self, func, **kwargs):
        return self._series.map(func, **kwargs)

    def tolist(self):
        return self._series.tolist()


class StepProxy:
    """
    A step variable — wraps a DataFrame and provides Pythonic attribute
    access to columns.

    Usage:
        step1 = StepProxy(df, "step1")
        step1.url         → ColumnProxy for the 'url' column
        step1.df          → the raw DataFrame
        step1.columns     → column names
        len(step1)        → row count
        step1["url"]      → ColumnProxy (dict-style access)
    """

    # Attributes that are NOT column lookups
    _RESERVED = frozenset({
        "_df", "_label", "_ref_id",
        "df", "columns", "shape", "dtypes", "head", "tail", "describe",
        "to_csv", "to_dict", "to_json", "copy", "reset_index",
    })

    def __init__(
        self,
        df: pd.DataFrame,
        label: str = "step",
        ref_id: Optional[str] = None,
    ):
        object.__setattr__(self, "_df", df)
        object.__setattr__(self, "_label", label)
        object.__setattr__(self, "_ref_id", ref_id)

    # ── Column access via attribute ──────────────────────────────────────
    def __getattr__(self, name: str):
        # Avoid infinite recursion for dunder / private attrs
        if name.startswith("_"):
            raise AttributeError(name)
        df = object.__getattribute__(self, "_df")
        if name in df.columns:
            label = object.__getattribute__(self, "_label")
            return ColumnProxy(df[name], self, name)
        # Delegate to the DataFrame for pandas methods
        return getattr(df, name)

    # ── Dict-style column access ─────────────────────────────────────────
    def __getitem__(self, key):
        df = object.__getattribute__(self, "_df")
        if isinstance(key, str) and key in df.columns:
            label = object.__getattribute__(self, "_label")
            return ColumnProxy(df[key], self, key)
        # Support boolean mask filtering: step1[step1.score > 50]
        return StepProxy(
            df[key],
            object.__getattribute__(self, "_label"),
            object.__getattribute__(self, "_ref_id"),
        )

    # ── Core properties ──────────────────────────────────────────────────
    @property
    def df(self) -> pd.DataFrame:
        return object.__getattribute__(self, "_df")

    @property
    def columns(self):
        return object.__getattribute__(self, "_df").columns

    @property
    def shape(self):
        return object.__getattribute__(self, "_df").shape

    @property
    def dtypes(self):
        return object.__getattribute__(self, "_df").dtypes

    def __len__(self) -> int:
        return len(object.__getattribute__(self, "_df"))

    def __repr__(self) -> str:
        df = object.__getattribute__(self, "_df")
        label = object.__getattribute__(self, "_label")
        cols = list(df.columns)
        return f"<Step '{label}' — {len(df)} rows, columns={cols}>"

    def __str__(self) -> str:
        return repr(self)

    # ── Iteration (for loops, unpacking) ─────────────────────────────────
    def __iter__(self):
        """Iterate over column names (like a DataFrame)."""
        return iter(object.__getattribute__(self, "_df").columns)

    # ── Convenience methods ──────────────────────────────────────────────
    def head(self, n: int = 5) -> pd.DataFrame:
        return object.__getattribute__(self, "_df").head(n)

    def tail(self, n: int = 5) -> pd.DataFrame:
        return object.__getattribute__(self, "_df").tail(n)

    def describe(self):
        return object.__getattribute__(self, "_df").describe()

    def to_csv(self, *args, **kwargs):
        return object.__getattribute__(self, "_df").to_csv(*args, **kwargs)

    def to_dict(self, *args, **kwargs):
        return object.__getattribute__(self, "_df").to_dict(*args, **kwargs)

    def to_json(self, *args, **kwargs):
        return object.__getattribute__(self, "_df").to_json(*args, **kwargs)

    def copy(self):
        df = object.__getattribute__(self, "_df")
        return StepProxy(
            df.copy(),
            object.__getattribute__(self, "_label"),
            object.__getattribute__(self, "_ref_id"),
        )

    def reset_index(self, **kwargs):
        df = object.__getattribute__(self, "_df")
        return StepProxy(
            df.reset_index(**kwargs),
            object.__getattribute__(self, "_label"),
            object.__getattribute__(self, "_ref_id"),
        )


def step(data=None, label: str = "step", **kwargs) -> StepProxy:
    """
    Public constructor for creating a Step variable.

    Works in Python scripts as:
        from simple_steps import step
        step1 = step(pd.read_csv("data.csv"))
        step1 = step({"url": ["a.com", "b.com"], "title": ["A", "B"]})
        step1 = step([{"url": "a.com"}, {"url": "b.com"}])
    """
    if isinstance(data, StepProxy):
        return data
    if isinstance(data, pd.DataFrame):
        return StepProxy(data, label)
    if isinstance(data, dict):
        return StepProxy(pd.DataFrame(data), label)
    if isinstance(data, list):
        return StepProxy(pd.DataFrame(data), label)
    if data is None and kwargs:
        return StepProxy(pd.DataFrame(kwargs), label)
    if data is None:
        return StepProxy(pd.DataFrame(), label)
    return StepProxy(pd.DataFrame([{"output": data}]), label)


class RawValue:
    """
    A raw (non-tabular) value that lives in the pipeline.

    Unlike StepProxy (which always wraps a DataFrame), RawValue holds any
    Python object — a string, number, list, dict, API response, etc.

    Access the value with ``.value``, convert to a Step with ``.to_step()``:

        v = raw("hello world")
        v.value                     # → "hello world"
        v.to_step()                 # → StepProxy with 1×1 DataFrame

        v = raw({"name": "alice", "score": 85})
        v.value                     # → {"name": "alice", "score": 85}
        v.to_step()                 # → StepProxy with 1 row, 2 columns

        v = raw([1, 2, 3, 4, 5])
        v.value                     # → [1, 2, 3, 4, 5]
        v.to_step()                 # → StepProxy with 5 rows, 1 column
        v.to_step(column="nums")    # → column named "nums"
    """

    __slots__ = ("_value", "_label")

    def __init__(self, value: Any, label: str = "raw"):
        object.__setattr__(self, "_value", value)
        object.__setattr__(self, "_label", label)

    @property
    def value(self) -> Any:
        return object.__getattribute__(self, "_value")

    def to_step(self, column: str = "value", label: Optional[str] = None) -> StepProxy:
        """
        Convert this raw value into a StepProxy (tabular format).

        Conversion rules:
          dict with list values  → DataFrame (columns)
          dict with scalar vals  → single-row DataFrame
          list of dicts          → DataFrame (rows)
          list of scalars        → single-column DataFrame
          DataFrame              → StepProxy directly
          scalar                 → 1×1 DataFrame
        """
        v = object.__getattribute__(self, "_value")
        lbl = label or object.__getattribute__(self, "_label")

        if isinstance(v, pd.DataFrame):
            return StepProxy(v, lbl)
        if isinstance(v, dict):
            # Check if it's column-oriented (dict of lists)
            if v and all(isinstance(val, (list, tuple)) for val in v.values()):
                return StepProxy(pd.DataFrame(v), lbl)
            # Scalar-valued dict → one row
            return StepProxy(pd.DataFrame([v]), lbl)
        if isinstance(v, list):
            if v and isinstance(v[0], dict):
                return StepProxy(pd.DataFrame(v), lbl)
            return StepProxy(pd.DataFrame({column: v}), lbl)
        if isinstance(v, pd.Series):
            return StepProxy(v.to_frame(name=column), lbl)
        # Scalar
        return StepProxy(pd.DataFrame([{column: v}]), lbl)

    # ── Dunder protocols so raw values are usable directly ───────────────
    def __repr__(self) -> str:
        v = object.__getattribute__(self, "_value")
        lbl = object.__getattribute__(self, "_label")
        typ = type(v).__name__
        preview = repr(v)
        if len(preview) > 80:
            preview = preview[:77] + "..."
        return f"<RawValue '{lbl}' ({typ}): {preview}>"

    def __str__(self) -> str:
        return str(object.__getattribute__(self, "_value"))

    def __len__(self) -> int:
        v = object.__getattribute__(self, "_value")
        return len(v)

    def __iter__(self):
        return iter(object.__getattribute__(self, "_value"))

    def __getitem__(self, key):
        return object.__getattribute__(self, "_value")[key]

    def __getattr__(self, name: str):
        """Delegate attribute access to the wrapped value."""
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(object.__getattribute__(self, "_value"), name)

    # ── Comparison / arithmetic (delegate to wrapped value) ──────────────
    def __eq__(self, other):
        o = other.value if isinstance(other, RawValue) else other
        return object.__getattribute__(self, "_value") == o

    def __add__(self, other):
        o = other.value if isinstance(other, RawValue) else other
        return object.__getattribute__(self, "_value") + o

    def __mul__(self, other):
        o = other.value if isinstance(other, RawValue) else other
        return object.__getattribute__(self, "_value") * o

    def __bool__(self) -> bool:
        return bool(object.__getattribute__(self, "_value"))


def raw(value: Any, label: str = "raw") -> RawValue:
    """
    Create a raw (non-tabular) value in the pipeline.

        v = raw("hello")           # a string
        v = raw(42)                # a number
        v = raw([1, 2, 3])         # a list
        v = raw({"a": 1, "b": 2}) # a dict
        v = raw(api_response)      # anything

    Access with v.value, convert with v.to_step().
    """
    if isinstance(value, RawValue):
        return value
    return RawValue(value, label)


# ── Helpers for the engine / eval ────────────────────────────────────────────

def is_column_proxy(obj) -> bool:
    """Check if an argument is a ColumnProxy (needs broadcasting)."""
    return isinstance(obj, ColumnProxy)


def has_broadcast_args(**kwargs) -> bool:
    """Return True if any kwarg is a ColumnProxy → means we should map row-wise."""
    return any(isinstance(v, ColumnProxy) for v in kwargs.values())


def unwrap_step(obj) -> pd.DataFrame:
    """Extract the raw DataFrame from a StepProxy or pass through a DataFrame."""
    if isinstance(obj, StepProxy):
        return object.__getattribute__(obj, "_df")
    if isinstance(obj, pd.DataFrame):
        return obj
    return pd.DataFrame()
