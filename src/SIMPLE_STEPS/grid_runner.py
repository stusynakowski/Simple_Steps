"""
grid_runner.py — run a formula in core's syntax outside a workflow, and what
every run reports.

A step of a workflow runs in that workflow's kernel (``kernels``). A formula
on its own — the steps it reads given as stored outputs — runs here, in a
throwaway kernel with those outputs as its steps (:func:`run_formula`). Both
report the same metrics (:func:`_engine_metrics`).
"""

from __future__ import annotations

import inspect
import json
import typing
from typing import Any, Callable, Dict, Optional, Tuple


class GridStepError(ValueError):
    """A step that core declared invalid, or the translation could not build."""


_FORMULA_STEP = "__formula__"


def run_formula(formula: str, load: Callable[[str], Any],
                resources: Optional[Dict[str, Any]] = None,
                live: Optional[Callable[[str, Dict[str, Any]], Any]] = None):
    """Compile *formula* (core's syntax) and run it in a throwaway kernel.

    *load(name)* returns the data of the step called *name*, or ``None`` when
    there is no such step (or it hasn't run). *resources* is the workflow's
    ``resources`` section; *live(name, declaration)* the object to run each
    one with (by default, the session-less store in :mod:`.resources`).
    Returns ``(step, operation spec)``.
    """
    from simple_steps_core import Kernel
    from .catalog import catalog
    from .engine import values
    from .kernels import operation_for
    from .operation_formula import compile_formula
    from .resources import ResourceError, live_resource, resolve

    cat = catalog()
    declarations = resources or {}
    live = live or (lambda name, decl: live_resource(None, name, decl))
    compiled = compile_formula(formula)
    k = Kernel(cat)
    for name in compiled.reads:
        data = load(name)
        if data is None:
            raise GridStepError(
                f'no earlier step named "{name}" has output — check the name in '
                f'wf["{name}"], or run that step first'
            )
        k[name] = values(data) if hasattr(data, "columns") else data
    operation = operation_for(formula, declarations, cat)
    try:
        for name in operation.resources:
            cls, settings = resolve(name, declarations[name])
            k.define(name, cls, **settings)
            k.resources.attach(name, live(name, declarations[name]))
    except (ResourceError, TypeError) as exc:
        raise GridStepError(str(exc)) from exc
    k[_FORMULA_STEP] = operation
    step = k.step(_FORMULA_STEP)
    if step.problems:
        raise GridStepError("; ".join(str(p) for p in step.problems))
    k.run(_FORMULA_STEP)
    return k.step(_FORMULA_STEP), operation.to_dict()


def infer_verb_for(parts: dict, upstream: Any = None,
                   resources: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    """The shape verb the step editor should write for *parts*, and why.

    Core resolves an inferred verb once, when the step is wired, into a
    concrete one the user sees and can change — so the editor asks here
    whenever the input or an argument changes. *upstream* is the input step's
    output if it has run; without it core still infers from the tool's
    signature (returns bool → filter, …).
    """
    from simple_steps_core import Kernel
    from .catalog import catalog
    from .resources import ResourceError, resolve

    if not parts.get("input"):
        return "source", "it reads no step"
    k = Kernel(catalog())
    k["input"] = upstream
    bound_to = parts.get("bound_to")
    if bound_to:
        declarations = resources or {}
        if bound_to not in declarations:
            return "map", f'res["{bound_to}"] isn\'t declared yet, so applying it per row'
        try:
            cls, settings = resolve(bound_to, declarations[bound_to], secrets=False)
            k.define(bound_to, cls, **settings)
        except (ResourceError, TypeError) as exc:
            return "map", str(exc)
    literals = {key: v for key, v in (parts.get("arguments") or {}).items()
                if not (isinstance(v, dict) and set(v) & {"$ref", "$res", "$expr"})}
    try:
        return k.infer_verb(parts.get("tool") or "", "input", literals, bound_to)
    except Exception as exc:     # core's inference is advice; never block the editor on it
        return "map", f"couldn't infer ({exc}), so applying it per row"


def _formula_tool(compiled, tools: Dict[str, Any], types: Dict[str, type]):
    """The callable a compiled formula names: a tool, or a resource's method."""
    if compiled.bound_to:
        cls = types.get(compiled.bound_to)
        return getattr(cls, compiled.tool_id, None) if cls is not None else None
    return tools.get(compiled.tool_id)


def _bind_positional_resources(compiled, fn, types: Dict[str, type]) -> None:
    """``tool(wf["x"], res["llm"])`` → ``llm=res["llm"]``, by type.

    An operation's spec takes resources by keyword. A positional resource binds
    to the one parameter whose annotation its declared type fits (a subclass
    fits its base); none or several is an error that says how to name it.
    """
    if not compiled.positional_resources:
        return
    try:
        hints = typing.get_type_hints(getattr(fn, "fn", fn))
    except Exception:
        hints = {}
    tool = compiled.tool_id
    for name in compiled.positional_resources:
        cls = types[name]               # the caller already refused undeclared names
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
    """``/api/run`` for a formula outside a workflow: run it, store the grid.

    *resources* is the workflow's ``resources`` section; their live objects
    are kept per session (:func:`.resources.live_resource`).
    """
    from .engine import get_value, save_dataframe, values
    from .resources import live_resource

    def load(name: str) -> Any:
        ref = step_map.get(name)
        return None if ref is None else get_value(ref, session_id=session_id)

    step, operation = run_formula(
        formula, load, resources=resources,
        live=lambda name, decl: live_resource(session_id, name, decl),
    )
    output = step.output
    if output.meta.get("verb") == "source" and len(output.failed):
        # One call, so one unit: if it failed there is no output to show.
        raise GridStepError(str(output.failed.iloc[0].get("error", "the tool failed")))
    out_ref = save_dataframe(step.data, session_id=session_id, store_mode=result_store)
    frame = values(step.data)
    return out_ref, {"rows": len(frame), "columns": [str(c) for c in frame.columns],
                     **_engine_metrics(operation, step, output)}


def _engine_metrics(operation: dict, step, output) -> dict:
    """What core adds to a run's metrics: the operation it ran, the state of
    each row, and its warnings (spec 009)."""
    row_states = output.row_states
    failed = output.failed
    errors = [{"unit": str(unit), "error": str(row.get("error", ""))}
              for unit, row in failed.head(5).iterrows()]
    payload = output.value_column
    return {
        "engine": "grid",
        # `auto` is resolved by core each run: this is the verb it picked.
        "verb": output.meta.get("verb") or _verb_of(operation),
        "operation": json.loads(json.dumps(operation, default=str)),
        "describe": step.describe(),
        "units": len(row_states),
        "failed": int(len(failed)),
        # Failed rows that stop Run All: not blocked upstream, not caught by
        # mod.try_except (REQ-RUN-003).
        "uncaught_failed": len(output.uncaught),
        # Valid but probably not meant: an argument overriding a column, an
        # output replacing one (REQ-RUN-001).
        "warnings": [str(w) for w in step.warnings],
        # One count per row state core uses (known, failed, blocked, …).
        "status_counts": {str(k): int(v) for k, v in row_states.value_counts().items() if v},
        "errors": errors,
        # Where each failed unit's error belongs in the output, so the grid
        # can show it in the cell itself: {row position: error}, for units
        # whose row is still in the output (map, group, … — not a dropped
        # filter row). Capped so a mass failure can't bloat the response.
        "payload_column": payload if payload is not None and payload in step.data.columns else None,
        "row_errors": _row_errors(step.data, failed),
    }


def _verb_of(operation: dict) -> str:
    """The outermost shape verb — or, for a combine (no modifiers), its kind."""
    if operation.get("inputs") or not operation.get("modifiers"):
        return operation.get("tool") or ""
    return operation["modifiers"][-1]["kind"]


_ROW_ERROR_CAP = 1000


def _row_errors(data, failed) -> Dict[str, str]:
    """``{output row position: error}`` for failed units still in the output."""
    index = data.index
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
