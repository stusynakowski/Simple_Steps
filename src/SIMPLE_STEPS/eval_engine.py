"""
Eval Engine — Interactive Python Session for the Formula Bar
=============================================================
When eval_mode is enabled, the formula bar becomes an interactive Python
session.  Steps are variables, registered operations are callable functions,
and broadcasting happens automatically via StepProxy / ColumnProxy.

The formula:
    =extract_metadata(url=step1.url)

is executed as Python where `step1` is a StepProxy wrapping the previous
step's DataFrame, and `extract_metadata` is the @simple_step-decorated
function (which auto-broadcasts over ColumnProxy arguments).

The namespace contains:
  - step1, step2, …       : StepProxy objects for each completed step
  - <step_label>           : same StepProxy, keyed by label (spaces → underscores)
  - df_in / df             : raw DataFrame from the previous step (convenience)
  - pd, np                 : pandas and numpy
  - Every registered @simple_step function (by operation ID)
  - step()                 : constructor to create a new StepProxy from data
  - result                 : set this to override the return value

The return value is resolved as:
  1. If `result` was explicitly set → use it
  2. If the expression evaluates to a value → use it
  3. Fall back to df_in

⚠️  This is exec()/eval() — it can do anything. Only enable in trusted envs.
"""

import pandas as pd
import numpy as np
from typing import Optional, Dict, Any

from .engine import get_dataframe, resolve_reference, save_dataframe
from .step_proxy import StepProxy, ColumnProxy, step as make_step, unwrap_step


def run_eval(
    code: str,
    df_in: Optional[pd.DataFrame],
    step_map: Dict[str, str],
    orchestrator_type: Optional[str] = None,
) -> pd.DataFrame:
    """
    Execute a formula as Python code and return a DataFrame result.
    """
    from .settings import get_settings
    if not get_settings().eval_mode:
        raise RuntimeError(
            "Eval mode is disabled. Enable it via POST /api/settings "
            '{"eval_mode": true} before using eval formulas.'
        )

    ns = _build_namespace(df_in, step_map)

    # ── Try eval first (single expression), fall back to exec (statements) ──
    _SENTINEL = object()
    result = _SENTINEL
    try:
        result = eval(code, ns)
    except SyntaxError:
        # Not a single expression — run as statements
        ns["result"] = None
        exec(code, ns)
        result = ns.get("result")
        if result is _SENTINEL:
            result = None

    if result is _SENTINEL:
        result = None

    return _normalize_result(result, df_in)


def _build_namespace(
    df_in: Optional[pd.DataFrame],
    step_map: Dict[str, str],
) -> Dict[str, Any]:
    """
    Build the execution namespace — this is what makes the formula bar
    feel like an interactive Python session.
    """
    from .decorators import OPERATION_REGISTRY, _auto_broadcast
    from .helpers import map_each, apply_to, filter_by, expand_each, val, col
    import re

    ns: Dict[str, Any] = {
        "__builtins__": __builtins__,
        "pd": pd,
        "np": np,
        "df_in": df_in,
        "df": df_in,
        "step": make_step,
        "map_each": map_each,
        "apply_to": apply_to,
        "filter_by": filter_by,
        "expand_each": expand_each,
        "val": val,
        "col": col,
    }

    # ── Populate step variables: step1, step2, … + label-based names ─────
    for key, ref_id in step_map.items():
        df = get_dataframe(ref_id)
        if df is None:
            continue
        proxy = StepProxy(df, label=key, ref_id=ref_id)

        # Always add under the exact key
        ns[key] = proxy

        # Also add a Python-safe identifier version (spaces → underscores,
        # strip non-alphanum) so "Step 0" becomes "Step_0"
        safe_key = re.sub(r'[^a-zA-Z0-9_]', '_', key)
        if safe_key and safe_key[0].isdigit():
            safe_key = f"_{safe_key}"
        if safe_key and safe_key not in ns:
            ns[safe_key] = proxy

    # ── Populate all registered operations as callable functions ──────────
    # Wrap each raw function with _auto_broadcast so they auto-map
    # when called with ColumnProxy args.
    for op_id, entry in OPERATION_REGISTRY.items():
        func = entry["func"]
        op_type = entry.get("type", "map")
        ns[op_id] = _auto_broadcast(func, operation_type=op_type)

    return ns


def _normalize_result(result: Any, df_in: Optional[pd.DataFrame]) -> pd.DataFrame:
    """Convert whatever the eval produced into a DataFrame."""
    if result is None:
        return df_in if df_in is not None else pd.DataFrame()

    if isinstance(result, StepProxy):
        return unwrap_step(result)
    if isinstance(result, pd.DataFrame):
        return result
    if isinstance(result, pd.Series):
        return result.to_frame()
    if isinstance(result, ColumnProxy):
        return result.series.to_frame()
    if isinstance(result, list):
        if result and isinstance(result[0], dict):
            return pd.DataFrame(result)
        return pd.DataFrame({"output": result})
    if isinstance(result, dict):
        return pd.DataFrame([result])
    if isinstance(result, (bool, int, float, str)):
        return pd.DataFrame([{"output": result}])

    # Last resort
    return pd.DataFrame([{"output": str(result)}])
