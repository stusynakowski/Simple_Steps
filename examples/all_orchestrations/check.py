"""
check.py — run the workflow the way the UI does, and compare with core.

    python examples/all_orchestrations/check.py

1. Starts the app in-process with this folder as the workspace, so
   ``tools.py`` registers the example's tools.
2. Loads each workflow in ``projects/demo/`` through the same endpoint the
   UI's file explorer uses:

   - ``all-orchestrations`` — core's ``run()``: every shape verb;
   - ``resources`` — core's ``run_resources()``: resources, ``res["…"]``;
   - ``rich-cells`` — app only: images, a Plotly figure and tables in cells.
     A rich cell compares as ``<type: summary>``, and its full view
     (``/api/cell``) must open as the right kind.

3. Runs each step as ``useWorkflow.runStep`` does: parse the formula with
   ``/api/parse_formula``, send its arguments to ``/api/run`` with the
   previous step's output as input, a step map keyed by id, label and the
   positional ``stepN`` alias, and the workflow's ``resources`` section.
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


def core_pipeline():
    """Core's example module, from the submodule."""
    sys.path.insert(0, str(CORE_EXAMPLE))
    import pipeline  # core's example module
    return pipeline


def core_outputs() -> dict:
    """Every step of core's own run, as {step: (columns, rows)}."""
    pipeline = core_pipeline()
    wf = pipeline.run()
    out = {sid: _table(step.output.data) for sid, step in wf.steps.items()}
    out["failure"] = len(pipeline.failure().step("out").output.failed)
    return out


def core_resource_outputs() -> dict:
    """Every step of core's resource workflow, run against core's own objects,
    plus the app-only steps core has no counterpart for."""
    wf, _live = core_pipeline().run_resources()
    out = {sid: _table(step.output.data) for sid, step in wf.steps.items()}
    out.update(APP_ONLY)
    return out


#: Steps with no counterpart in core's example, and what they must produce.
#: `house_summaries` uses the workspace's ready-made `house_llm`
#: (FakeLLM(model="house-1"), from tools.py) with the workflow's saved override
#: model="house-2" — so it proves the override is applied when the step runs.
#: Core has no ready-made resources: the app merges the settings and hands
#: core a plain declaration.
APP_ONLY = {
    "house_summaries": (["text", "value"], [["a", "[house-2] A"], ["b", "[house-2] B"]]),
}

_IMG = "<image: 16×16 RGB image>"
_TABLE = "<table: table 1×3>"
#: The rich-cells workflow is app only (core has no cell types). Each rich cell
#: compares as `<type: summary>`. `bright` proves a later step reads the real
#: image array, not its thumbnail: a swatch's mean is (60·n + 0 + 128) / 3.
RICH_CELLS = {
    "readings": (["city", "n"], [["SF", 1], ["NYC", 2], ["SF", 3], ["LA", 2]]),
    "swatches": (["city", "n", "swatch"],
                 [["SF", 1, _IMG], ["NYC", 2, _IMG], ["SF", 3, _IMG], ["LA", 2, _IMG]]),
    "bright": (["city", "n", "swatch", "brightness"],
               [["SF", 1, _IMG, 62.67], ["NYC", 2, _IMG, 82.67], ["SF", 3, _IMG, 102.67],
                ["LA", 2, _IMG, 82.67]]),
    "profiles": (["city", "n", "profile"],
                 [["SF", 1, _TABLE], ["NYC", 2, _TABLE], ["SF", 3, _TABLE], ["LA", 2, _TABLE]]),
    "chart": (["value"], [["<plotly: bar chart · 1 trace · Readings per city>"]]),
}

#: What each rich cell's full view must be.
VIEW_KINDS = {"image": "image", "plotly": "plotly", "table": "table", "json": "json", "text": "text"}


def _table(frame) -> tuple:
    rows = json.loads(frame.to_json(orient="values", default_handler=str))
    return [str(c) for c in frame.columns], rows


def main() -> int:
    with contextlib.redirect_stdout(io.StringIO()):
        from fastapi.testclient import TestClient
        import SIMPLE_STEPS.main as app_main
    client = TestClient(app_main.app)
    client.get("/api/session")

    total = differ = 0
    for pipeline_id, expected, app_only in (
            ("all-orchestrations", core_outputs(), set()),
            ("resources", core_resource_outputs(), set(APP_ONLY)),
            ("rich-cells", RICH_CELLS, set(RICH_CELLS))):
        print(f"── {pipeline_id}")
        n, d = check_workflow(client, pipeline_id, expected, app_only)
        total, differ = total + n, differ + d
        print()

    print(f"{total - differ}/{total} steps match simple-steps-core")
    return 1 if differ else 0


def check_workflow(client, pipeline_id: str, expected: dict,
                   app_only: set = frozenset()) -> tuple[int, int]:
    """Run one saved workflow the way the UI does; return (steps, differing).
    Steps in *app_only* have no counterpart in core and are checked against
    fixed values instead."""
    pipeline = client.get(f"/api/projects/demo/pipelines/{pipeline_id}").json()
    resources = pipeline.get("resources") or None

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
                "resources": resources,
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
            tag = "  (app only)" if sid in app_only else ""
            print(f"{'PASS' if same else 'DIFF'}  {label:14} {formula}{tag}")
            if not same:
                print(f"      core: {expected[sid][0]} {str(expected[sid][1])[:160]}")
                print(f"      app : {got[0]} {str(got[1])[:160]}")
        differ += not same

    return len(pipeline["steps"]), differ


def _cells_to_table(client, ref: str) -> tuple:
    """A step's output as the grid receives it. A rich cell (image, figure,
    table) carries no value, only a summary, so it reads as `<type: summary>` —
    and its full view must open as the matching kind."""
    cells = client.get(f"/api/data/{ref}?limit=1000").json()
    columns, rows = [], {}
    for cell in cells:
        if cell["column_id"] not in columns:
            columns.append(cell["column_id"])
        value = cell["value"]
        if cell.get("cell_type") and not cell.get("value"):
            value = f"<{cell['cell_type']}: {cell['summary']}>"
            view = client.get(f"/api/cell/{ref}",
                              params={"row": cell["row_id"], "column": cell["column_id"]}).json()
            if view.get("view", {}).get("kind") != VIEW_KINDS.get(cell["cell_type"]):
                value += f" (view opened as {view.get('view', {}).get('kind')!r})"
        rows.setdefault(cell["row_id"], {})[cell["column_id"]] = value
    return columns, [[row.get(c) for c in columns] for _, row in sorted(rows.items())]


def _norm(value):
    """Tuples come back from JSON as lists."""
    return json.loads(json.dumps(value, default=str))


if __name__ == "__main__":
    sys.exit(main())
