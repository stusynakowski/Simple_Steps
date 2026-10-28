"""
example_check.py — run a saved workflow the way the UI does, and check it.

The examples' ``runme.py`` scripts are built on this. For each saved workflow
(``workspace/projects/<project>/<name>.simple-steps-workflow``) it:

1. runs every step the way the UI's Run does — the whole workflow and its
   ``resources`` section with each request — through the same
   ``engine.run_operation`` that ``/api/run`` calls;
2. runs the same workflow written in Python (its *twin*: one line per step,
   in core's syntax) directly in ``simple_steps_core``, step by step;
3. compares every step's output between the two, and checks any explicit
   expectations, so a bug both share can't pass unnoticed.

A typical ``runme.py``::

    from SIMPLE_STEPS.example_check import Example

    example = Example(HERE / "app.py")       # imports the app: its tools, resources
    import pipeline                          # the twin, written against those tools

    example.check("basic", "all-orchestrations", twin=pipeline.build,
                  expect={"n_rows": {"value": [4]}})
    sys.exit(example.finish())

One process serves one App (``application.py``), so an :class:`Example` is
built once per process, before anything imports ``SIMPLE_STEPS.main``.
"""

from __future__ import annotations

import contextlib
import io
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Union

import numpy as np
import pandas as pd

#: The session every check runs in, so live resources are built once per run.
SESSION = "example-check"

#: What an expectation can be: ``{column: [values]}``, or a function of the
#: step's output and metrics that returns True, or a string saying what's wrong.
Expectation = Union[Mapping[str, List[Any]], Callable[[pd.DataFrame, dict], Union[bool, str]]]


@dataclass
class StepRun:
    """One step of a saved workflow, as the app ran it."""

    name: str
    expression: str
    data: Optional[pd.DataFrame] = None     # the output, as a table
    metrics: dict = field(default_factory=dict)
    error: Optional[str] = None             # set when the run refused or failed


class Example:
    """The app an example's workflows run in, and the tally of its checks."""

    def __init__(self, app_path: Union[str, Path]):
        from .application import _configure_environment, load_app_file

        self.app = load_app_file(str(app_path))
        _configure_environment(self.app)
        with contextlib.redirect_stdout(io.StringIO()):
            import SIMPLE_STEPS.main  # noqa: F401  — configures the server for this App
        # Checks are throwaway: don't save their workflows' kernels to disk.
        from . import kernels
        kernels.PERSIST = False
        self.workspace = Path(self.app.workspace)
        self.passed = self.failed = self.skipped = 0

    # ── what the app offers ──────────────────────────────────────────────

    @staticmethod
    def tools() -> Dict[str, Callable]:
        """The app's tools as core's tools dict — what a twin runs with."""
        from .grid_runner import _tools
        return _tools()

    def workflow(self, project: str, name: str) -> dict:
        """A saved workflow file from this example's workspace."""
        path = self.workspace / "projects" / project / f"{name}.simple-steps-workflow"
        return json.loads(path.read_text())

    # ── running ──────────────────────────────────────────────────────────

    def run_saved(self, project: str, name: str) -> Dict[str, StepRun]:
        """Every step of a saved workflow, run the way the UI runs it."""
        from .engine import get_value, run_operation

        saved = self.workflow(project, name)
        resources = saved.get("resources") or None
        runs: Dict[str, StepRun] = {}
        refs: Dict[str, str] = {}
        # Like the UI: every request carries the whole workflow, so its steps
        # run in the workflow's kernel (kernels.py).
        key = f"{project}/{name}"
        for step in saved["steps"]:
            name_, expression = step["name"], step["expression"]
            run = runs[name_] = StepRun(name_, expression)
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    ref, run.metrics = run_operation(
                        "=" + expression, step_id=name_, session_id=SESSION,
                        resources=resources, workflow_key=key,
                        workflow_steps=[{"name": s["name"], "formula": "=" + s["expression"],
                                         "ref": refs.get(s["name"])} for s in saved["steps"]],
                    )
            except Exception as exc:          # the step refused or failed: say why
                run.error = str(exc)
                continue
            refs[name_] = ref
            run.data = as_table(get_value(ref, session_id=SESSION))
        return runs

    def run_twin(self, workflow, live: Optional[dict] = None) -> Dict[str, pd.DataFrame]:
        """Every step of a twin (a declared ``grid.Workflow``), run one at a
        time in order, as the UI runs them — so a step with failed rows doesn't
        stop the steps after it."""
        tools = self.tools()
        out: Dict[str, pd.DataFrame] = {}
        for sid in workflow.steps:
            workflow.run(sid, tools, resources=live or {})
            out[sid] = workflow.step(sid).output.data
        return out

    # ── checking ─────────────────────────────────────────────────────────

    def check(self, project: str, name: str, *,
              twin: Optional[Callable[[], Any]] = None,
              live: Optional[Callable[[], dict]] = None,
              expect: Optional[Mapping[str, Expectation]] = None,
              skip: Optional[Callable[[], Optional[str]]] = None,
              strict: bool = False) -> bool:
        """Run one saved workflow and check every step.

        *twin* builds the same workflow in Python (declared, not run); each
        step's output must match the app's. *live* returns the resource
        objects the twin runs with. *expect* adds explicit checks per step —
        including :func:`refused`, :func:`warns` and :func:`fails` for a step
        that is meant to go wrong. *skip* returns a reason to skip the whole
        workflow, or None. With *strict*, a step that warns or has failed rows
        nothing caught fails, unless *expect* says it should.
        """
        print(f"── {project}/{name}")
        reason = skip() if skip else None
        if reason:
            print(f"SKIP  {reason}\n")
            self.skipped += 1
            return True

        runs = self.run_saved(project, name)
        python = self.run_twin(twin(), live() if live else None) if twin else {}
        missing = set(python) - set(runs) if twin else set()
        expect = dict(expect or {})
        ok = True
        for sid, run in runs.items():
            wanted = expect.pop(sid, None)
            problems, note = [], None
            if isinstance(wanted, Refused):
                if run.error is None:
                    problems.append(f"expected it to be refused ({wanted.says!r}); it ran")
                elif wanted.says not in run.error:
                    problems.append(f"refused, but saying {run.error[:300]!r}, not {wanted.says!r}")
                else:
                    note = f"refused: {_message(run.error)}"
            elif run.error:
                problems.append(f"the app refused it: {run.error[:300]}")
            else:
                if twin:
                    if sid not in python:
                        problems.append("the Python twin has no step with this name")
                    else:
                        problems += _differences(run.data, python[sid])
                if isinstance(wanted, (Warns, Fails)):
                    found = wanted.found(run.metrics)
                    if found is None:
                        problems.append(f"expected it to {wanted.verb} ({wanted.says!r}); "
                                        f"{wanted.instead(run.metrics)}")
                    else:
                        note = f"{wanted.past}: {found}"
                elif wanted is not None:
                    problems += _unmet(wanted, run)
                if strict and not isinstance(wanted, (Warns, Fails)):
                    problems += _not_clean(run.metrics)
            self._report(run, problems, note)
            ok &= not problems
        for sid in sorted(missing):
            self._report(StepRun(sid, "(only in the Python twin)"), ["the saved workflow has no such step"])
            ok = False
        for sid in sorted(expect):
            self._report(StepRun(sid, "(expected)"), ["the saved workflow has no such step"])
            ok = False
        print()
        return ok

    def _report(self, run: StepRun, problems: List[str], note: Optional[str] = None) -> None:
        if problems:
            self.failed += 1
            print(f"FAIL  {run.name:16} {run.expression}")
            for problem in problems:
                print(f"      {problem}")
        else:
            self.passed += 1
            print(f"PASS  {run.name:16} {run.expression}")
            if note:
                print(f"      → {note}")

    def finish(self) -> int:
        """Print the tally; the exit code is 1 if any step failed."""
        total = self.passed + self.failed
        skipped = f", {self.skipped} workflow(s) skipped" if self.skipped else ""
        print(f"{self.passed}/{total} steps as expected{skipped}")
        return 1 if self.failed else 0


# ─────────────────────────────────────────────────────────────────────────────
# Steps that are meant to go wrong
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Refused:
    """The step can't run, and the app's reason contains *says*."""
    says: str


@dataclass(frozen=True)
class Warns:
    """The step runs, and one of core's warnings contains *says*."""
    says: str
    verb = "warn"
    past = "warned"

    def found(self, metrics: dict) -> Optional[str]:
        return next((w for w in metrics.get("warnings") or [] if self.says in w), None)

    def instead(self, metrics: dict) -> str:
        return f"its warnings were {metrics.get('warnings') or 'none'}"


@dataclass(frozen=True)
class Fails:
    """The step runs, rows fail, nothing catches them, and a row's error
    contains *says*."""
    says: str
    verb = "fail rows"
    past = "rows failed"

    def found(self, metrics: dict) -> Optional[str]:
        if not metrics.get("uncaught_failed"):
            return None
        errors = [e.get("error", "") for e in metrics.get("errors") or []]
        hit = next((e for e in errors if self.says in e), None)
        return None if hit is None else f"{metrics['uncaught_failed']} uncaught, {hit}"

    def instead(self, metrics: dict) -> str:
        errors = [e.get("error") for e in metrics.get("errors") or []]
        return f"{metrics.get('uncaught_failed', 0)} uncaught failed rows, errors {errors or 'none'}"


def refused(says: str) -> Refused:
    """Expect the step to be refused, saying *says*."""
    return Refused(says)


def warns(says: str) -> Warns:
    """Expect the step to run with a warning saying *says*."""
    return Warns(says)


def fails(says: str) -> Fails:
    """Expect the step to run with failed rows nothing caught, one saying *says*."""
    return Fails(says)


def _not_clean(metrics: dict) -> List[str]:
    """What makes a run not clean: a warning, or a failed row nothing caught."""
    problems = [f"unexpected warning: {w}" for w in metrics.get("warnings") or []]
    if metrics.get("uncaught_failed"):
        errors = [e.get("error") for e in metrics.get("errors") or []]
        problems.append(f"{metrics['uncaught_failed']} failed rows nothing caught: {errors}")
    return problems


def _message(error: str) -> str:
    """The app's reason, without the prefix the engine adds
    (``Error executing step: …`` or ``Error executing step <tool>: …``)."""
    match = re.match(r"Error executing step(?: \S+)?: ", error)
    return error[match.end():] if match else error


# ─────────────────────────────────────────────────────────────────────────────
# Comparing outputs
# ─────────────────────────────────────────────────────────────────────────────

def as_table(value: Any) -> pd.DataFrame:
    """A step's output as a table: a DataFrame as it is, any other value
    (a list, a dict, a number) as core holds it — one cell."""
    if isinstance(value, pd.DataFrame):
        return value
    from simple_steps_core import grid
    return grid.grid(value).data


def _differences(app: pd.DataFrame, python: pd.DataFrame) -> List[str]:
    """How the app's output differs from the twin's, or [] if it doesn't."""
    app, python = app.reset_index(drop=True), python.reset_index(drop=True)
    if [str(c) for c in app.columns] != [str(c) for c in python.columns]:
        return [f"columns: app {list(app.columns)}, Python {list(python.columns)}"]
    if len(app) != len(python):
        return [f"rows: app {len(app)}, Python {len(python)}"]
    for column in app.columns:
        for i, (a, b) in enumerate(zip(app[column], python[column])):
            if not same(a, b):
                return [f"{column}[{i}]: app {_short(a)}, Python {_short(b)}"]
    return []


def _unmet(expectation: Expectation, run: StepRun) -> List[str]:
    """What an expectation finds wrong with a step's output, or []."""
    if callable(expectation):
        verdict = expectation(run.data, run.metrics)
        if verdict is True:
            return []
        return [f"expected: {verdict if isinstance(verdict, str) else 'check failed'}"]
    problems = []
    for column, values in expectation.items():
        if column not in run.data.columns:
            problems.append(f"expected a column {column!r}; it has {list(run.data.columns)}")
        elif not same(list(run.data[column]), list(values)):
            problems.append(f"expected {column} = {_short(list(values))}, got {_short(list(run.data[column]))}")
    return problems


def same(a: Any, b: Any) -> bool:
    """Whether two cell values are the same result: missing values (None, NaN,
    pd.NA) match each other, floats match within rounding, arrays, tables and
    Plotly figures by content, and a tuple matches the list JSON makes of it."""
    if _missing(a) or _missing(b):
        return _missing(a) and _missing(b)
    if isinstance(a, np.ndarray) or isinstance(b, np.ndarray):
        return np.array_equal(np.asarray(a), np.asarray(b))
    if isinstance(a, pd.DataFrame) or isinstance(b, pd.DataFrame):
        return (isinstance(a, pd.DataFrame) and isinstance(b, pd.DataFrame)
                and not _differences(a, b))
    if hasattr(a, "to_plotly_json") or hasattr(b, "to_plotly_json"):
        return (hasattr(a, "to_json") and hasattr(b, "to_json")
                and json.loads(a.to_json()) == json.loads(b.to_json()))
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, (float, np.floating)) or isinstance(b, (float, np.floating)):
        try:
            return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-12)
        except (TypeError, ValueError):
            return False
    return bool(a == b)


def _missing(value: Any) -> bool:
    if value is None or value is pd.NA or value is pd.NaT:
        return True
    return isinstance(value, (float, np.floating)) and math.isnan(value)


def _short(value: Any) -> str:
    text = repr(value)
    return text if len(text) <= 120 else text[:117] + "..."
