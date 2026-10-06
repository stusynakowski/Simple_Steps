"""
grid_runner.py — run one UI step through ``simple_steps_core``'s grid model.

Core's grid model is the integration surface (core ``docs/integration.md``):
a step is an **operation** — a tool, its bound arguments, and a stack of
modifiers whose outermost *shape verb* (``map``, ``filter``, ``select`` …)
decides the step's shape. This module translates what the UI sends to
``/api/run`` into exactly that JSON (``grid.Operation.from_dict``), runs it in
a one-step ``grid.Workflow``, and stores the result in the app's ref store so
``/api/data`` and the grid viewer are unchanged.

The translation, in one place:

=========================  =================================================
UI request                 core operation
=========================  =================================================
``operation_id``           ``tool_id`` (``identity`` for a tool-less verb op)
literal args               ``arguments`` (text coerced to the annotation)
``p=step1["col"]``         ``over: step1`` — plus a rename ``col → p`` first,
                           because core binds parameters to columns *by name*
``p=step1``                ``over: step1``
``_orchestrator``          the shape verb (else inferred by core, else source)
``_name``, ``_by``, …      that verb's settings (``modifier_catalog()``)
``_retry``, ``_timeout``   ``retry`` / ``timeout`` modifiers, applied per row
no step reference          ``source`` — the tool runs once, no input
=========================  =================================================

Tools are never registered with core: each run passes the app's own
``OPERATION_REGISTRY`` as the tools dict, so core resolves ids against it and
nothing leaks into ``grid.TOOLS``.

What core cannot do yet is shimmed in ``core_bridge`` and tagged there:
whole-table tools (``SHIM(core §A6)``) and steps that read two earlier steps
(core 004 §B6) fall back or fail with a pointer, never silently.
"""

from __future__ import annotations

import ast
import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

import pandas as pd
from simple_steps_core import grid

from .decorators import OPERATION_REGISTRY

# Verbs that apply no tool — core runs ``identity`` for them.
TOOLLESS_VERBS = ("select", "drop", "rename", "widen", "slice", "sort", "distinct")
# Verbs that apply a tool. ``expand`` and ``collapse`` fall back to a builtin
# (``identity`` / ``gather``) when none is named.
TOOL_VERBS = ("map", "filter", "group", "expand", "collapse", "sweep")
EXECUTION_MODIFIERS = {"retry": "times", "timeout": "seconds"}

# The UI's older orchestration names, mapped onto core verbs.
LEGACY_MODES = {"rowmap": "map", "step": "source", "raw_output": "source"}

# Group label for the verb operations in the palette.
VERB_CATEGORY = "Core verbs"

_INTERNAL = "_upstream"   # the step id the upstream data is loaded under
_BOUND = "_bound"         # the step id of the column-binding rename, if any

# step1 | step1["col"] | step1['col'] | step1.col
_REF = re.compile(
    r"""^\s*(?P<step>[A-Za-z_][\w]*)\s*
        (?:\[\s*(?P<q>['"])(?P<bcol>.*?)(?P=q)\s*\]|\.(?P<dcol>[A-Za-z_]\w*))?\s*$""",
    re.VERBOSE,
)


# =Step 1!column — the Excel-style spelling the UI's wiring picker emits.
_EXCEL_REF = re.compile(r"^\s*=(?P<step>[^!]+)!(?P<col>.+)$")


class GridStepError(ValueError):
    """A step that core declared invalid, or the translation could not build."""


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def run_grid_step(
    op_id: str,
    config: Dict[str, Any],
    step_map: Dict[str, str],
    input_ref_id: Optional[str],
    session_id: Optional[str],
    result_store: Optional[str] = None,
) -> Optional[Tuple[str, dict]]:
    """Run one step through core. Returns ``(output_ref, metrics)``.

    Returns ``None`` for what core cannot run yet — a whole-table tool, or a
    value taken from another step — and the caller runs it on the legacy path
    (``core_bridge.needs_whole_frame_shim``).
    """
    from .core_bridge import needs_whole_frame_shim
    from .engine import _step_result_metrics, get_value, save_dataframe, save_raw_value

    plan = _plan(op_id, config, step_map, input_ref_id, session_id)
    if needs_whole_frame_shim(plan.verb, plan.table_args, plan.value_args):
        return None
    if plan.upstream_ref is None and plan.verb not in ("source", "sweep"):
        raise GridStepError(
            f"'{plan.verb}' needs a step to read. Reference one in the formula, "
            f"e.g. {op_id}(step1), or run a step before this one."
        )

    wf = grid.Workflow()
    over = None
    if plan.upstream_ref is not None:
        data = get_value(plan.upstream_ref, session_id=session_id)
        if data is None:
            raise GridStepError(
                "the step this reads has no output in this session — run it first"
            )
        wf[_INTERNAL] = data
        over = _INTERNAL
        if plan.renames:
            _check_renames(plan.renames, data)
            wf[_BOUND] = grid.Operation.from_dict({
                "tool_id": "identity", "input": _ref(_INTERNAL), "arguments": {},
                "modifiers": [{"kind": "rename", "params": {"columns": plan.renames}}],
            })
            over = _BOUND

    tools = _tools()
    returned: Dict[str, Any] = {}
    if plan.verb == "source" and plan.tool_id in tools:
        tools[plan.tool_id] = _recording(tools[plan.tool_id], returned)
    operation = _operation(plan, over)
    try:
        wf["step"] = grid.Operation.from_dict(operation, tools)
    except Exception as exc:  # malformed operation JSON
        raise GridStepError(f"core rejected the operation: {exc}") from exc

    step = wf.step("step")
    if step.problems:
        raise GridStepError("; ".join(step.problems))
    if over == _BOUND:
        wf.run(_BOUND, tools)
    wf.run("step", tools)

    step = wf.step("step")
    output = step.output
    if plan.verb == "source":
        # One call, so one unit: if it failed there is no output to show.
        if len(output.failed):
            raise GridStepError(str(output.failed.iloc[0].get("error", "the tool failed")))
        if plan.keep_raw and not isinstance(returned.get("value"), pd.DataFrame):
            # A `step` tool's single value (dict, list of records, scalar,
            # None) is kept raw, as the app always has: `step1.field` reads it
            # and the viewer renders records as rows. Core agrees on the
            # semantics — when a later step reads it, core wraps it as one
            # cell. Metrics stay exactly what /api/data-meta reports.
            value = returned.get("value")
            return save_raw_value(value, session_id=session_id), _step_result_metrics(value)

    frame = _restore_bound_columns(output.data, plan.renames, plan.verb_settings.get("name"))
    frame = frame.reset_index(drop=True)
    out_ref = save_dataframe(frame, session_id=session_id, store_mode=result_store)
    return out_ref, {"rows": len(frame), "columns": [str(c) for c in frame.columns],
                     **_engine_metrics(operation, step, output)}


# ─────────────────────────────────────────────────────────────────────────────
# Formulas in core's own syntax: tool[mod.verb(…)](wf["x"], k=v)
# ─────────────────────────────────────────────────────────────────────────────

_FORMULA_STEP = "__formula__"


def run_formula(formula: str, load: Callable[[str], Any],
                tools: Optional[Dict[str, Any]] = None):
    """Compile *formula* (core's syntax) and run it in core.

    *load(name)* returns the data of the step called *name*, or ``None`` when
    there is no such step (or it hasn't run). Every step the formula reads —
    its input and any argument references — is loaded into a one-off
    ``grid.Workflow`` under its own name, so the operation core runs is exactly
    the one the formula spells. Returns ``(step, operation_json)``.
    """
    from .operation_formula import compile_formula

    compiled = compile_formula(formula)
    wf = grid.Workflow()
    for name in compiled.reads:
        data = load(name)
        if data is None:
            raise GridStepError(
                f'no earlier step named "{name}" has output — check the name in '
                f'wf["{name}"], or run that step first'
            )
        wf[name] = data

    tools = tools if tools is not None else _tools()
    inferred = None
    if compiled.modifiers is None:
        # tool(wf["x"], …): infer the verb from the tool, with the input's data
        # loaded — never from a not-yet-run source (core 005 K2).
        fn = tools.get(compiled.tool_id) or grid.BUILTIN_TOOLS.get(compiled.tool_id)
        if fn is None:
            raise GridStepError(f"no tool named '{compiled.tool_id}'")
        if compiled.input is None:
            inferred = "source"
        else:
            literals = {k: v for k, v in compiled.arguments.items()
                        if not (isinstance(v, dict) and set(v) == {"$ref"})}
            inferred, _why = grid.infer_verb(getattr(fn, "fn", fn),
                                             wf.step(compiled.input).output, literals)
    operation = compiled.operation(inferred)

    try:
        wf[_FORMULA_STEP] = grid.Operation.from_dict(operation, tools)
    except Exception as exc:
        raise GridStepError(f"core rejected the operation: {exc}") from exc
    step = wf.step(_FORMULA_STEP)
    if step.problems:
        raise GridStepError("; ".join(step.problems))
    wf.run(_FORMULA_STEP, tools)
    return wf.step(_FORMULA_STEP), operation


def run_canonical_step(formula: str, step_map: Dict[str, str],
                       session_id: Optional[str],
                       result_store: Optional[str] = None) -> Tuple[str, dict]:
    """``/api/run`` for a formula in core's syntax: run it, store the grid."""
    from .engine import get_value, save_dataframe

    def load(name: str) -> Any:
        ref = step_map.get(name)
        return None if ref is None else get_value(ref, session_id=session_id)

    step, operation = run_formula(formula, load)
    output = step.output
    if operation["modifiers"][-1]["kind"] == "source" and len(output.failed):
        # One call, so one unit: if it failed there is no output to show.
        raise GridStepError(str(output.failed.iloc[0].get("error", "the tool failed")))
    frame = output.data.reset_index(drop=True)
    out_ref = save_dataframe(frame, session_id=session_id, store_mode=result_store)
    return out_ref, {"rows": len(frame), "columns": [str(c) for c in frame.columns],
                     **_engine_metrics(operation, step, output)}


# ─────────────────────────────────────────────────────────────────────────────
# Planning: UI request → the parts of a core operation
# ─────────────────────────────────────────────────────────────────────────────

class _Plan:
    def __init__(self) -> None:
        self.tool_id: str = "identity"
        self.verb: str = "source"
        self.arguments: Dict[str, Any] = {}
        self.verb_settings: Dict[str, Any] = {}
        self.execution: List[dict] = []
        self.renames: Dict[str, str] = {}      # upstream column → tool parameter
        self.upstream_ref: Optional[str] = None
        self.table_args: List[str] = []        # params handed a whole table
        self.value_args: List[str] = []        # params handed a value from a step
        self.keep_raw: bool = False            # a `step` tool: store its value raw


def _plan(op_id: str, config: Dict[str, Any], step_map: Dict[str, str],
          input_ref_id: Optional[str], session_id: Optional[str]) -> _Plan:
    from .engine import coerce_config_to_signature, resolve_reference

    plan = _Plan()
    entry = OPERATION_REGISTRY.get(op_id)
    if entry is None:
        raise GridStepError(f"Operation '{op_id}' is not registered")

    internal = {k[1:]: v for k, v in config.items() if k.startswith("_")}
    args = {k: v for k, v in config.items() if not k.startswith("_")}
    for kind, param in EXECUTION_MODIFIERS.items():
        if internal.get(kind) not in (None, "", 0, "0"):
            plan.execution.append({"kind": kind, "params": {param: _number(internal[kind])}})

    if entry.get("type") == "verb":
        _plan_verb_op(plan, op_id, args, step_map, input_ref_id)
        _apply_internal_settings(plan, internal)
        return plan

    # A tool. Step references become `over` (plus a rename when the column and
    # parameter names differ); everything else is a literal bound to the tool.
    plan.tool_id = op_id
    plan.verb = _verb_for(entry, internal)
    mode = str(internal.get("orchestrator") or entry.get("type") or "")
    plan.keep_raw = plan.verb == "source" and mode in ("step", "raw_output")
    func = entry["func"]
    literals: Dict[str, Any] = {}
    upstreams = set()
    for name, value in args.items():
        ref = _step_ref(value, step_map)
        if ref is None:
            literals[name] = value
            continue
        ref_id, column = ref
        stored = _stored(ref_id, session_id)
        is_table = isinstance(stored, pd.DataFrame)
        if column is None:
            if not is_table:
                plan.value_args.append(name)       # a raw value from a step
            else:
                upstreams.add(ref_id)
                if _takes_table(func, name):
                    plan.table_args.append(name)   # f(df: pd.DataFrame)
        elif is_table and column in stored.columns:
            if _takes_collection(func, name):
                plan.value_args.append(name)       # the whole column, as a list
            else:
                upstreams.add(ref_id)
                if column != name:
                    plan.renames[column] = name
        else:
            # A field of a single value (step1.key on a dict) — a literal.
            literals[name] = resolve_reference(value, step_map, session_id=session_id)

    if plan.table_args or plan.verb == "dataframe":
        plan.verb = "dataframe"
        return plan
    if plan.value_args:
        return plan
    if len(upstreams) > 1:
        raise GridStepError(
            "this step reads more than one earlier step; core's grid model reads "
            "exactly one upstream per step until multi-input lands (core 004 §B6)"
        )
    plan.upstream_ref = next(iter(upstreams), None)
    if plan.upstream_ref is None and input_ref_id and plan.verb not in ("source", "sweep"):
        _bind_previous_step(plan, func, literals, input_ref_id, session_id)

    literals = coerce_config_to_signature(func, literals)
    if plan.verb == "sweep":
        # A list-valued argument is a swept axis; the rest are bound.
        for name, value in list(literals.items()):
            if isinstance(value, str):
                value = _literal(value)
            if isinstance(value, (list, tuple)):
                plan.verb_settings[name] = list(value)
                literals.pop(name)
    if plan.verb == "source" and plan.upstream_ref is not None:
        plan.verb = "map"
    if plan.verb == "infer":
        plan.verb = _infer(func, plan, literals, session_id)
    plan.arguments = literals
    # After inference: `_name` etc. belong to whichever verb was settled on.
    _apply_internal_settings(plan, internal)
    return plan


def _plan_verb_op(plan: _Plan, verb: str, args: Dict[str, Any],
                  step_map: Dict[str, str], input_ref_id: Optional[str]) -> None:
    """``=select(over=step1, columns=[...])`` / ``=map(tool="scale", over=step1)``:
    the verb is the operation id, its tool (if any) the ``tool`` argument, and
    any argument that is not one of the verb's settings goes to the tool."""
    from .engine import coerce_config_to_signature

    plan.verb = verb
    plan.tool_id = str(args.pop("tool", "") or _default_tool(verb)).strip()
    over = args.pop("over", None)
    plan.upstream_ref = (_step_ref(over, step_map, required=True)[0]
                         if over is not None else input_ref_id)
    settings = _settings_of(verb)
    tool_args = {}
    for key, value in args.items():
        if key in settings:
            plan.verb_settings[key] = _coerce_setting(verb, key, value)
            continue
        if verb == "sweep":
            # =sweep(tool="grid_cell", model=["a", "b"], window=[7, 30]):
            # a list argument is a swept axis, anything else is bound.
            parsed = _literal(value) if isinstance(value, str) else value
            if isinstance(parsed, (list, tuple)):
                plan.verb_settings[key] = list(parsed)
                continue
        tool_args[key] = value
    tool_func = _func(plan.tool_id)
    plan.arguments = (coerce_config_to_signature(tool_func, tool_args)
                      if tool_func is not None else tool_args)


def _bind_previous_step(plan: _Plan, func, literals: Dict[str, Any],
                        input_ref_id: str, session_id: Optional[str]) -> None:
    """No reference in the formula: read the previous step only if something
    points at it — a chosen verb, an argument naming one of its columns
    (``url="url"``, the app's older spelling of a column binding), or a required
    parameter that one of its columns would bind. Otherwise the tool runs once,
    as a source."""
    import inspect

    previous = _stored(input_ref_id, session_id)
    columns = set(getattr(previous, "columns", []))
    named = {name: value for name, value in literals.items()
             if isinstance(value, str) and value in columns}
    try:
        params = inspect.signature(func).parameters
    except (TypeError, ValueError):
        params = {}
    unbound = [n for n, p in params.items()
               if p.default is inspect.Parameter.empty and n not in literals
               and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)]
    explicit_verb = plan.verb not in ("infer", "source")
    if not (explicit_verb or named or any(n in columns for n in unbound)):
        return
    plan.upstream_ref = input_ref_id
    for name, column in named.items():
        literals.pop(name)
        if column != name:
            plan.renames[column] = name


def _apply_internal_settings(plan: _Plan, internal: Dict[str, Any]) -> None:
    """``_name``, ``_by``, ``_initial`` … → the chosen verb's settings."""
    settings = _settings_of(plan.verb)
    for key, value in internal.items():
        if key in settings and key != "over" and key not in plan.verb_settings:
            plan.verb_settings[key] = _coerce_setting(plan.verb, key, value)


def _verb_for(entry: dict, internal: Dict[str, Any]) -> str:
    """The shape verb a tool runs under: the UI's choice, else inferred."""
    chosen = str(internal.get("orchestrator") or "").strip()
    if chosen:
        chosen = LEGACY_MODES.get(chosen, chosen)
        if chosen == "dataframe" or chosen in grid.SHAPE_VERBS:
            return chosen
        raise GridStepError(
            f"unknown orchestration '{chosen}'. Core's verbs: "
            f"{', '.join(sorted(grid.SHAPE_VERBS))}"
        )
    declared = entry.get("type") or "map"
    if declared == "dataframe":
        return "dataframe"
    if declared in ("source", "step", "raw_output"):
        return "source"
    # `map` is also the decorator's default, so it says nothing: let core infer
    # from the tool (returns bool → filter, list → expand, (acc, x) → collapse).
    return "infer"


def _infer(func, plan: _Plan, literals: Dict[str, Any], session_id: Optional[str]) -> str:
    if plan.upstream_ref is None:
        return "source"
    from .engine import get_value
    upstream = get_value(plan.upstream_ref, session_id=session_id)
    try:
        verb, _why = grid.infer_verb(func, upstream, literals)
    except Exception:
        return "map"
    return verb


# ─────────────────────────────────────────────────────────────────────────────
# Building the operation JSON
# ─────────────────────────────────────────────────────────────────────────────

def _operation(plan: _Plan, over: Optional[str]) -> dict:
    """Core's operation JSON. The input has its own slot, as a typed reference
    (core c73f6f8+); modifiers carry only literal settings."""
    if plan.verb == "source" and plan.tool_id == "identity":
        raise GridStepError("a source step needs a tool to call")
    # Innermost first: retry/timeout wrap each unit, the shape verb is outermost.
    modifiers = list(plan.execution) + [{"kind": plan.verb, "params": dict(plan.verb_settings)}]
    return {
        "tool_id": plan.tool_id,
        "input": _ref(over) if over is not None and plan.verb != "source" else None,
        "arguments": plan.arguments,
        "modifiers": modifiers,
    }


def _ref(step_id: str) -> dict:
    """A step reference in core's operation JSON — distinct from a string literal."""
    return {"$ref": step_id}


def _tools() -> Dict[str, Any]:
    """The app's registry as core's tools dict (verb operations excluded)."""
    return {op_id: entry["func"] for op_id, entry in OPERATION_REGISTRY.items()
            if entry.get("type") != "verb"}


def _default_tool(verb: str) -> str:
    return {"collapse": "gather"}.get(verb, "identity")


def _func(op_id: str):
    entry = OPERATION_REGISTRY.get(op_id) or {}
    return entry.get("func")


# ─────────────────────────────────────────────────────────────────────────────
# References and coercion
# ─────────────────────────────────────────────────────────────────────────────

def _step_ref(value: Any, step_map: Dict[str, str],
              required: bool = False) -> Optional[Tuple[str, Optional[str]]]:
    """``(ref_id, column | None)`` if *value* names an earlier step, else None."""
    if isinstance(value, str):
        excel = _EXCEL_REF.match(value)
        if excel and excel.group("step").strip() in step_map:
            return step_map[excel.group("step").strip()], excel.group("col").strip()
        match = _REF.match(value)
        if match and match.group("step") in step_map:
            column = match.group("bcol") if match.group("bcol") is not None else match.group("dcol")
            return step_map[match.group("step")], column
    if required:
        raise GridStepError(f"over={value!r} is not an earlier step that has run")
    return None


def _stored(ref_id: str, session_id: Optional[str]) -> Any:
    from .engine import get_value
    return get_value(ref_id, session_id=session_id)


def _settings_of(verb: str) -> Dict[str, dict]:
    entry = grid.modifier_catalog().get(verb) or {}
    return {s["name"]: s for s in entry.get("settings", [])}


def _coerce_setting(verb: str, key: str, value: Any) -> Any:
    """Text from the formula or a form field → the setting's declared type."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    kind = (_settings_of(verb).get(key) or {}).get("type") or ""
    if kind == "bool":
        return text.lower() in ("true", "1", "yes")
    if kind == "int":
        return int(text) if text else None
    if kind == "str":
        return text
    parsed = _literal(text)
    if parsed is not text:
        return parsed
    if "list" in kind:
        # columns="city, score" — the comma form a form field produces.
        return [part.strip() for part in text.split(",") if part.strip()]
    return text


def _literal(text: str) -> Any:
    """``ast.literal_eval`` of *text*, or *text* itself when it is not one."""
    try:
        return ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return text


def _takes_collection(func, name: str) -> bool:
    """Whether parameter *name* wants a whole column as one value
    (``values: list[float]``, ``col: pd.Series``) rather than one cell per row."""
    import collections.abc
    import inspect
    import typing
    try:
        param = inspect.signature(func).parameters.get(name)
    except (TypeError, ValueError):
        return False
    if param is None:
        return False
    ann = param.annotation
    if isinstance(ann, str):
        return ann.split("[")[0].split(".")[-1] in ("list", "List", "Sequence", "Series", "tuple")
    if ann in (list, tuple, pd.Series, typing.List, typing.Sequence):
        return True
    return typing.get_origin(ann) in (list, tuple, collections.abc.Sequence)


def _recording(fn, into: Dict[str, Any]):
    """*fn*, remembering what it returned — to tell a table from a value."""
    import functools

    @functools.wraps(fn)
    def recording(*args, **kwargs):
        result = fn(*args, **kwargs)
        into["value"] = result
        return result
    return recording


def _takes_table(func, name: str) -> bool:
    """Whether parameter *name* of *func* is annotated as a table."""
    import inspect
    try:
        param = inspect.signature(func).parameters.get(name)
    except (TypeError, ValueError):
        return False
    if param is None:
        return False
    ann = param.annotation
    if ann in (pd.DataFrame, pd.Series):
        return True
    return isinstance(ann, str) and ann.split(".")[-1] in ("DataFrame", "Series")


def _number(value: Any) -> Any:
    if isinstance(value, str):
        return ast.literal_eval(value.strip())
    return value


# ─────────────────────────────────────────────────────────────────────────────
# Column binding by a different name
# ─────────────────────────────────────────────────────────────────────────────

def _check_renames(renames: Dict[str, str], data: Any) -> None:
    columns = set(getattr(data, "columns", []))
    clashes = [p for c, p in renames.items() if p in columns and p not in renames]
    if clashes:
        raise GridStepError(
            f"cannot bind {', '.join(repr(c) for c in renames)} to "
            f"{', '.join(repr(p) for p in renames.values())}: the input already has "
            f"a column named {', '.join(repr(p) for p in clashes)}. Core binds a "
            "parameter to the column with its name — rename or drop that column first."
        )


def _restore_bound_columns(frame: pd.DataFrame, renames: Dict[str, str],
                           payload_name: Optional[str]) -> pd.DataFrame:
    """Undo the binding rename on carried columns, so a step keeps its input's
    column names (``step1["video_url"]`` stays ``video_url`` downstream)."""
    if not renames:
        return frame
    payload = payload_name or grid.PAYLOAD
    back = {p: c for c, p in renames.items() if p in frame.columns and p != payload}
    return frame.rename(columns=back)


# ─────────────────────────────────────────────────────────────────────────────
# Metrics: what the log and the step header show
# ─────────────────────────────────────────────────────────────────────────────

def _engine_metrics(operation: dict, step, output) -> dict:
    """What core adds to a run's metrics: the operation it ran and the ledger."""
    ledger = output.ledger
    failed = output.failed
    errors = [{"unit": str(unit), "error": str(row.get("error", ""))}
              for unit, row in failed.head(5).iterrows()]
    payload = operation["modifiers"][-1]["params"].get("name") or grid.PAYLOAD
    return {
        "engine": "grid",
        "verb": operation["modifiers"][-1]["kind"],
        "operation": json.loads(json.dumps(operation, default=str)),
        "describe": step.describe(),
        "units": len(ledger),
        "failed": int(len(failed)),
        "status_counts": {str(k): int(v) for k, v in ledger["status"].value_counts().items()},
        "errors": errors,
        # Where each failed unit's error belongs in the output, so the grid
        # can show it in the cell itself: {row position: error}, for units
        # whose row is still in the output (map, group, … — not a dropped
        # filter row). Capped so a mass failure can't bloat the response.
        "payload_column": payload if payload in output.data.columns else None,
        "row_errors": _row_errors(output, failed),
    }


_ROW_ERROR_CAP = 1000


def _row_errors(output, failed) -> Dict[str, str]:
    """``{output row position: error}`` for failed units still in the output."""
    index = output.data.index
    row_errors: Dict[str, str] = {}
    for label, row in failed.iterrows():
        if label not in index:
            continue
        position = index.get_loc(label)
        if not isinstance(position, int):   # a duplicated label — no single row
            continue
        row_errors[str(position)] = str(row.get("error", ""))
        if len(row_errors) >= _ROW_ERROR_CAP:
            break
    return row_errors


# ─────────────────────────────────────────────────────────────────────────────
# Verb operations in the palette
# ─────────────────────────────────────────────────────────────────────────────

_UI_TYPE = {"int": "number", "int | float": "number", "float": "number",
            "bool": "boolean", "str": "string", "reference": "dataframe"}


def register_verb_operations() -> None:
    """Add one palette entry per core shape verb, built from
    ``grid.modifier_catalog()`` so the list can never drift from core.

    ``=select(over=step1, columns=["city"])`` and
    ``=map(tool="scale", over=step1, name="score")`` are then ordinary formulas,
    typed in the formula bar or the console alike.
    """
    from .models import OperationDefinition, OperationParam, OperationReturn
    from .decorators import DEFINITIONS_LIST

    catalog = grid.modifier_catalog()
    for verb in TOOLLESS_VERBS + TOOL_VERBS:
        entry = catalog.get(verb)
        if entry is None or verb in OPERATION_REGISTRY:
            continue
        # The step this verb reads. Core c73f6f8 moved it out of the modifier's
        # settings into the operation's input slot, so the catalog no longer
        # lists it; the palette entry still needs the field.
        params: List[Any] = [OperationParam(
            name="over", type="dataframe", required=verb != "sweep", default=None,
            description="the step this reads",
        )]
        if verb in TOOL_VERBS:
            params.append(OperationParam(
                name="tool", type="string", required=verb in ("map", "filter", "group", "sweep"),
                default=_default_tool(verb) if verb in ("expand", "collapse") else None,
                description="the tool to apply — any palette tool id, or a builtin "
                            "(count, gather, total, first, last)",
            ))
        for setting in entry["settings"]:
            name = setting["name"]
            if name in ("retries", "axis") or name.startswith("<"):
                continue
            kind = setting.get("type") or ""
            params.append(OperationParam(
                name=name,
                type=_UI_TYPE.get(kind, "list" if "list" in kind else "string"),
                required=bool(setting.get("required")),
                default=setting.get("default"),
                description=setting.get("description") or "",
            ))
        definition = OperationDefinition(
            id=verb, label=verb.capitalize(),
            description=f"Core's `{verb}` verb — rows: {entry.get('row_rule')}.",
            type="verb", category=VERB_CATEGORY, params=params,
            returns=OperationReturn(type="DataFrame", form="grid"),
        )
        OPERATION_REGISTRY[verb] = {
            "definition": definition, "func": _verb_callable(verb),
            "category": VERB_CATEGORY, "type": "verb", "contract": None,
        }
        DEFINITIONS_LIST.append(definition)


def _verb_callable(verb: str):
    """``select(over=df, columns=[...])`` as a plain function, run by core.

    The formula bar goes through ``run_grid_step``; this is the same verb for
    direct calls — the console's ``safe_formula`` interpreter and Python
    scripts — so all three agree on what a verb does.
    """
    def run_verb(over: Any = None, tool: Optional[str] = None, **kwargs: Any) -> pd.DataFrame:
        data = getattr(over, "_df", over)          # unwrap a console StepProxy
        settings = _settings_of(verb)
        params = {k: _coerce_setting(verb, k, v) for k, v in kwargs.items() if k in settings}
        arguments = {k: v for k, v in kwargs.items() if k not in settings}
        wf = grid.Workflow()
        if data is not None:
            wf[_INTERNAL] = data
        tools = _tools()
        wf["step"] = grid.Operation.from_dict({
            "tool_id": (tool or _default_tool(verb)) if verb in TOOL_VERBS else "identity",
            "input": _ref(_INTERNAL) if data is not None else None,
            "arguments": arguments,
            "modifiers": [{"kind": verb, "params": params}],
        }, tools)
        if wf.step("step").problems:
            raise GridStepError("; ".join(wf.step("step").problems))
        wf.run("step", tools)
        return wf.step("step").output.data

    run_verb.__name__ = verb
    run_verb.__doc__ = f"Core's `{verb}` verb, run by simple_steps_core's grid model."
    return run_verb
