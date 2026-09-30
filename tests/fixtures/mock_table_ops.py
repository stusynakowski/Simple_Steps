"""
Mock Table Manipulation Operations
====================================
Demonstrates table creation and tabular transformation in Simple Steps.

Design principles
-----------------
  - Rows   → observations / iterations (one thing per row)
  - Columns → variables / attributes    (one attribute per column)

Operations
----------
  expand_cell   — dataframe op.  Reads the first cell of the incoming step
                  (typically a 1×1 from a bare-literal step like
                  ``=[1,2,3]`` or ``={"k":"v"}``) and recursively
                  normalises it into a proper table.  Nested dicts are
                  flattened using dot-notation column names; lists become rows.

  make_table    — source op.  Create a table directly from an inline JSON
                  string (list of records or list of scalars).
"""

import json
import os
import sys
from typing import Optional

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

try:
    from SIMPLE_STEPS.decorators import simple_step
except ImportError:
    from src.SIMPLE_STEPS.decorators import simple_step


# ---------------------------------------------------------------------------
# Internal normalisation helper
# ---------------------------------------------------------------------------

def _cell_to_dataframe(value, sep: str = ".", max_depth: Optional[int] = None) -> pd.DataFrame:
    """
    Recursively normalise *value* into a DataFrame.

    Rules
    -----
    list of dicts   → N rows, keys become columns.
                      Nested dicts are flattened: ``{"a": {"b": 1}}``
                      becomes column ``"a.b"``.
    list of scalars → N rows × 1 column ("value").
    dict            → 1 row, keys become columns (nested keys flattened).
    scalar          → 1 row × 1 column ("value") — returned unchanged.
    empty list      → empty DataFrame with column "value".
    """
    if isinstance(value, list):
        if not value:
            return pd.DataFrame(columns=["value"])
        if isinstance(value[0], dict):
            return pd.json_normalize(value, sep=sep, max_level=max_depth)
        # list of scalars (int, str, float, …)
        return pd.DataFrame({"value": value})

    if isinstance(value, dict):
        return pd.json_normalize([value], sep=sep, max_level=max_depth)

    # scalar — nothing to expand, just return the original 1×1
    return pd.DataFrame({"value": [value]})


# ---------------------------------------------------------------------------
# expand_cell
# ---------------------------------------------------------------------------

@simple_step(
    name="Expand Cell",
    category="Table",
    operation_type="dataframe",
    id="expand_cell",
)
def expand_cell(df: pd.DataFrame, sep: str = ".") -> pd.DataFrame:
    """
    Expand the first cell of the incoming step into a well-structured table.

    The output shape depends on the cell's type:

    ┌───────────────────────────────┬──────────────────────────────────────┐
    │ cell value                    │ output                               │
    ├───────────────────────────────┼──────────────────────────────────────┤
    │ list of scalars               │ N rows × 1 col  ("value")            │
    │ list of flat dicts            │ N rows × M cols (dict keys)          │
    │ list of nested dicts          │ N rows × M cols (dot-notation keys)  │
    │ flat dict                     │ 1 row  × M cols (dict keys)          │
    │ nested dict                   │ 1 row  × M cols (dot-notation keys)  │
    │ scalar                        │ 1 row  × 1 col  (unchanged)          │
    └───────────────────────────────┴──────────────────────────────────────┘

    Parameters
    ----------
    sep:
        Separator used to join nested key names (default ".").
        E.g. ``{"user": {"name": "alice"}}`` → column ``"user.name"``.

    Examples
    --------
        Step 1 : =[1, 2, 3]
        Step 2 : =expand_cell()           # → 3 rows × column "value"

        Step 1 : =[{"name":"alice","score":90}]
        Step 2 : =expand_cell()           # → 1 row  × columns "name", "score"

        Step 1 : ={"user":{"name":"alice","age":30}}
        Step 2 : =expand_cell()           # → 1 row  × columns "user.name", "user.age"
    """
    if df is None or df.empty:
        return pd.DataFrame()

    cell = df.iloc[0, 0]
    return _cell_to_dataframe(cell, sep=sep)


# ---------------------------------------------------------------------------
# make_table
# ---------------------------------------------------------------------------

@simple_step(
    name="Make Table",
    category="Table",
    operation_type="source",
    id="make_table",
)
def make_table(rows: str = '[{"col1": "val1"}]') -> pd.DataFrame:
    """
    Create a table directly from an inline JSON string.

    Accepts:
      - a JSON array of objects  → DataFrame (keys become columns)
      - a JSON array of scalars  → single-column DataFrame ("value")
      - a single JSON object     → 1-row DataFrame

    Examples
    --------
        =make_table(rows='[{"name":"alice","score":90},{"name":"bob","score":75}]')
        =make_table(rows='[1, 2, 3, 4, 5]')
        =make_table(rows='{"product":"apple","qty":10}')
    """
    parsed = json.loads(rows)

    if isinstance(parsed, list):
        if not parsed:
            return pd.DataFrame()
        if isinstance(parsed[0], dict):
            return pd.DataFrame(parsed)
        return pd.DataFrame({"value": parsed})

    if isinstance(parsed, dict):
        return pd.DataFrame([parsed])

    return pd.DataFrame({"value": [parsed]})
