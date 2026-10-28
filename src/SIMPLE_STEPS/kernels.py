"""
kernels.py — kernels: each open workflow, live (dev_plan/124 phase 2).

Vocabulary (docs/system_design/10-object-model.md): a **session** is a user's
browser connection (the ``ss_session`` cookie); a **kernel** is one workflow,
live, inside a session — core's ``Kernel``, with its catalog; the **kernel
manager** (below) decides which kernels are live and puts the others away.

Each run request carries every step's name and formula; they are
(re)declared in the session's kernel — an unchanged step is left alone, a
changed one makes core mark it and everything after it ``stale`` — and the
step is run there, so row links and staleness carry across steps. Core runs
the inputs that never ran first. The output is still stored under a ref id,
so ``/api/data``, ``/api/cell`` and the grid read it as before; every response
also reports each step's state (core's ``step.state``, ``stale_reason``,
``problems``).

Formulas are in core's syntax (``operation_formula``) or are values; a step
whose formula doesn't parse (the removed older syntax, say) is an empty step
with the parser's reason, so nothing reads what it used to compute.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from simple_steps_core import Kernel as CoreKernel
from simple_steps_core import Operation

from .grid_runner import GridStepError, _bind_positional_resources, _engine_metrics, _formula_tool


@dataclass
class Kernel:
    """One workflow, live: core's kernel, and what hosting it needs."""

    key: str
    k: CoreKernel
    #: The resource declarations it was built with (a change rebuilds it).
    declarations: Dict[str, Any]
    #: step → why its formula couldn't be declared (the parser's reason).
    problems: Dict[str, str] = field(default_factory=dict)
    #: the app's step id → its name, as last synced (to follow renames).
    ids: Dict[str, str] = field(default_factory=dict)
    #: When it was last used (time.monotonic), for the idle culler.
    last_used: float = 0.0
    lock: threading.RLock = field(default_factory=threading.RLock)


# ─────────────────────────────────────────────────────────────────────────────
# Kernels: the live workflows, and putting them away
# ─────────────────────────────────────────────────────────────────────────────
#
# As in JupyterHub, a kernel belongs to a session and a workflow; unlike a
# Jupyter kernel it has no hidden state, so it can be saved whole and brought
# back exactly — outputs, versions and row links — without recomputing
# anything (core_bridge.save_with_outputs, until core's output store).
#
# At most MAX_LIVE kernels per session are live (owner, 2026-10-21: one
# workflow is worked on at a time). Opening another saves the least recently
# used one to disk first; one idle for IDLE_SECONDS is saved and freed; all are
# saved when the server stops. Asking for a saved one restores it.

#: Live kernels per session. One, by the owner's rule; raise it to keep
#: several tabs live.
MAX_LIVE = 1
#: A kernel unused this long is saved to disk and freed.
IDLE_SECONDS = 30 * 60
#: Whether kernels are saved to disk when put away. Off for throwaway runs
#: (the examples' checks), which then just start fresh.
PERSIST = True

#: session → workflow key → its live kernel.
_LIVE: Dict[str, Dict[str, Kernel]] = {}
_GUARD = threading.Lock()


def _snapshot_path(session_id: str, key: str) -> str:
    import hashlib
    import os
    from .engine import RESULT_CACHE_DIR, _session_token
    name = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return os.path.join(RESULT_CACHE_DIR, _session_token(session_id), "kernels", f"{name}.json")


def _save(session_id: str, s: Kernel) -> bool:
    """Put a kernel away on disk: its workflow, outputs and all."""
    import json
    import os
    from .core_bridge import save_with_outputs
    if not PERSIST:
        return False
    with s.lock:
        try:
            core, outputs = save_with_outputs(s.k), True
        except Exception as exc:
            # An output core can't save — an image array, a Figure (core asks
            # C29/C30). Save the steps without outputs: restored, they re-run
            # when needed rather than coming back.
            print(f"  kernel '{s.key}': outputs not saved ({exc}); its steps will re-run")
            core, outputs = json.loads(s.k.to_json()), False
        try:
            text = json.dumps({"key": s.key, "declarations": s.declarations,
                               "problems": s.problems, "ids": s.ids,
                               "outputs": outputs, "core": core})
        except (TypeError, ValueError) as exc:
            print(f"  kernel '{s.key}' not saved: {exc}")
            return False
    path = _snapshot_path(session_id, s.key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
    return True


def _restore(session_id: str, key: str, declarations: Dict[str, Any]) -> Optional[Kernel]:
    """A saved kernel, brought back as it was; None when there is none (or it
    was saved with other resources, or core can no longer read it)."""
    import json
    import os
    from .catalog import catalog
    from .core_bridge import restore_with_outputs
    path = _snapshot_path(session_id, key)
    if not PERSIST or not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            blob = json.load(fh)
        if blob.get("key") != key or blob.get("declarations") != declarations:
            return None
        k = (restore_with_outputs(blob["core"], catalog()) if blob.get("outputs")
             else CoreKernel.from_json(json.dumps(blob["core"]), catalog()))
    except Exception as exc:
        print(f"  kernel '{key}' not restored, starting fresh: {exc}")
        return None
    return Kernel(key, k, dict(declarations), problems=blob.get("problems") or {},
                  ids=blob.get("ids") or {})


def _cull_idle(now: float) -> None:
    """Save and free kernels nobody has used for IDLE_SECONDS. Holds _GUARD."""
    for session_id, live in list(_LIVE.items()):
        for key, s in list(live.items()):
            if now - s.last_used > IDLE_SECONDS and s.lock.acquire(blocking=False):
                try:
                    _save(session_id, s)
                    del live[key]
                finally:
                    s.lock.release()
        if not live:
            del _LIVE[session_id]


def _kernel_for(session_id: str, key: str, declarations: Dict[str, Any]) -> Kernel:
    """The live kernel for *key* in this session: kept, restored from disk, or
    new — putting away the least recently used one when the session is full."""
    import time
    from .catalog import catalog
    now = time.monotonic()
    cat = catalog()
    with _GUARD:
        _cull_idle(now)
        live = _LIVE.setdefault(session_id, {})
        s = live.get(key)
        if s is not None and s.declarations != declarations:
            # Resources changed: a kernel is built around its resources.
            del live[key]
            s = None
        if s is not None and s.k.catalog is not cat:
            # A tool was declared since: a kernel's catalog is fixed, so the
            # steps move to a new kernel with the new catalog (outputs aren't kept).
            s.k = CoreKernel.from_json(s.k.to_json(), cat)
        if s is None:
            # Put away the least recently used — never one that's mid-run
            # (the session goes over the cap until it finishes).
            for oldest in sorted(live, key=lambda k: live[k].last_used):
                if len(live) < MAX_LIVE:
                    break
                victim = live[oldest]
                if victim.lock.acquire(blocking=False):
                    try:
                        _save(session_id, victim)
                        del live[oldest]
                    finally:
                        victim.lock.release()
            s = _restore(session_id, key, declarations)
            if s is None:
                s = Kernel(key, CoreKernel(cat), dict(declarations))
                _define_resources(s)
            live[key] = s
        s.last_used = now
        return s


def save_all() -> None:
    """Put every live kernel away (the server is stopping)."""
    with _GUARD:
        for session_id, live in _LIVE.items():
            for s in live.values():
                _save(session_id, s)


def forget(session_id: str) -> None:
    """Drop a session's live kernels, unsaved (tests; a session that ends)."""
    with _GUARD:
        _LIVE.pop(session_id, None)


import atexit as _atexit  # noqa: E402
_atexit.register(save_all)


def _define_resources(s: Kernel) -> None:
    """Every declared resource, defined once — before any step that uses one."""
    from .resources import ResourceError, resolve
    for name, declaration in s.declarations.items():
        try:
            cls, settings = resolve(name, declaration)
            s.k.define(name, cls, **settings)
        except (ResourceError, TypeError) as exc:
            s.problems[f'res["{name}"]'] = str(exc)


# ─────────────────────────────────────────────────────────────────────────────
# Declaring
# ─────────────────────────────────────────────────────────────────────────────

_NOT_LITERAL = object()


def _literal_value(formula: str) -> Any:
    """`=[1, 2]`, `={"x": 1}`, `=7`, `="text"` → the value; else _NOT_LITERAL."""
    import ast
    try:
        return ast.literal_eval(formula[1:].strip())
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return _NOT_LITERAL


def operation_for(formula: str, declarations: Dict[str, Any], cat) -> Operation:
    """A formula in core's syntax → core's operation, for *cat*'s tools.
    Raises :class:`GridStepError` (or the parser's ``FormulaError``) with the reason."""
    from .operation_formula import compile_formula
    from .resources import resource_type

    compiled = compile_formula(formula)
    types: Dict[str, type] = {}
    for name in compiled.resources:
        if name not in declarations:
            known = ", ".join(f'res["{n}"]' for n in declarations) or "none yet"
            raise GridStepError(
                f'no resource named "{name}" in this workflow (its resources: {known}). '
                "Add it to the workflow's resources first"
            )
        types[name] = resource_type(declarations[name], name)
    fn = _formula_tool(compiled, cat.functions, types)
    _bind_positional_resources(compiled, fn, types)
    inferred = None
    if compiled.needs_inference:
        # tool(wf["x"], …) is core's implicit auto: it saves `mod.auto()`, and
        # core picks the verb from the data at each run. With no input, a source.
        if fn is None:
            raise GridStepError(f"no tool named '{compiled.tool_id}'")
        inferred = "source" if compiled.input is None else "auto"
    bound_type = types[compiled.bound_to].__name__ if compiled.bound_to in types else None
    return Operation.from_spec(compiled.operation(inferred, bound_type), cat)


def _declared(s: Kernel, name: str) -> Optional[Any]:
    return s.k.step(name) if name in s.k else None


def sync(s: Kernel, steps: List[Dict[str, Any]]) -> None:
    """Make the kernel's steps match *steps* (``[{id, name, formula}]``, in order).

    An unchanged step is left alone, so its output stays current; a changed
    one is re-declared and core marks it — and what reads it — stale. A step
    the app no longer has is removed; a moved one is moved.
    """
    from .operation_formula import OLD_SYNTAX, FormulaError, is_canonical

    names = [str(step["name"]) for step in steps]
    # Renamed in the app (same id, new name): rename in core, which keeps the
    # step's output — a rename is not a recompute.
    for step in steps:
        sid, name = step.get("id"), str(step["name"])
        old = s.ids.get(sid) if sid else None
        if old and old != name and old in s.k and name not in s.k:
            try:
                s.k.rename(old, name)
            except (KeyError, ValueError):
                continue
            if old in s.problems:
                s.problems[name] = s.problems.pop(old)
    s.ids = {step.get("id"): str(step["name"]) for step in steps if step.get("id")}
    # Gone from the app: remove, last first, so readers go before what they read.
    for name in reversed([st.name for st in s.k.steps]):
        if name not in names:
            try:
                del s.k[name]
            except (KeyError, ValueError):
                continue
            s.problems.pop(name, None)

    for position, step in enumerate(steps):
        name = str(step["name"])
        formula = (step.get("formula") or "").strip()
        if formula and not formula.startswith("="):
            formula = "=" + formula
        s.problems.pop(name, None)
        operation: Any = None                      # the empty step, `k[name] = None`
        if formula and formula != "=":
            literal = _literal_value(formula)
            if literal is not _NOT_LITERAL:
                operation = literal
            elif not is_canonical(formula):
                s.problems[name] = OLD_SYNTAX
            else:
                try:
                    operation = operation_for(formula, s.declarations, s.k.catalog)
                except (FormulaError, GridStepError) as exc:
                    s.problems[name] = str(exc)
        _declare(s, position, name, operation)


def _declare(s: Kernel, position: int, name: str, operation: Any) -> None:
    """Declare *name* at *position*, unless core already has exactly it there."""
    current = _declared(s, name)
    if current is not None:
        same = (current.spec.literal == {"value": operation} if not isinstance(operation, Operation)
                else current.spec.literal is None and current.spec.operation == operation.to_dict())
        if not same or current.state == "invalid":
            s.k[name] = operation                  # re-checked: a read may resolve now
    elif position < len(s.k.steps):
        s.k.insert(position, name, operation)
    else:
        s.k[name] = operation
    order = [st.name for st in s.k.steps]
    if order.index(name) != position and position < len(order):
        s.k.move(name, position)


# ─────────────────────────────────────────────────────────────────────────────
# Running
# ─────────────────────────────────────────────────────────────────────────────

def _upstream(s: Kernel, name: str) -> List[str]:
    """*name* and every step it reads, directly or not."""
    seen: List[str] = []

    def walk(step: str) -> None:
        if step in seen or step not in s.k:
            return
        seen.append(step)
        operation = s.k.step(step).operation
        for read in (operation.reads if operation is not None else ()):
            walk(read)

    walk(name)
    return seen


def summary(s: Kernel) -> Dict[str, dict]:
    """Every step's state, for the UI: core's state, why it's stale, problems."""
    out: Dict[str, dict] = {}
    for step in s.k.steps:
        problems = [str(p) for p in step.problems]
        if step.name in s.problems:
            problems.insert(0, s.problems[step.name])
        out[step.name] = {
            "status": "invalid" if step.name in s.problems else step.state,
            "stale_reason": step.output.stale_reason,
            "problems": problems,
        }
    for name, problem in s.problems.items():
        out.setdefault(name, {"status": "invalid", "stale_reason": None, "problems": [problem]})
    return out


def run_step(session_id: str, key: str, steps: List[Dict[str, Any]], name: str,
             declarations: Optional[Dict[str, Any]],
             live: Callable[[str, Any], Any], store: Callable[[Any], str]) -> Tuple[str, dict]:
    """Run step *name* of the session's workflow. Returns ``(output_ref, metrics)``.

    *store(frame)* saves an output and returns its ref; *live(name, decl)* is a
    resource's live object. Inputs that never ran run first; their refs are
    reported under ``metrics["outputs"]`` so the UI can show them too.
    """
    s = _kernel_for(session_id, key, declarations or {})
    with s.lock:
        sync(s, steps)
        if name in s.problems:
            raise GridStepError(s.problems[name])
        step = _declared(s, name)
        if step is None or (step.literal is None and step.operation is None):
            raise GridStepError(f"step '{name}' has no formula to run")
        if step.problems:
            raise GridStepError("; ".join(str(p) for p in step.problems))

        upstream = _upstream(s, name)
        needed = {r for n in upstream for r in (s.k.step(n).operation.resources
                                                 if s.k.step(n).operation is not None else ())}
        try:
            for res in needed:
                s.k.resources.attach(res, live(res, s.declarations[res]))
        except Exception as exc:
            raise GridStepError(str(exc)) from exc

        before = {n: s.k.step(n).output.version for n in upstream}
        try:
            s.k.run(name)
        except Exception as exc:
            raise GridStepError(str(exc)) from exc
        ran = [n for n in upstream if s.k.step(n).output.version != before[n] or n == name]
        for n in ran:
            output = s.k.step(n).output
            if output.meta.get("verb") == "source" and len(output.failed):
                # One call, so one unit: if it failed there is no output to show.
                raise GridStepError(str(output.failed.iloc[0].get("error", "the tool failed")))
        outputs = {n: store(s.k.step(n).data) for n in ran}

        from .engine import values
        step = s.k.step(name)
        frame = values(step.data)
        metrics = {
            "rows": len(frame),
            "columns": [str(c) for c in frame.columns],
            **_engine_metrics(step.spec.operation, step, step.output),
            "steps": summary(s),
        }
        first = [n for n in reversed(ran) if n != name]
        if first:
            metrics["also_ran"] = first
            metrics["outputs"] = {k: outputs[k] for k in first}
        return outputs[name], metrics


def sync_only(session_id: str, key: str, steps: List[Dict[str, Any]],
              declarations: Optional[Dict[str, Any]],
              store: Optional[Callable[[Any], str]] = None) -> Dict[str, Any]:
    """Declare the app's steps without running anything.

    What the UI calls after an edit (which later steps are now stale?) and
    when a workflow becomes active (its kernel may come back from disk). With
    *store*, a step the kernel has an output for but the UI sent no ref for —
    a reopened workflow — has its output stored, and its ref returned, so the
    UI shows it without anything re-running.

    Returns ``{"steps": every step's state, "outputs": {name: ref}}``.
    """
    s = _kernel_for(session_id, key, declarations or {})
    with s.lock:
        sync(s, steps)
        outputs: Dict[str, str] = {}
        if store is not None:
            for step in steps:
                name = str(step["name"])
                ran = _declared(s, name)
                if step.get("ref") or ran is None or ran.operation is None or name in s.problems:
                    continue
                if ran.state in ("completed", "stale", "failed"):
                    outputs[name] = store(ran.data)
        return {"steps": summary(s), "outputs": outputs}
