"""
Switch a step to every tool of an app, the way the step editor does, and run it.

    python tests/fixtures/switch_sweep.py <app.py>

Prints one JSON object: ``{"ran": n, "refused": n, "internal": [...]}``.
``internal`` lists every switch whose run raised an internal error
(``KeyError``, ``AttributeError``, …) instead of a message — REQ-FORM-006
wants it empty. A run that fails with a reason (a missing column, a missing
argument) is fine: that is the message the user sees.

Its own process, because one process serves one App (``application.py``).
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
from pathlib import Path

app_path = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(app_path.parent))

from SIMPLE_STEPS.example_check import SESSION, Example  # noqa: E402

with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    Example(app_path)

from SIMPLE_STEPS.decorators import OPERATION_REGISTRY  # noqa: E402
from SIMPLE_STEPS.engine import run_operation  # noqa: E402
from SIMPLE_STEPS.operation_formula import describe, format_parts  # noqa: E402

#: What an internal error looks like: a bug in the app or core, not a reason.
INTERNAL = (KeyError, AttributeError, IndexError, NameError, UnboundLocalError, AssertionError)

refs: dict = {}


def run(name: str, formula: str) -> None:
    parsed = describe(formula)
    assert parsed["isValid"], (formula, parsed.get("error"))
    with contextlib.redirect_stdout(io.StringIO()):
        ref, _ = run_operation(formula, step_id=name, session_id=SESSION, step_map=dict(refs))
    refs[name] = ref


def root(exc: BaseException) -> BaseException:
    while exc.__cause__ is not None:
        exc = exc.__cause__
    return exc


# Upstream steps of different shapes: one column, several typed columns, a
# mapped column.
run("nums", '=make_range[mod.source()](n=5)')
run("people", '=sample_people[mod.source()](count=4)')
run("scored", '=scale[mod.map(name="score")](wf["nums"])')

# The editor's partsForTool + autoForWiring (frontend/src/utils/formulaParts.ts).
tools = sorted((k, v.get("type")) for k, v in OPERATION_REGISTRY.items()
               if v.get("type") not in ("verb", "orchestrator"))
ran = refused = 0
internal = []
for upstream in ("nums", "people", "scored"):
    for tool, kind in tools:
        source = kind == "source"
        parts = {"tool": tool, "bound_to": None,
                 "modifiers": [{"kind": "source" if source else "auto", "params": {}}],
                 "input": None if source else upstream,
                 "resources": [], "arguments": {}, "inputs": []}
        formula = "=" + format_parts(parts)       # REQ-FORM-006: always compiles
        try:
            run("switched", formula)
            ran += 1
        except Exception as exc:                   # noqa: BLE001 — classifying it is the point
            if isinstance(root(exc), INTERNAL):
                internal.append({"formula": formula, "error": f"{type(root(exc)).__name__}: {exc}"})
            else:
                refused += 1

print(json.dumps({"ran": ran, "refused": refused, "internal": internal}))
