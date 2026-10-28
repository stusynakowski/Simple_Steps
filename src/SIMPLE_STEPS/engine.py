import pandas as pd
import uuid
from typing import Any, Dict, Optional
import re
import os
import hashlib

# --- The "Reference Passing" Store ---
# In production, this might be Redis, Parquet files on disk, or a Database.
# For now, it's a simple Dictionary in RAM.
DEFAULT_SESSION_ID = "default"

# Step outputs, by session token, then by ref id. Every output is a table
# (core's grid). Goes when core keeps outputs by data version (K22).
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
    # The index is a step's row ids (core 009 §2); keep it.
    df.to_parquet(path)


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


def get_value(ref_id: str, session_id: Optional[str] = None) -> Any:
    """The output stored under *ref_id*, or ``None`` when it isn't this
    session's or doesn't exist (the two look alike, so probes learn nothing)."""
    return get_dataframe(ref_id, session_id=session_id)


def run_operation(
    formula: Optional[str],
    step_id: Optional[str] = None,
    session_id: Optional[str] = None,
    result_store: Optional[str] = None,
    resources: Optional[Dict[str, Any]] = None,
    workflow_key: Optional[str] = None,
    workflow_steps: Optional[list] = None,
    step_map: Optional[Dict[str, str]] = None,
) -> tuple[str, dict]:
    """Run one step. Returns ``(output_ref, metrics)``.

    With *workflow_steps* (``[{id, name, formula, ref}]``, what the UI sends),
    the step runs in its workflow's kernel (``kernels``), so row links and
    staleness carry across steps. Without them, a formula in core's syntax runs
    alone, reading the steps in *step_map* (name → ref).

    *resources* is the workflow's ``resources`` section.
    """
    from .operation_formula import OLD_SYNTAX, is_canonical, is_literal

    formula = (formula or "").strip()
    if workflow_steps is not None and step_id:
        from . import kernels
        from .resources import live_resource
        # The UI sends a step's id; formulas (and core) name steps.
        name = next((str(s["name"]) for s in workflow_steps
                     if s.get("id") == step_id or s.get("name") == step_id), step_id)
        try:
            return kernels.run_step(
                _normalize_session_id(session_id), workflow_key or "", workflow_steps, name,
                resources,
                live=lambda name, decl: live_resource(session_id, name, decl),
                store=lambda frame: save_dataframe(frame, session_id=session_id, store_mode=result_store),
            )
        except Exception as e:
            raise ValueError(f"Error executing step: {e}") from e
    if is_canonical(formula):
        from .grid_runner import run_canonical_step
        try:
            return run_canonical_step(formula, step_map or {}, session_id, result_store, resources)
        except Exception as e:
            raise ValueError(f"Error executing step: {e}") from e
    if not formula.lstrip("=").strip():
        raise ValueError("Error executing step: the step has no formula")
    if is_literal(formula):
        raise ValueError("Error executing step: a value runs as a step of its workflow")
    raise ValueError(f"Error executing step: {OLD_SYNTAX}")
