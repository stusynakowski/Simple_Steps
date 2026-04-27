import pandas as pd
import uuid
from typing import Dict, Optional, Any
from .decorators import OPERATION_REGISTRY
import re
import os
import hashlib

# --- The "Reference Passing" Store ---
# In production, this might be Redis, Parquet files on disk, or a Database.
# For now, it's a simple Dictionary in RAM.
DEFAULT_SESSION_ID = "default"
DATA_STORE: Dict[str, Dict[str, pd.DataFrame]] = {}
RESULT_STORE_MODES = {"memory", "parquet"}
RESULT_CACHE_DIR = os.environ.get("SIMPLE_STEPS_RESULT_CACHE_DIR", ".simple_steps_cache")


def _normalize_session_id(session_id: Optional[str]) -> str:
    sid = (session_id or DEFAULT_SESSION_ID).strip()
    return sid or DEFAULT_SESSION_ID


def _session_token(session_id: Optional[str]) -> str:
    sid = _normalize_session_id(session_id)
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", sid).strip("-_")
    if safe:
        return safe[:64]
    return hashlib.sha1(sid.encode("utf-8")).hexdigest()[:16]


def _extract_session_token_from_ref(ref_id: str) -> Optional[str]:
    if "__" not in ref_id:
        return None
    token, _ = ref_id.split("__", 1)
    return token or None


def _resolve_store_mode(store_mode: Optional[str]) -> str:
    mode_candidate = store_mode
    if not mode_candidate:
        try:
            from .settings import get_settings
            mode_candidate = getattr(get_settings(), "result_store", None)
        except Exception:
            mode_candidate = None
    if not mode_candidate:
        mode_candidate = os.environ.get("SIMPLE_STEPS_RESULT_STORE", "memory")

    mode = str(mode_candidate).strip().lower()
    if mode in RESULT_STORE_MODES:
        return mode
    return "memory"


def _parquet_path_for_ref(ref_id: str, session_token: Optional[str] = None) -> str:
    token = session_token or _extract_session_token_from_ref(ref_id) or _session_token(DEFAULT_SESSION_ID)
    return os.path.join(RESULT_CACHE_DIR, token, f"{ref_id}.parquet")


def _save_parquet_cache(df: pd.DataFrame, ref_id: str, session_token: str) -> None:
    path = _parquet_path_for_ref(ref_id, session_token)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    df.to_parquet(path, index=False)


def _load_parquet_cache(ref_id: str, preferred_session_token: Optional[str] = None) -> Optional[pd.DataFrame]:
    path = _parquet_path_for_ref(ref_id, preferred_session_token)
    if not os.path.exists(path):
        return None
    try:
        return pd.read_parquet(path)
    except Exception as e:
        print(f"  ⚠ Failed to read parquet cache for '{ref_id}': {e}")
        return None


def get_dataframe(ref_id: str, session_id: Optional[str] = None) -> Optional[pd.DataFrame]:
    explicit_session_token = _session_token(session_id) if session_id is not None else None
    ref_session_token = _extract_session_token_from_ref(ref_id)

    if explicit_session_token and ref_session_token and explicit_session_token != ref_session_token:
        return None

    candidate_tokens = []
    if explicit_session_token:
        candidate_tokens.append(explicit_session_token)
    elif ref_session_token:
        candidate_tokens.append(ref_session_token)
    else:
        candidate_tokens.extend(DATA_STORE.keys())

    for token in candidate_tokens:
        bucket = DATA_STORE.get(token)
        if not bucket:
            continue
        df = bucket.get(ref_id)
        if df is not None:
            return df

    # Fallback to parquet cache if memory cache is empty/evicted.
    df_cached = _load_parquet_cache(ref_id, explicit_session_token or ref_session_token)
    if df_cached is not None:
        token = explicit_session_token or ref_session_token or _session_token(DEFAULT_SESSION_ID)
        DATA_STORE.setdefault(token, {})[ref_id] = df_cached
    return df_cached

def save_dataframe(
    df: pd.DataFrame,
    session_id: Optional[str] = None,
    store_mode: Optional[str] = None,
) -> str:
    token = _session_token(session_id)
    ref_id = f"{token}__{uuid.uuid4().hex}"
    DATA_STORE.setdefault(token, {})[ref_id] = df

    if _resolve_store_mode(store_mode) == "parquet":
        try:
            _save_parquet_cache(df, ref_id, token)
        except Exception as e:
            print(f"  ⚠ Failed to persist parquet cache for '{ref_id}': {e}")

    return ref_id

def resolve_reference(value: Any, step_map: Dict[str, str], session_id: Optional[str] = None) -> Any:
    """
    Resolves a step-data reference token injected by the frontend wiring UI.

    Supported formats (all produced by PreviousStepDataPicker / DataOutputGrid):
      stepId.columnName          → pd.Series (whole column)
      stepId[row=R, col=C]       → scalar cell value
      stepId                     → pd.DataFrame (whole output)
      =Step Name!columnName      → pd.Series (Excel-style reference)

    `step_map` maps step IDs (and labels / positional aliases) to their
    output ref IDs in DATA_STORE.
    """
    if not isinstance(value, str):
        return value

    # ── Excel-style syntax: =Step Name!ColumnName ────────────────────────
    # Strips the leading '=' and splits on '!' to get step label and column.
    excel_match = re.match(r'^=(.+?)!(\w+)$', value)
    if excel_match:
        step_key = excel_match.group(1).strip()
        col_name = excel_match.group(2)
        ref_id = step_map.get(step_key)
        if ref_id:
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and col_name in df.columns:
                print(f"  ↳ Resolved '{value}' → column '{col_name}' from step '{step_key}' (Excel syntax)")
                return df[col_name]
        print(f"  ⚠ Could not resolve Excel reference '{value}' (step_map keys: {list(step_map.keys())})")
        return value

    # ── dot syntax: stepId.columnName ────────────────────────────────────
    dot_match = re.match(r'^([\w-]+)\.(\w+)$', value)
    if dot_match:
        step_key = dot_match.group(1)
        col_name = dot_match.group(2)
        ref_id = step_map.get(step_key)
        if ref_id:
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and col_name in df.columns:
                print(f"  ↳ Resolved '{value}' → column '{col_name}' from step '{step_key}'")
                return df[col_name]
        print(f"  ⚠ Could not resolve column reference '{value}' (step_map keys: {list(step_map.keys())})")
        return value

    # ── bracket syntax: stepId[row=R, col=C] ────────────────────────────
    bracket_match = re.match(r'^([\w-]+)\[row=(\d+),\s*col=(\w+)\]$', value)
    if bracket_match:
        step_key = bracket_match.group(1)
        row_idx = int(bracket_match.group(2))
        col_name = bracket_match.group(3)
        ref_id = step_map.get(step_key)
        if ref_id:
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and col_name in df.columns and row_idx < len(df):
                cell_val = df.iloc[row_idx][col_name]
                print(f"  ↳ Resolved '{value}' → cell [{row_idx},{col_name}] = {cell_val!r}")
                return cell_val
        print(f"  ⚠ Could not resolve cell reference '{value}'")
        return value

    # ── bare step ID: stepId ─────────────────────────────────────────────
    if value in step_map:
        ref_id = step_map[value]
        df = get_dataframe(ref_id, session_id=session_id)
        if df is not None:
            print(f"  ↳ Resolved '{value}' → full DataFrame ({len(df)} rows)")
            return df

    return value


def _passthrough(
    op_id: str,
    config: Any,
    df_in: Optional[pd.DataFrame],
    step_map: Dict[str, str],
    session_id: Optional[str] = None,
) -> pd.DataFrame:
    """
    Identity / pass-through operation used when no operation is defined.

    Resolution order:
      1. If config contains a '_ref' key, resolve it as a step reference.
         - column ref  (stepId.col)  → wrap Series as single-column DataFrame
         - cell ref    (stepId[...]) → wrap scalar as 1×1 DataFrame
         - full DF ref (stepId)      → return that DataFrame directly
      2. Otherwise fall back to df_in (the previous step's full output).
      3. If neither is available, return an empty DataFrame.
    """
    ref_token = config.get('_ref', '').strip()
    if ref_token:
        resolved = resolve_reference(ref_token, step_map, session_id=session_id)
        if isinstance(resolved, pd.DataFrame):
            return resolved
        if isinstance(resolved, pd.Series):
            return resolved.to_frame()
        if resolved != ref_token:          # scalar — not the same string back
            # Extract a sensible column name from the reference
            col_label = "value"
            bracket_m = re.match(r'^[\w-]+\[.*col=(\w+).*\]$', ref_token)
            if bracket_m:
                col_label = bracket_m.group(1)
            elif '.' in ref_token:
                col_label = ref_token.split('.')[-1]
            return pd.DataFrame([{col_label: resolved}])
        # Could not resolve — fall through to df_in

    if df_in is not None:
        return df_in

    return pd.DataFrame()


def run_operation(
    op_id: str, 
    config: Any, 
    input_ref_id: Optional[str],
    step_label_map: Optional[Dict[str, str]] = None,
    is_preview: bool = False,
    formula: Optional[str] = None,
    step_id: Optional[str] = None,
    session_id: Optional[str] = None,
    result_store: Optional[str] = None,
) -> tuple[str, dict]:
    """
    Orchestrates the running of a single step with dynamic wrappers.
    """
    
    step_map = step_label_map or {}

    # 1. Resolve Input
    df_in = None
    if input_ref_id:
        df_in = get_dataframe(input_ref_id, session_id=session_id)

    # 2. Identity / pass-through: noop or passthrough op_id
    if op_id in ('noop', 'passthrough', '', None):
        print(f"Running '{op_id}' as pass-through / identity")
        result_df = _passthrough(op_id, config, df_in, step_map, session_id=session_id)
        out_ref = save_dataframe(result_df, session_id=session_id, store_mode=result_store)
        return out_ref, {"rows": len(result_df), "columns": list(result_df.columns)}

    # 2b. Eval mode: explicit _eval operation or fallback for unregistered ops
    if op_id == '_eval':
        from .eval_engine import run_eval
        code = config.get('code', '')
        orchestrator_type = config.get('_orchestrator', None)
        print(f"⚡ Running eval mode (orchestrator={orchestrator_type})")
        result_df = run_eval(code, df_in, step_map, orchestrator_type, session_id=session_id)
        out_ref = save_dataframe(result_df, session_id=session_id, store_mode=result_store)
        return out_ref, {"rows": len(result_df), "columns": list(result_df.columns)}

    # 3. Find Operation
    op_def = OPERATION_REGISTRY.get(op_id)
    if not op_def:
        # ── Eval-mode fallback: if the operation isn't registered and eval_mode
        # is on, treat the raw formula (everything after '=') as Python code.
        from .settings import get_settings
        if get_settings().eval_mode and formula:
            from .eval_engine import run_eval
            # Strip the leading '=' and optional orchestration prefix
            code = formula.lstrip('=').strip()
            orchestrator_type = config.get('_orchestrator', None)
            print(f"⚡ Eval-mode fallback for unregistered op '{op_id}' — running raw formula as code")
            result_df = run_eval(code, df_in, step_map, orchestrator_type, session_id=session_id)
            out_ref = save_dataframe(result_df, session_id=session_id, store_mode=result_store)
            return out_ref, {"rows": len(result_df), "columns": list(result_df.columns)}
        raise ValueError(f"Operation '{op_id}' not registered")
    
    func = op_def['func']
    suggested_op_type = op_def.get('type', 'dataframe')

    # Orchestration ops (ss_map, ss_filter, etc.) take a full DataFrame directly.
    # They manage their own row/column iteration, so use the 'dataframe' wrapper
    # (which just calls func(df=df_in, **config)).
    if suggested_op_type == 'orchestrator':
        suggested_op_type = 'dataframe'

    # Allow config override: { "_orchestrator": "map" }
    orchestrator_type = config.get('_orchestrator', suggested_op_type)

    from .orchestrators import ORCHESTRATORS
    wrapper = ORCHESTRATORS.get(orchestrator_type)

    # 4. Resolve Arguments / Config
    # Special params that must NOT be treated as step references:
    #   fn  — an operation-ID string used by ss_map/ss_filter/ss_expand/ss_reduce
    _PASSTHROUGH_PARAMS = {'fn'}

    resolved_config = {}
    for k, v in config.items():
        if k.startswith('_'):
            continue
        if k in _PASSTHROUGH_PARAMS:
            resolved_config[k] = v  # keep as literal string
            continue
        resolved_config[k] = resolve_reference(v, step_map, session_id=session_id)

    if df_in is not None:
        resolved_config['_input_df'] = df_in
    
    executable_func = func if not wrapper else wrapper(func)
    
    # 5. Execute
    print(f"Running '{op_id}' with orchestrator '{orchestrator_type}'")
    try:
        result_df = executable_func(**resolved_config)
        
        if not isinstance(result_df, pd.DataFrame):
             print(f"Warning: Operation {op_id} returned {type(result_df)}, expected DataFrame")
             # Handle RawValue
             from .step_proxy import RawValue
             if isinstance(result_df, RawValue):
                 result_df = result_df.to_step().df
             elif isinstance(result_df, list):
                 result_df = pd.DataFrame(result_df)
             else:
                 result_df = pd.DataFrame([result_df])
                 
    except Exception as e:
        # Keep normal runs clean (CLI/library demos), but allow opt-in
        # traceback printing for local debugging.
        if os.environ.get("SIMPLE_STEPS_DEBUG_TRACEBACKS", "").strip().lower() in {"1", "true", "yes"}:
            import traceback
            traceback.print_exc()
        raise ValueError(f"Error executing step {op_id}: {str(e)}") from e

    # 6. Save Result
    out_ref = save_dataframe(result_df, session_id=session_id, store_mode=result_store)
    
    return out_ref, {"rows": len(result_df), "columns": list(result_df.columns)}
