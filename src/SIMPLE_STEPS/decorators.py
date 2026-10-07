import functools
import inspect
import pandas as pd
from typing import Callable, Any, get_type_hints, Dict, List, Optional
from .models import OperationParam, OperationDefinition, OperationReturn

# Global registry for operations
# We will use this to replace the old REGISTRY and DEFINITIONS
OPERATION_REGISTRY: Dict[str, OperationDefinition] = {}
DEFINITIONS_LIST: List[OperationDefinition] = []


def _resolve_list_input(args, kwargs):
    """Resolve list input from first positional arg or a single list kwarg."""
    if args and isinstance(args[0], list):
        return ("arg", args[0], None)

    list_kwargs = [k for k, v in kwargs.items() if isinstance(v, list)]
    if len(list_kwargs) == 1:
        key = list_kwargs[0]
        return ("kwarg", kwargs[key], key)

    return (None, None, None)


def _apply_list_mode(func: Callable, args, kwargs, mode: str, strict: bool = False):
    """Apply map/flatmap over list inputs for non-proxy calls."""
    source_kind, items, kw_key = _resolve_list_input(args, kwargs)

    if items is None:
        if strict:
            raise ValueError(
                "Explicit __mode='map' or __mode='flatmap' requires either "
                "a list as the first positional argument or exactly one "
                "list-valued keyword argument."
            )
        return None

    def _call_with_item(item):
        if source_kind == "arg":
            return func(item, *args[1:], **kwargs)
        call_kwargs = dict(kwargs)
        call_kwargs[kw_key] = item
        return func(*args, **call_kwargs)

    if mode == "map":
        return [_call_with_item(item) for item in items]

    if mode == "flatmap":
        flattened = []
        for item in items:
            value = _call_with_item(item)
            if isinstance(value, list):
                flattened.extend(value)
            else:
                flattened.append(value)
        return flattened

    return None


def _normalize_mode(mode):
    """Normalize mode aliases to canonical orchestration mode names."""
    aliases = {
        "apply_across_rows": "map",
        "apply_and_flatten": "flatmap",
        "auto": "default",
    }
    return aliases.get(mode, mode)


def _auto_broadcast(func: Callable, operation_type: str = "map") -> Callable:
    """
    Wraps a @simple_step function so that StepProxy / ColumnProxy arguments
    are handled automatically depending on the operation type.

    Broadcast syntax options:
    - `fn(x)` → best-effort default behavior.
    - `fn(x, __mode="raw")` → force raw direct call.
    - `fn(xs, __mode="map")` or `fn(xs, __mode="apply_across_rows")` → map list inputs.
    - `fn(xs, __mode="flatmap")` or `fn(xs, __mode="apply_and_flatten")` → map + flatten.
    - `fn.apply_across_rows(xs)` → chaining helper for map.
    - `fn.apply_and_flatten(xs)` → chaining helper for flatmap.
    - `fn.run_raw(x)` → chaining helper for raw.

    operation_type="map"  (default)
        ColumnProxy args → broadcast the call row-wise, one call per row.
        This is like dragging a formula down a spreadsheet column.

    operation_type="dataframe" / "filter" / "expand" / "source" / "raw_output"
        ColumnProxy args → unwrapped to pd.Series and passed through as-is.
        StepProxy args   → unwrapped to pd.DataFrame.
        The function receives the whole column/table at once.

    If no proxy args are present, the function is called as-is regardless
    of operation_type (plain scalar call).

    Returns a StepProxy wrapping the resulting DataFrame, so steps can
    be chained:  step2 = op_b(text=op_a(url=step1.url).output)
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        from .step_proxy import ColumnProxy, StepProxy, step as make_step

        explicit_mode = _normalize_mode(kwargs.pop("__mode", None))
        allowed_modes = {None, "default", "raw", "map", "flatmap"}
        if explicit_mode not in allowed_modes:
            raise ValueError(
                "Invalid __mode. Allowed values are: default, raw, map, flatmap, "
                "apply_across_rows, apply_and_flatten, auto, or None."
            )

        if explicit_mode == "raw":
            return func(*args, **kwargs)

        # ── Check: are any arguments ColumnProxy or StepProxy? ───────────
        has_proxy = any(
            isinstance(v, (ColumnProxy, StepProxy))
            for v in list(kwargs.values()) + list(args)
        )

        if not has_proxy:
            # No proxies — optionally apply explicit/implicit list strategies.
            apply_mode = getattr(wrapper, "_apply", None)
            list_mode = explicit_mode if explicit_mode in ("map", "flatmap") else apply_mode
            strict_list_mode = explicit_mode in ("map", "flatmap")

            if list_mode in ("map", "flatmap"):
                mapped = _apply_list_mode(
                    func,
                    args,
                    kwargs,
                    mode=list_mode,
                    strict=strict_list_mode,
                )
                if mapped is not None:
                    return mapped

            # Plain scalar call, just run the function
            result = func(*args, **kwargs)
            if isinstance(result, pd.DataFrame):
                return make_step(result, label=func.__name__)
            return result

        # ── Determine the source step (for merging results back) ─────────
        source_step = None
        for v in list(kwargs.values()) + list(args):
            if isinstance(v, ColumnProxy):
                source_step = v._step
                break
            if isinstance(v, StepProxy):
                source_step = v
                break

        # ── NON-MAP modes: unwrap proxies → pandas objects, call once ────
        op = "map" if explicit_mode in ("map", "flatmap") else getattr(wrapper, '_operation_type', operation_type)
        if op != "map":
            unwrapped_args = [_unwrap(a) for a in args]
            unwrapped_kwargs = {k: _unwrap(v) for k, v in kwargs.items()}
            result = func(*unwrapped_args, **unwrapped_kwargs)
            if isinstance(result, pd.DataFrame):
                return make_step(result, label=func.__name__)
            if isinstance(result, pd.Series):
                return make_step(result.to_frame(), label=func.__name__)
            return result

        # ── MAP mode: broadcast row-wise ─────────────────────────────────
        col_proxies = {}
        scalar_kwargs = {}
        for k, v in kwargs.items():
            if isinstance(v, ColumnProxy):
                col_proxies[k] = v
            elif isinstance(v, StepProxy):
                scalar_kwargs[k] = object.__getattribute__(v, "_df")
            else:
                scalar_kwargs[k] = v

        col_args = []
        scalar_args = []
        for a in args:
            if isinstance(a, ColumnProxy):
                col_args.append(a)
            elif isinstance(a, StepProxy):
                scalar_args.append(object.__getattribute__(a, "_df"))
            else:
                scalar_args.append(a)

        n_rows = len(next(iter(col_proxies.values()))) if col_proxies else (
            len(col_args[0]) if col_args else 0
        )

        input_df = object.__getattribute__(source_step, "_df") if source_step else None

        results = []
        for i in range(n_rows):
            row_kwargs = dict(scalar_kwargs)
            for k, cp in col_proxies.items():
                row_kwargs[k] = cp._series.iloc[i]
            row_args = list(scalar_args)
            for cp in col_args:
                row_args.append(cp._series.iloc[i])

            row_result = func(*row_args, **row_kwargs)
            if isinstance(row_result, dict):
                results.append(row_result)
            else:
                results.append({f"{func.__name__}_output": row_result})

        if not results:
            return make_step(pd.DataFrame(), label=func.__name__)

        new_cols_df = pd.DataFrame(results)

        # Merge new columns with the input DataFrame (preserving existing data)
        if input_df is not None and len(input_df) == len(new_cols_df):
            result_df = input_df.copy().reset_index(drop=True)
            for col in new_cols_df.columns:
                result_df[col] = new_cols_df[col].values
        else:
            result_df = new_cols_df

        return make_step(result_df, label=func.__name__)

    # Stash metadata so the engine / eval can inspect it
    wrapper._raw_func = func
    wrapper._operation_type = operation_type
    wrapper._apply = None  # set by simple_step when apply= is provided

    # Chaining-style convenience methods for explicit orchestration.
    wrapper.apply_across_rows = lambda data, *args, **kwargs: wrapper(
        data, *args, __mode="map", **kwargs
    )
    wrapper.apply_and_flatten = lambda data, *args, **kwargs: wrapper(
        data, *args, __mode="flatmap", **kwargs
    )
    wrapper.run_raw = lambda *args, **kwargs: wrapper(*args, __mode="raw", **kwargs)

    return wrapper


def _unwrap(obj):
    """Convert proxy objects to their pandas equivalents for pass-through calls."""
    from .step_proxy import ColumnProxy, StepProxy
    if isinstance(obj, ColumnProxy):
        return obj._series
    if isinstance(obj, StepProxy):
        return object.__getattribute__(obj, "_df")
    return obj

def simple_step(name: str = None, category: str = "General", operation_type: str = "map", id: str = None, apply: str = None):
    """
    Deprecated alias for :func:`simple_step_tool`.

    Kept so existing tool modules keep importing cleanly. New code should say
    ``@simple_step_tool`` for a tool, and declare objects tools *use* with
    ``simple_step_resource``. This delegates rather than duplicating the
    registration path — there is exactly one place a contract is derived.
    """
    return simple_step_tool(
        name=name,
        category=category,
        operation_type=operation_type,
        id=id,
        apply=apply,
    )


# --------------------------------------------------------------------------- #
# simple_step_tool — the core-backed decorator                                #
# --------------------------------------------------------------------------- #

# core's ToolParam.type_name is a human-readable annotation ("str", "int",
# "DataFrame"). The UI needs its own coarser vocabulary for form widgets.
_UI_TYPE_BY_ANNOTATION = {
    "int": "number", "float": "number", "complex": "number",
    "bool": "boolean",
    "list": "list", "tuple": "list", "set": "list",
    "dict": "object", "Mapping": "object",
    "DataFrame": "dataframe", "Series": "dataframe",
}


# JSON Schema type -> the UI's widget vocabulary. Used to resolve annotations
# whose Python name says nothing useful, above all "Literal": the values decide
# the type, so Literal["a","b"] is a string and Literal[1,2] a number.
_UI_TYPE_BY_SCHEMA = {
    "string": "string", "integer": "number", "number": "number",
    "boolean": "boolean", "array": "list", "object": "object",
}


def _ui_type(type_name: str, schema_type: str = None) -> str:
    """
    Map a core annotation name onto the UI's widget type.

    ``schema_type`` is the JSON Schema type core derived for the same
    parameter. It wins when the annotation name is uninformative — a
    ``Literal`` reports its name as just "Literal", which would otherwise
    fall through to "string" and mistype ``Literal[1, 2]``.
    """
    base = (type_name or "").split("[")[0].strip()
    if base in ("Literal", "Any", "", "Optional", "Union") and schema_type:
        return _UI_TYPE_BY_SCHEMA.get(schema_type, "string")
    if base in _UI_TYPE_BY_ANNOTATION:
        return _UI_TYPE_BY_ANNOTATION[base]
    lowered = base.lower()
    for key, ui in _UI_TYPE_BY_ANNOTATION.items():
        if lowered == key.lower():
            return ui
    return "string"


def _is_method(func: Callable) -> bool:
    """Whether *func* is being defined in a class body, taking ``self``."""
    parts = getattr(func, "__qualname__", "").split(".")
    if len(parts) < 2 or parts[-2] == "<locals>":
        return False
    try:
        params = list(inspect.signature(func).parameters)
    except (TypeError, ValueError):
        return False
    return bool(params) and params[0] == "self"


def simple_step_tool(
    name: str = None,
    category: str = "General",
    operation_type: str = "map",
    id: str = None,
    apply: str = None,
    description: str = None,
    resource: str = None,
):
    """
    Register a function as a Simple Steps **tool**.

    This is the explicit successor to ``@simple_step``: a tool is a function the
    user can call from the formula bar. Objects that tools *use* are declared
    with :func:`~SIMPLE_STEPS.core_bridge.simple_step_resource` instead.

    The tool's contract — parameters, types, required flags, input/output
    schema, resource dependencies — comes from ``simple_steps_core``'s
    ``ToolRegistry``. Core is the heart; this decorator is the adapter that
    also keeps the local engine's registry populated during the migration.

    Args:
        name: display label for the UI. Defaults to a title-cased function name.
        category: sidebar grouping.
        operation_type: default orchestration ("map", "source", "dataframe", …).
        id: explicit tool id. Defaults to the function name.
        apply: implicit list behaviour for non-proxy Python calls.
        description: overrides the docstring summary, which is used otherwise.
        resource: the resource this tool is bound to, if any.

    Returns:
        The auto-broadcasting wrapper, so direct Python calls and eval-mode
        formulas keep working exactly as they did under ``@simple_step``.
    """
    if callable(name):                       # bare @simple_step_tool
        return simple_step_tool()(name)

    def decorator(func: Callable):
        from .core_bridge import core_contract

        if _is_method(func):
            # A method of a @simple_step_resource class is a *bound* tool
            # (core 007): core records it on the type when the class decorator
            # runs, and it stays an ordinary method. It is never a global tool.
            from simple_steps_core import grid
            return grid.bound_tool(func)

        op_name = name or func.__name__.replace("_", " ").title()
        op_id = id or func.__name__

        # Core registers the tool and derives the contract; core_bridge fills
        # the fields core cannot express yet (see its module docstring).
        contract = core_contract(
            func,
            op_id,
            category=category,
            operation_type=operation_type,
            description=description,
            resource=resource,
        )

        params = [
            OperationParam(
                name=p["name"],
                type=_ui_type(p["type_name"], p.get("schema_type")),
                description=p["description"],
                default=p["default"],
                required=p["required"],
                kind=p["kind"],
                options=p.get("options"),
            )
            for p in contract.params
        ]

        definition = OperationDefinition(
            id=op_id,
            label=op_name,
            description=contract.description or (func.__doc__ or ""),
            type=operation_type,
            category=category,
            params=params,
            returns=OperationReturn(
                type=contract.output_type,
                form=contract.output_form,
                description=contract.output_description,
            ),
            resource=contract.resource,
            dependencies=contract.dependencies,
        )

        OPERATION_REGISTRY[op_id] = {
            "definition": definition,
            "func": func,            # raw, unwrapped — the engine calls this
            "category": category,
            "type": operation_type,
            "contract": contract,    # core's view, for the registry API
        }
        DEFINITIONS_LIST.append(definition)

        wrapped = _auto_broadcast(func, operation_type=operation_type)
        wrapped._apply = apply
        wrapped._tool_id = op_id
        return wrapped

    return decorator


def register_operation(
    func,
    op_id: str,
    name: str,
    category: str = "General",
    operation_type: str = "dataframe",
    params: Optional[list] = None,
    description: Optional[str] = None,
):
    """
    Register a plain Python function into the operation registry without
    using the @simple_step decorator.

    Parameters
    ----------
    func           : the callable to register
    op_id          : unique operation ID used in formula bar  e.g. "yt_fetch_videos"
    name           : human-readable label shown in the UI sidebar
    category       : sidebar grouping  e.g. "YouTube"
    operation_type : "source" | "map" | "filter" | "dataframe" | "expand" | "raw_output"
    params         : explicit param list (dicts with name/type/default keys).
                     If None, inferred from the function's type annotations.
    description    : override docstring shown in the UI.

    Usage (at the bottom of any .py file in the scanned src/ folders):

        register_operation(my_func, "my_op", "My Operation", "MyCategory", "map")
    """
    if params is None:
        params = _infer_params(func)

    definition = OperationDefinition(
        id=op_id,
        label=name,
        description=description or func.__doc__ or "",
        type=operation_type,
        category=category,
        params=params,
    )

    OPERATION_REGISTRY[op_id] = {
        "definition": definition,
        "func":       func,
        "category":   category,
        "type":       operation_type,
    }
    DEFINITIONS_LIST.append(definition)
    return func   # safe to use as a decorator if desired


def _infer_params(func) -> list:
    """Infer OperationParam objects from a function's signature and type annotations."""
    sig = inspect.signature(func)
    type_hints = {}
    try:
        type_hints = get_type_hints(func)
    except Exception:
        pass

    params = []
    for pname, p in sig.parameters.items():
        if pname == "return":
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if pname in ("df", "data", "_input_df"):
            continue   # conventional DataFrame args — injected by engine, not UI params

        py_type = type_hints.get(pname, Any)
        if py_type in (int, float):
            ui_type = "number"
        elif py_type == bool:
            ui_type = "boolean"
        elif py_type in (list, List):
            ui_type = "list"
        elif py_type in (dict, Dict):
            ui_type = "object"
        elif py_type == pd.DataFrame:
            ui_type = "dataframe"
        else:
            ui_type = "string"

        default = None if p.default is inspect.Parameter.empty else p.default
        params.append(OperationParam(
            name=pname,
            type=ui_type,
            description="No description provided",
            default=default,
        ))
    return params
