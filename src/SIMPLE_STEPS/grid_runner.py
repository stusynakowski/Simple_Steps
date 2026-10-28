"""
grid_runner.py — run a formula in core's syntax through ``simple_steps_core``.

A formula (``tool[mod.verb(…)](wf["x"], k=v)``, ``operation_formula``) compiles
to core's operation JSON; :func:`run_formula` runs it in a one-step
``grid.Workflow`` with the steps it reads loaded under their own names, and
:func:`run_canonical_step` stores the result so ``/api/data`` can page it.
A step of a workflow runs in that workflow's kernel instead (``kernels``),
which shares :func:`_engine_metrics` and the helpers here.

Tools are never registered with core: each run passes the app's own
``OPERATION_REGISTRY`` as the tools dict.
"""

from __future__ import annotations

import inspect
import json
import typing
from typing import Any, Callable, Dict, Optional, Tuple

from simple_steps_core import grid

from .decorators import OPERATION_REGISTRY


class GridStepError(ValueError):
    """A step that core declared invalid, or the translation could not build."""




_FORMULA_STEP = "__formula__"


def run_formula(formula: str, load: Callable[[str], Any],
                tools: Optional[Dict[str, Any]] = None,
                resources: Optional[Dict[str, Any]] = None,
                live: Optional[Callable[[str, Dict[str, Any]], Any]] = None):
    """Compile *formula* (core's syntax) and run it in core.

    *load(name)* returns the data of the step called *name*, or ``None`` when
    there is no such step (or it hasn't run). Every step the formula reads —
    its input and any argument references — is loaded into a one-off
    ``grid.Workflow`` under its own name, so the operation core runs is exactly
    the one the formula spells. Returns ``(step, operation_json)``.

    *resources* is the workflow's ``resources`` section (declarations: a type
    and literal settings, never an object). Each resource the formula uses is
    declared with ``wf.define`` before the step, so core can check its type;
    *live(name, declaration)* returns the object to run it with (by default, the
    session-less store in :mod:`.resources`).
    """
    from .operation_formula import compile_formula
    from .resources import ResourceError, live_resource, resolve

    compiled = compile_formula(formula)
    declarations = resources or {}
    live = live or (lambda name, decl: live_resource(None, name, decl))
    wf = grid.Workflow()
    # Resources first: a step declared before its resource is invalid in core.
    types: Dict[str, type] = {}
    for name in compiled.resources:
        if name not in declarations:
            known = ", ".join(f'res["{n}"]' for n in declarations) or "none yet"
            raise GridStepError(
                f'no resource named "{name}" in this workflow (its resources: {known}). '
                "Add it to the workflow's resources first"
            )
        try:
            # Defined or ready-made, core gets one plain declaration: the type
            # and the settings it builds with (deployment's + user's changes).
            types[name], settings = resolve(name, declarations[name])
            wf.define(name, types[name], **settings)
        except (ResourceError, TypeError) as exc:
            raise GridStepError(str(exc)) from exc

    for name in compiled.reads:
        data = load(name)
        if data is None:
            raise GridStepError(
                f'no earlier step named "{name}" has output — check the name in '
                f'wf["{name}"], or run that step first'
            )
        wf[name] = data

    tools = tools if tools is not None else _tools()
    fn = _formula_tool(compiled, tools, types)
    _bind_positional_resources(compiled, fn, types)
    inferred = None
    if compiled.needs_inference:
        # tool(wf["x"], …) is core's implicit auto (core 009 decision 6): it
        # saves `mod.auto()`, and core picks the verb from the data at each
        # run (reported in output.meta["auto"]). With no input it is a source.
        if fn is None:
            raise GridStepError(f"no tool named '{compiled.tool_id}'")
        inferred = "source" if compiled.input is None else "auto"
    bound_type = types[compiled.bound_to].__name__ if compiled.bound_to in types else None
    operation = compiled.operation(inferred, bound_type)

    try:
        wf[_FORMULA_STEP] = grid.Operation.from_dict(operation, tools)
    except Exception as exc:
        raise GridStepError(f"core rejected the operation: {exc}") from exc
    step = wf.step(_FORMULA_STEP)
    if step.problems:
        raise GridStepError("; ".join(step.problems))
    try:
        objects = {name: live(name, declarations[name]) for name in types}
        wf.run(_FORMULA_STEP, tools, resources=objects)
    except (ResourceError, grid.ResourceNotLoaded) as exc:
        raise GridStepError(str(exc)) from exc
    return wf.step(_FORMULA_STEP), operation


def infer_verb_for(parts: dict, upstream: Any = None,
                   resources: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    """The shape verb the step editor should write for *parts*, and why.

    Core resolves an inferred verb once, when the step is wired, into a
    concrete one the user sees and can change (``grid.infer_verb``'s doc) —
    so the editor asks here whenever the input or an argument changes.
    *upstream* is the input step's output if it has run; without it core
    still infers from the tool's signature (returns bool → filter, …).
    """
    if not parts.get("input"):
        return "source", "it reads no step"
    tool = parts.get("tool") or ""
    if parts.get("bound_to"):
        from .resources import ResourceError, resolve
        name = parts["bound_to"]
        declarations = resources or {}
        if name not in declarations:
            return "map", f'res["{name}"] isn\'t declared yet, so applying it per row'
        try:
            cls, _settings = resolve(name, declarations[name])
        except ResourceError as exc:
            return "map", str(exc)
        fn = getattr(cls, tool, None)
    else:
        fn = _tools().get(tool) or grid.builtin_tools().get(tool)
    if fn is None:
        return "map", f"no tool named '{tool}'"
    literals = {k: v for k, v in (parts.get("arguments") or {}).items()
                if not (isinstance(v, dict) and set(v) & {"$ref", "$res"})}
    try:
        return grid.infer_verb(getattr(fn, "fn", fn), upstream, literals)
    except Exception as exc:     # core's inference is advice; never block the editor on it
        return "map", f"couldn't infer ({exc}), so applying it per row"


def _formula_tool(compiled, tools: Dict[str, Any], types: Dict[str, type]):
    """The callable a compiled formula names: a tool, or a resource's method."""
    if compiled.bound_to:
        cls = types.get(compiled.bound_to)
        return getattr(cls, compiled.tool_id, None) if cls is not None else None
    return tools.get(compiled.tool_id) or grid.builtin_tools().get(compiled.tool_id)


def _bind_positional_resources(compiled, fn, types: Dict[str, type]) -> None:
    """``tool(wf["x"], res["llm"])`` → ``llm=res["llm"]``, by type.

    Core takes resources as keywords only. A positional resource binds to the
    one parameter whose annotation its declared type fits (a subclass fits its
    base); none or several is an error that says how to name it.
    """
    if not compiled.positional_resources:
        return
    try:
        hints = typing.get_type_hints(getattr(fn, "fn", fn))
    except Exception:
        hints = {}
    tool = compiled.tool_id
    for name in compiled.positional_resources:
        cls = types[name]               # run_formula already refused undeclared names
        fits = [param for param, ann in hints.items()
                if param not in ("return", "self") and param not in compiled.arguments
                and inspect.isclass(ann) and issubclass(cls, ann)]
        if len(fits) != 1:
            why = (f"{tool} has no parameter that takes a {cls.__name__}" if not fits else
                   f"{tool} has several parameters that take a {cls.__name__} "
                   f"({', '.join(fits)})")
            raise GridStepError(f'{why}; pass it by name: {tool}(…, <param>=res["{name}"])')
        compiled.arguments[fits[0]] = {"$res": name}
    compiled.positional_resources = []


def run_canonical_step(formula: str, step_map: Dict[str, str],
                       session_id: Optional[str],
                       result_store: Optional[str] = None,
                       resources: Optional[Dict[str, Any]] = None) -> Tuple[str, dict]:
    """``/api/run`` for a formula in core's syntax: run it, store the grid.

    *resources* is the workflow's ``resources`` section; their live objects
    are kept per session (:func:`.resources.live_resource`).
    """
    from .engine import get_value, save_dataframe
    from .resources import live_resource

    def load(name: str) -> Any:
        ref = step_map.get(name)
        return None if ref is None else get_value(ref, session_id=session_id)

    step, operation = run_formula(
        formula, load, resources=resources,
        live=lambda name, decl: live_resource(session_id, name, decl),
    )
    output = step.output
    if _verb_of(operation) == "source" and len(output.failed):
        # One call, so one unit: if it failed there is no output to show.
        raise GridStepError(str(output.failed.iloc[0].get("error", "the tool failed")))
    frame = output.data          # with its row ids (see run_grid_step)
    out_ref = save_dataframe(frame, session_id=session_id, store_mode=result_store)
    return out_ref, {"rows": len(frame), "columns": [str(c) for c in frame.columns],
                     **_engine_metrics(operation, step, output)}




def _tools() -> Dict[str, Any]:
    """The app's registry as core's tools dict (verb operations excluded)."""
    return {op_id: entry["func"] for op_id, entry in OPERATION_REGISTRY.items()
            if entry.get("type") != "verb"}


def _engine_metrics(operation: dict, step, output) -> dict:
    """What core adds to a run's metrics: the operation it ran, the state of
    each row, and its warnings (spec 009)."""
    row_states = output.row_states
    failed = output.failed
    errors = [{"unit": str(unit), "error": str(row.get("error", ""))}
              for unit, row in failed.head(5).iterrows()]
    payload = grid.payload_column(output)
    # `auto` is resolved by core each run; report the verb it picked.
    verb = (output.meta.get("auto") or {}).get("verb") or _verb_of(operation)
    return {
        "engine": "grid",
        "verb": verb,
        "operation": json.loads(json.dumps(operation, default=str)),
        "describe": step.describe(),
        "units": len(row_states),
        "failed": int(len(failed)),
        # Failed rows that stop Run All: not blocked upstream, not caught by
        # mod.try_except (REQ-RUN-003).
        "uncaught_failed": len(output.uncaught),
        # Valid but probably not meant: an argument overriding a column, an
        # output replacing one (REQ-RUN-001).
        "warnings": [str(w) for w in (getattr(step, "warnings", None) or ())],
        # One count per row state core uses (known, failed, blocked, …).
        "status_counts": {str(k): int(v) for k, v in row_states.value_counts().items() if v},
        "errors": errors,
        # Where each failed unit's error belongs in the output, so the grid
        # can show it in the cell itself: {row position: error}, for units
        # whose row is still in the output (map, group, … — not a dropped
        # filter row). Capped so a mass failure can't bloat the response.
        "payload_column": payload if payload is not None and payload in output.data.columns else None,
        "row_errors": _row_errors(output, failed),
    }


def _verb_of(operation: dict) -> str:
    """The outermost shape verb — or, for a combine (no modifiers), its kind."""
    if operation.get("inputs") or not operation["modifiers"]:
        return operation["tool_id"]
    return operation["modifiers"][-1]["kind"]


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


