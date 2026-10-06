import pandas as pd
import uuid
from typing import Dict, Optional, Any, get_type_hints
import inspect
import typing
from .decorators import OPERATION_REGISTRY
import re
import os
import hashlib

# --- The "Reference Passing" Store ---
# In production, this might be Redis, Parquet files on disk, or a Database.
# For now, it's a simple Dictionary in RAM.
DEFAULT_SESSION_ID = "default"

# Tabular outputs (DataFrames) — used by source/map/filter/expand/dataframe/raw_output ops.
DATA_STORE: Dict[str, Dict[str, pd.DataFrame]] = {}

# Single-cell outputs (anything: dict, scalar, list, Pydantic model, None) —
# used by ``step``-mode ops (the v0.2 default).  Lives in memory only; raw
# values are not parquet-cached because they may not be parquet-serialisable
# (and step ops are typically cheap to re-run anyway).
RAW_STORE: Dict[str, Dict[str, Any]] = {}

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


def save_raw_value(value: Any, session_id: Optional[str] = None) -> str:
    """
    Persist the return value of a ``step``-mode operation under a new
    session-scoped reference.

    Unlike :func:`save_dataframe`, this stores arbitrary Python objects
    (dict, scalar, list, Pydantic model, ``None``, …) in :data:`RAW_STORE`
    without DataFrame coercion.  Reference IDs share the same
    ``{session_token}__{uuid}`` shape as DataFrame refs so the existing
    session-isolation logic works unchanged.

    Memory-only — raw values are not parquet-cached (they may not be
    parquet-serialisable, and ``step`` ops are typically cheap to re-run).
    """
    token = _session_token(session_id)
    ref_id = f"{token}__{uuid.uuid4().hex}"
    RAW_STORE.setdefault(token, {})[ref_id] = value
    return ref_id


def get_value(ref_id: str, session_id: Optional[str] = None) -> Any:
    """
    Look up a reference across both stores, returning whatever is there.

    Resolution order:
      1. ``RAW_STORE`` (single-cell ``step``-mode outputs)
      2. ``DATA_STORE`` (tabular DataFrames + parquet fallback)

    Returns ``None`` if the ref does not belong to the caller's session
    OR is genuinely absent — the two cases are intentionally
    indistinguishable so cross-session probes leak no information.
    """
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
        # Walk both stores' tokens — only used when no session context
        # is available at all (notebook / direct-Python use).
        candidate_tokens.extend(set(list(RAW_STORE.keys()) + list(DATA_STORE.keys())))

    for token in candidate_tokens:
        bucket = RAW_STORE.get(token)
        if bucket and ref_id in bucket:
            return bucket[ref_id]

    # Fall back to DataFrame storage (which has its own parquet cache logic)
    return get_dataframe(ref_id, session_id=session_id)

# --------------------------------------------------------------------------- #
# Argument coercion                                                           #
# --------------------------------------------------------------------------- #
# A step's stored `configuration` holds argument values as TEXT. The formula
# parser returns each argument as its source text by contract, and the UI form
# writes strings too, so `=sample_people(count=8, seed=0)` arrives as
# {"count": "8", "seed": "0"}. Passed straight through, a tool annotated
# `count: int` then fails deep inside its own body with
# "'str' object cannot be interpreted as an integer" — an error that names
# neither the parameter nor the step.
#
# So coerce each text value to the parameter's annotated type before calling.
# Only strings are touched: anything already resolved to a DataFrame, a list or
# a number is passed through untouched.


def _coerce_text_to_bool(text: str) -> Optional[bool]:
    """Interpret a form/formula string as a bool, or None if it is not one."""
    lowered = text.strip().lower()
    if lowered in ("true", "1", "yes", "y", "on"):
        return True
    if lowered in ("false", "0", "no", "n", "off"):
        return False
    return None


def coerce_config_to_signature(
    func: Any,
    config: Dict[str, Any],
    column_names: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Return *config* with text values converted to each parameter's annotated type.

    Rules, each there for a case that actually occurs:

    * A value naming a **column of the input frame** is left alone. In a
      per-row orchestration (map / rowmap / filter / expand) a string argument
      is a column reference that the orchestrator replaces with that row's
      cell — so `=keep_popular(views="views")` must keep "views" as the column
      name, even though the parameter is annotated `int`. Pass
      ``column_names`` whenever an input frame exists; without it, such a step
      would be rejected as a bad int.
    * Non-strings are left alone — a resolved DataFrame must not be stringified.
    * An **empty string** for a parameter that has a default is dropped, so the
      default applies. The UI form writes "" for every untouched optional
      argument; without this, `int("")` would fail on a parameter the user
      never set.
    * A value that cannot be converted raises a message naming the parameter
      and the expected type, instead of letting the tool fail on its own with
      a message that names neither.
    * Unannotated parameters, `str`, and anything not handled are passed
      through unchanged.
    """
    try:
        hints = get_type_hints(getattr(func, "_raw_func", func))
    except Exception:
        return config

    try:
        params = inspect.signature(getattr(func, "_raw_func", func)).parameters
    except (TypeError, ValueError):
        params = {}

    columns = set()
    if column_names is not None:
        try:
            columns = {str(c) for c in column_names}
        except TypeError:
            columns = set()

    out: Dict[str, Any] = {}
    for key, value in config.items():
        if key.startswith("_") or not isinstance(value, str):
            out[key] = value
            continue
        if value in columns:
            out[key] = value      # a column reference, resolved per row later
            continue

        target = hints.get(key)
        param = params.get(key)
        has_default = param is not None and param.default is not inspect.Parameter.empty

        if value == "" and has_default:
            continue   # let the function's own default apply

        origin = typing.get_origin(target)
        if origin is typing.Literal:
            # Already checked by the validator; coerce only if the choices are
            # numeric, so Literal[1, 2] does not arrive as "1".
            choices = typing.get_args(target)
            if choices and isinstance(choices[0], bool):
                target = bool
            elif choices and isinstance(choices[0], int):
                target = int
            else:
                out[key] = value
                continue

        try:
            if target is bool:
                parsed = _coerce_text_to_bool(value)
                if parsed is None:
                    raise ValueError("not a boolean")
                out[key] = parsed
            elif target is int:
                # int("8.0") raises, which is unhelpful for a value that came
                # from a numeric input, so go through float first.
                out[key] = int(value) if value.strip().lstrip("+-").isdigit() else int(float(value))
            elif target is float:
                out[key] = float(value)
            else:
                out[key] = value
        except (TypeError, ValueError):
            name = getattr(target, "__name__", str(target))
            raise ValueError(
                f"Argument '{key}' expects {name}, but got {value!r}."
            ) from None

    return out


def resolve_reference(value: Any, step_map: Dict[str, str], session_id: Optional[str] = None) -> Any:
    """
    Resolves a step-data reference token injected by the frontend wiring UI.

    Supported formats (all produced by PreviousStepDataPicker / DataOutputGrid):
      stepId                     → raw value OR pd.DataFrame          (whole grid)
      stepId.fieldName           → dict key / attr (raw) OR pd.Series (column)
      stepId["fieldName"]        → same, bracket form — what the UI emits
      stepId[row=R]              → one row as a pd.Series              (row)
      stepId["col"][R]           → scalar cell value                   (cell)
      stepId[row=R, col=C]       → scalar cell value, legacy spelling
      =Step Name!columnName      → pd.Series (Excel-style reference)

    Bracket and dot spellings are equivalent; `docs/dev_plan/100-architecture.md`
    settles that the UI always *emits* bracket form, because column names with
    spaces or unicode need no quoting decisions, while the parser accepts both
    because users type dot form by hand.

    Both ``RAW_STORE`` (single-cell ``step``-mode outputs) and ``DATA_STORE``
    (tabular DataFrames) are consulted.  ``RAW_STORE`` is checked first so a
    step-mode op's dict output can resolve ``step1.field`` via
    ``dict[field]`` without first being coerced to a DataFrame.

    `step_map` maps step IDs (and labels / positional aliases) to their
    output ref IDs.
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

    # ── dot syntax: stepId.fieldName ─────────────────────────────────────
    dot_match = re.match(r'^([\w-]+)\.(\w+)$', value)
    if dot_match:
        step_key = dot_match.group(1)
        field_name = dot_match.group(2)
        ref_id = step_map.get(step_key)
        if ref_id:
            # First: try RAW_STORE for ``step``-mode outputs.
            raw = _get_raw_only(ref_id, session_id=session_id)
            if raw is not None or _ref_exists_in_raw_store(ref_id, session_id=session_id):
                resolved = _resolve_raw_field(raw, field_name)
                if resolved is _FIELD_MISSING:
                    print(
                        f"  ⚠ Raw value at '{step_key}' has no field '{field_name}' "
                        f"(type={type(raw).__name__})"
                    )
                    return value
                print(f"  ↳ Resolved '{value}' → field '{field_name}' from raw step '{step_key}'")
                return resolved

            # Fallback: existing DataFrame column-access path.
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and field_name in df.columns:
                print(f"  ↳ Resolved '{value}' → column '{field_name}' from step '{step_key}'")
                return df[field_name]
        print(f"  ⚠ Could not resolve reference '{value}' (step_map keys: {list(step_map.keys())})")
        return value

    # ── bracket column: stepId["col"] ───────────────────────────────────
    # The canonical form the wiring UI emits.  Handled before the cell form
    # below so a trailing [R] is not mistaken for part of the column name.
    bracket_col = re.match(r'^([\w-]+)\[["\'](.+?)["\']\]$', value)
    if bracket_col:
        step_key, col_name = bracket_col.group(1), bracket_col.group(2)
        ref_id = step_map.get(step_key)
        if ref_id:
            raw = _get_raw_only(ref_id, session_id=session_id)
            if raw is not None or _ref_exists_in_raw_store(ref_id, session_id=session_id):
                resolved = _resolve_raw_field(raw, col_name)
                if resolved is not _FIELD_MISSING:
                    print(f"  ↳ Resolved '{value}' → field '{col_name}' from raw step '{step_key}'")
                    return resolved
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and col_name in df.columns:
                print(f"  ↳ Resolved '{value}' → column '{col_name}' from step '{step_key}'")
                return df[col_name]
        print(f"  ⚠ Could not resolve column reference '{value}'")
        return value

    # ── bracket cell: stepId["col"][R] ──────────────────────────────────
    bracket_cell = re.match(r'^([\w-]+)\[["\'](.+?)["\']\]\[(\d+)\]$', value)
    if bracket_cell:
        step_key, col_name = bracket_cell.group(1), bracket_cell.group(2)
        row_idx = int(bracket_cell.group(3))
        ref_id = step_map.get(step_key)
        if ref_id:
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and col_name in df.columns and row_idx < len(df):
                cell_val = df.iloc[row_idx][col_name]
                print(f"  ↳ Resolved '{value}' → cell [{row_idx},{col_name}] = {cell_val!r}")
                return cell_val
        print(f"  ⚠ Could not resolve cell reference '{value}'")
        return value

    # ── row: stepId[row=R] ──────────────────────────────────────────────
    # One horizontal slice, as a Series keyed by column name.  Distinct from
    # a cell (which also names a column) and from the whole grid.
    row_only = re.match(r'^([\w-]+)\[row=(\d+)\]$', value)
    if row_only:
        step_key, row_idx = row_only.group(1), int(row_only.group(2))
        ref_id = step_map.get(step_key)
        if ref_id:
            df = get_dataframe(ref_id, session_id=session_id)
            if df is not None and row_idx < len(df):
                print(f"  ↳ Resolved '{value}' → row {row_idx} ({len(df.columns)} columns)")
                return df.iloc[row_idx]
        print(f"  ⚠ Could not resolve row reference '{value}'")
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
        # Raw-store first
        if _ref_exists_in_raw_store(ref_id, session_id=session_id):
            raw = _get_raw_only(ref_id, session_id=session_id)
            print(f"  ↳ Resolved '{value}' → raw value (type={type(raw).__name__})")
            return raw
        # DataFrame fallback
        df = get_dataframe(ref_id, session_id=session_id)
        if df is not None:
            print(f"  ↳ Resolved '{value}' → full DataFrame ({len(df)} rows)")
            return df

    return value


# ── Raw-store helpers (used by resolve_reference) ────────────────────────────

# Sentinel returned by _resolve_raw_field when the field is genuinely
# absent — distinct from a value that happens to be ``None``.
_FIELD_MISSING = object()


def _get_raw_only(ref_id: str, session_id: Optional[str] = None) -> Any:
    """Look up *ref_id* only in ``RAW_STORE`` (no DataFrame fallback)."""
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
        candidate_tokens.extend(RAW_STORE.keys())

    for token in candidate_tokens:
        bucket = RAW_STORE.get(token)
        if bucket and ref_id in bucket:
            return bucket[ref_id]
    return None


def _ref_exists_in_raw_store(ref_id: str, session_id: Optional[str] = None) -> bool:
    """Check presence without confusing 'absent' with 'value is None'."""
    explicit_session_token = _session_token(session_id) if session_id is not None else None
    ref_session_token = _extract_session_token_from_ref(ref_id)

    if explicit_session_token and ref_session_token and explicit_session_token != ref_session_token:
        return False

    candidate_tokens = []
    if explicit_session_token:
        candidate_tokens.append(explicit_session_token)
    elif ref_session_token:
        candidate_tokens.append(ref_session_token)
    else:
        candidate_tokens.extend(RAW_STORE.keys())

    for token in candidate_tokens:
        bucket = RAW_STORE.get(token)
        if bucket and ref_id in bucket:
            return True
    return False


def _resolve_raw_field(raw: Any, field: str) -> Any:
    """
    Pull *field* out of a raw value, returning ``_FIELD_MISSING`` if the
    access cannot be performed.

    Order:
      1. ``dict[field]`` for dicts
      2. ``getattr(value, field)`` for objects (Pydantic models, dataclasses,
         namedtuples, anything with attribute access)
      3. Otherwise → missing
    """
    if isinstance(raw, dict):
        if field in raw:
            return raw[field]
        return _FIELD_MISSING
    # Object-style access — guard against returning bound methods or
    # Python internals by requiring the attribute to exist on the
    # instance (not just on the class).  This catches the common cases
    # (Pydantic ``BaseModel``, ``@dataclass``, ``NamedTuple``) without
    # giving access to ``__class__`` etc.
    if hasattr(raw, field) and not field.startswith('_'):
        try:
            attr = getattr(raw, field)
        except Exception:
            return _FIELD_MISSING
        # Don't expose methods as field values.
        if callable(attr) and not isinstance(attr, (int, float, str, bool, list, dict, tuple)):
            return _FIELD_MISSING
        return attr
    return _FIELD_MISSING


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

        # Legacy regex resolver couldn't handle it — try the AST evaluator
        # (covers Stage-3 selection forms: step1["col"][n], step1[["a","b"]],
        # step1[[0,2]], step1[0:5], chained subscripts, etc.).
        ast_result = _eval_ref_via_ast(ref_token, step_map, session_id=session_id)
        if ast_result is not None:
            return ast_result
        # Could not resolve — fall through to df_in

    if df_in is not None:
        return df_in

    return pd.DataFrame()


def _eval_ref_via_ast(
    ref_token: str,
    step_map: Dict[str, str],
    session_id: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """Evaluate a Stage-3 selection-style reference via safe_formula.

    Returns a DataFrame on success, or ``None`` if the expression can't be
    interpreted in the current step environment (caller falls back to df_in).
    """
    try:
        from . import safe_formula
        from .step_proxy import StepProxy, ColumnProxy
    except Exception:
        return None

    # Resolve every step in the map to its DataFrame so the AST env has
    # everything it might reference. Skip ones whose data is unavailable.
    env: Dict[str, pd.DataFrame] = {}
    seen_refs: set = set()
    for key, rid in step_map.items():
        if rid in seen_refs:
            # Same ref under multiple aliases (e.g. step1 / step_table / label)
            # — re-resolve so each alias maps to its DF.
            pass
        seen_refs.add(rid)
        df = get_dataframe(rid, session_id=session_id)
        if df is not None:
            env[key] = df

    try:
        result = safe_formula.run_formula(ref_token, steps=env)
    except Exception as exc:
        print(f"  ⚠ AST eval of '{ref_token}' failed: {exc}")
        return None

    # Unwrap proxies → pandas
    if isinstance(result, StepProxy):
        result = result._df
    elif isinstance(result, ColumnProxy):
        result = result._series

    if isinstance(result, pd.DataFrame):
        return result.reset_index(drop=True)
    if isinstance(result, pd.Series):
        name = result.name if result.name is not None else "value"
        return result.to_frame(name=name).reset_index(drop=True)
    # Scalar — wrap as 1×1 frame, inferring a column label from the
    # innermost subscript key if it's a string literal.
    col_label = _infer_scalar_column_label(ref_token)
    return pd.DataFrame([{col_label: result}])


def _infer_scalar_column_label(ref_token: str) -> str:
    """Best-effort: pull the last quoted-string subscript key from a ref expr."""
    matches = re.findall(r"""\[\s*['"]([^'"]+)['"]\s*\]""", ref_token)
    if matches:
        return matches[-1]
    return "value"


def _step_result_metrics(result: Any) -> dict:
    """
    Build the metrics dict returned to the frontend for a ``step``-mode result.

    The frontend's existing contract expects ``{"rows", "columns"}`` — keep
    those keys populated for backwards compatibility.  Add a ``kind``
    discriminator so newer clients can render the right view (JSON tree
    vs. data grid) without round-tripping through ``/api/data``.

    Single source of truth: ``main._raw_meta`` mirrors this exactly so
    ``/api/run`` (metrics) and ``/api/data-meta`` (meta) report the same
    ``value_type`` and ``columns`` for any given value.
    """
    if isinstance(result, pd.DataFrame):
        return {
            "kind": "dataframe",
            "rows": int(len(result)),
            "columns": [str(c) for c in result.columns],
        }
    if isinstance(result, dict):
        return {
            "kind": "raw",
            "value_type": "dict",
            "rows": 1,
            "columns": [str(k) for k in result.keys()],
        }
    if isinstance(result, list):
        # Distinguish list[dict] (table-shaped) from list[scalar] so the
        # frontend can pick the right renderer without a second round-trip.
        if result and isinstance(result[0], dict):
            cols: list = []
            for row in result:
                if isinstance(row, dict):
                    for k in row.keys():
                        if k not in cols:
                            cols.append(str(k))
            return {
                "kind": "raw",
                "value_type": "list[dict]",
                "rows": len(result),
                "columns": cols,
            }
        return {
            "kind": "raw",
            "value_type": "list",
            "rows": len(result),
            "columns": ["value"],
        }
    if result is None:
        return {"kind": "raw", "value_type": "none", "rows": 0, "columns": []}
    # Scalars, Pydantic models, dataclasses, anything else
    columns: list = []
    if hasattr(result, "model_fields"):  # Pydantic v2
        columns = list(result.model_fields.keys())
    elif hasattr(result, "__dataclass_fields__"):
        columns = list(result.__dataclass_fields__.keys())
    return {
        "kind": "raw",
        "value_type": type(result).__name__,
        "rows": 1,
        "columns": columns if columns else ["value"],
    }


def _runs_on_grid(op_id: str) -> bool:
    """Core verb operations always run on the grid; tools do when the
    ``engine`` setting says so."""
    entry = OPERATION_REGISTRY.get(op_id) or {}
    if entry.get("type") == "verb":
        return True
    if not entry:
        return False
    from .settings import get_settings
    return get_settings().engine == "grid"


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

    # 1b. A formula in core's own syntax (tool[mod.verb(…)](wf["x"], …)) is
    # compiled from its text and run on the grid. The op id and config the UI
    # derived from it don't matter: the formula is the whole definition.
    if formula:
        from .operation_formula import is_canonical
        if is_canonical(formula):
            from .grid_runner import run_canonical_step
            try:
                return run_canonical_step(formula, step_map, session_id, result_store)
            except Exception as e:
                raise ValueError(f"Error executing step: {e}") from e

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

    # 2c. Core's grid model. Returns None for what core cannot run yet
    # (whole-table tools — core_bridge.needs_whole_frame_shim), which then
    # falls through to the legacy orchestrators below.
    if _runs_on_grid(op_id):
        from .grid_runner import run_grid_step
        try:
            ran = run_grid_step(op_id, config, step_map, input_ref_id,
                                session_id, result_store)
        except Exception as e:
            # Same wording as the legacy path, so the UI log reads alike.
            raise ValueError(f"Error executing step {op_id}: {e}") from e
        if ran is not None:
            return ran

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

    # ── 3a. Single-cell 'step' fast-path ─────────────────────────────────
    # The v0.2 default mode.  One call, one return value, no DataFrame
    # coercion.  Inputs come exclusively from explicit ``step1`` /
    # ``step1.field`` refs in the formula — there is no implicit
    # "previous step's output" plumbing.
    if orchestrator_type == 'step':
        resolved_config = {}
        for k, v in config.items():
            if k.startswith('_'):
                continue
            resolved_config[k] = resolve_reference(v, step_map, session_id=session_id)

        # Text values -> the parameter's annotated type (see
        # coerce_config_to_signature).
        # Coerce against the RAW function: it carries the real annotations,
        # whereas the orchestrator wrapper takes _input_df and **kwargs.
        resolved_config = coerce_config_to_signature(func, resolved_config)

        wrapper = ORCHESTRATORS.get('step')
        executable = wrapper(func)
        print(f"Running '{op_id}' as step (single-cell)")
        try:
            result = executable(**resolved_config)
        except Exception as e:
            if os.environ.get("SIMPLE_STEPS_DEBUG_TRACEBACKS", "").strip().lower() in {"1", "true", "yes"}:
                import traceback
                traceback.print_exc()
            raise ValueError(f"Error executing step {op_id}: {str(e)}") from e

        out_ref = save_raw_value(result, session_id=session_id)
        return out_ref, _step_result_metrics(result)

    # ── 3b. Tabular path (legacy modes: source/map/filter/expand/dataframe/raw_output) ─
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
        resolved_val = resolve_reference(v, step_map, session_id=session_id)
        resolved_config[k] = resolved_val

    # Coerce against the RAW function: it carries the real annotations,
    # whereas the orchestrator wrapper takes _input_df and **kwargs. The input
    # frame's columns are passed so a column reference is not mistaken for a
    # badly typed literal.
    resolved_config = coerce_config_to_signature(
        func, resolved_config,
        column_names=None if df_in is None else df_in.columns,
    )

    if df_in is not None:
        resolved_config['_input_df'] = df_in

    # If any resolved config values are DataFrames or Series, they will
    # cause unexpected keyword argument errors when passed directly to
    # dataframe-style functions. Move such values into '_input_df' so the
    # dataframe wrapper can inject them under the expected parameter name
    # (e.g., 'df' or 'data'). This handles cases like config: {"data": "step1"}
    # where resolve_reference returned a DataFrame object.
    # Use the raw function signature to decide how to treat DataFrame/Series
    try:
        import inspect as _inspect
        sig = _inspect.signature(func)
        func_params = set(sig.parameters.keys())
    except Exception:
        func_params = set()

    for key, val in list(resolved_config.items()):
        try:
            import pandas as _pd
        except Exception:
            _pd = None

        # If it's a Series and the function expects this named parameter,
        # convert it to a plain list so functions expecting List inputs
        # (common for consumer-style ops) receive a native Python list.
        if _pd is not None and isinstance(val, _pd.Series):
            if key in func_params:
                resolved_config[key] = val.tolist()
                continue

        # If it's a DataFrame or Series and the function does NOT accept
        # the corresponding kwarg name, move it into the special
        # '_input_df' slot so dataframe-oriented orchestrators can inject
        # it under the expected parameter name (df/data).
        if _pd is not None and isinstance(val, (_pd.DataFrame, _pd.Series)):
            if key not in func_params:
                resolved_config.pop(key, None)
                if '_input_df' not in resolved_config:
                    resolved_config['_input_df'] = val
    
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
