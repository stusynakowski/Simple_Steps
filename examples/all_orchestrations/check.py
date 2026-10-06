"""
check.py — run the workflow the way the UI does, and compare with core.

    python examples/all_orchestrations/check.py

1. Starts the app in-process with this folder as the workspace, so
   ``tools.py`` registers the example's tools.
2. Loads ``projects/demo/all-orchestrations.simple-steps-workflow`` through
   the same endpoint the UI's file explorer uses.
3. Runs each step as ``useWorkflow.runStep`` does: parse the formula with
   ``/api/parse_formula``, send its arguments to ``/api/run`` with the
   previous step's output as input and a step map keyed by id, label and the
   positional ``stepN`` alias.
4. Compares every step's output with simple-steps-core's own run of
   ``examples/all_orchestrations/pipeline.py`` (from the submodule).

Exits non-zero if any step differs from core.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
CORE_EXAMPLE = REPO / "external" / "simple-steps-core" / "examples" / "all_orchestrations"

os.environ["SIMPLE_STEPS_WORKSPACE"] = str(HERE)
os.environ.setdefault("SIMPLE_STEPS_ENGINE", "grid")


def core_outputs() -> dict:
    """Every step of core's own run, as {step: (columns, rows)}."""
    sys.path.insert(0, str(CORE_EXAMPLE))
    import pipeline  # core's example module

    wf = pipeline.run()
    out = {sid: _table(step.output.data) for sid, step in wf.steps.items()}
    out["failure"] = len(pipeline.failure().step("out").output.failed)
    return out


def _table(frame) -> tuple:
    rows = json.loads(frame.to_json(orient="values", default_handler=str))
    return [str(c) for c in frame.columns], rows


def main() -> int:
    with contextlib.redirect_stdout(io.StringIO()):
        from fastapi.testclient import TestClient
        import SIMPLE_STEPS.main as app_main
    client = TestClient(app_main.app)
    client.get("/api/session")

    pipeline = client.get("/api/projects/demo/pipelines/all-orchestrations").json()
    expected = core_outputs()

    refs: dict[str, str] = {}      # step id -> output ref
    order: list[str] = []
    previous_ref = None
    differ = 0
    for index, step in enumerate(pipeline["steps"]):
        sid, label = step["name"], step["meta"].get("label", step["name"])
        formula = "=" + step["expression"]
        parsed = client.post("/api/parse_formula", json={"formula": formula}).json()

        # The step map the UI sends: id, label and positional alias per step.
        step_map = {}
        for i, done in enumerate(order):
            step_map[done] = refs[done]
            step_map[f"step{i + 1}"] = refs[done]

        with contextlib.redirect_stdout(io.StringIO()):
            r = client.post("/api/run", json={
                "step_id": sid, "operation_id": parsed["operationId"],
                "config": parsed["args"], "input_ref_id": previous_ref,
                "step_map": step_map, "formula": formula,
            })
        if r.status_code != 200:
            print(f"FAIL  {label:14} {formula}\n      {r.json().get('detail', '')[:200]}")
            differ += 1
            continue
        body = r.json()
        refs[sid] = previous_ref = body["output_ref_id"]
        order.append(sid)

        if sid == "failure":
            got = body["metrics"].get("failed")
            same = got == expected["failure"]
            print(f"{'PASS' if same else 'DIFF'}  {label:14} {got} rows failed "
                  f"(core: {expected['failure']}) — "
                  f"{(body['metrics'].get('errors') or [{}])[0].get('error', '')}")
        else:
            got = _cells_to_table(client, refs[sid])
            same = got[0] == expected[sid][0] and _norm(got[1]) == _norm(expected[sid][1])
            print(f"{'PASS' if same else 'DIFF'}  {label:14} {formula}")
            if not same:
                print(f"      core: {expected[sid][0]} {str(expected[sid][1])[:160]}")
                print(f"      app : {got[0]} {str(got[1])[:160]}")
        differ += not same

    total = len(pipeline["steps"])
    print(f"\n{total - differ}/{total} steps match simple-steps-core")
    return 1 if differ else 0


def _cells_to_table(client, ref: str) -> tuple:
    cells = client.get(f"/api/data/{ref}?limit=1000").json()
    columns, rows = [], {}
    for cell in cells:
        if cell["column_id"] not in columns:
            columns.append(cell["column_id"])
        rows.setdefault(cell["row_id"], {})[cell["column_id"]] = cell["value"]
    return columns, [[row.get(c) for c in columns] for _, row in sorted(rows.items())]


def _norm(value):
    """Tuples come back from JSON as lists."""
    return json.loads(json.dumps(value, default=str))


if __name__ == "__main__":
    sys.exit(main())
