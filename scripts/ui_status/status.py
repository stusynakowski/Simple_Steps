"""
status.py — where each formula-UI item in docs/dev_plan/126 stands, measured.

    python scripts/ui_status/status.py

Three kinds of line:

    OPEN     the problem is still there (measured below)
    CHANGED  what was measured is gone: confirm it in the browser, then mark
             the item done in 126
    CORE     core does what the decision relies on (run, not read)

Checks of the frontend look for the code that causes the problem, so CHANGED
means "that code moved", not "fixed": the workflows in projects/ui_status/
are where you confirm it by hand (each step's notes say what to try).
Exits 0 always: this is a report, not a test.
"""

import asyncio
import contextlib
import io
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
FRONTEND = REPO / "frontend" / "src"

from SIMPLE_STEPS.example_check import SESSION, Example  # noqa: E402

example = Example(HERE / "app.py")

from simple_steps_core import Kernel  # noqa: E402
from SIMPLE_STEPS.engine import run_operation  # noqa: E402
from SIMPLE_STEPS.kernels import operation_for  # noqa: E402
from SIMPLE_STEPS.operation_formula import FormulaError, compile_formula  # noqa: E402

results = []


def report(item, ok, open_text, done_text, kind="OPEN"):
    """One line: *ok* False means the problem is still there."""
    results.append((item, ("CHANGED" if ok else kind) if kind == "OPEN" else kind,
                 done_text if ok else open_text))


def source(rel):
    return (FRONTEND / rel).read_text()


def parses(formula):
    try:
        compile_formula(formula)
        return True, ""
    except FormulaError as e:
        return False, str(e).split(". ")[0]


def core_kernel(name):
    """The saved workflow in a plain core kernel, every step run."""
    cat = example.catalog()
    k = Kernel(cat)
    for s in example.workflow("ui_status", name)["steps"]:
        k[s["name"]] = operation_for(s["expression"], {}, cat) if s["expression"] else None
    for s in example.workflow("ui_status", name)["steps"]:
        with contextlib.suppress(Exception):
            k.run(s["name"])
    return k


def app_refs(name):
    """The saved workflow run the way the UI runs it: each step's output ref."""
    saved = example.workflow("ui_status", name)
    steps = [{"name": s["name"], "formula": "=" + s["expression"]} for s in saved["steps"]]
    refs = {}
    for s in saved["steps"]:
        if not s["expression"]:
            continue
        with contextlib.redirect_stdout(io.StringIO()), contextlib.suppress(Exception):
            refs[s["name"]], _ = run_operation(
                "=" + s["expression"], step_id=s["name"], session_id=SESSION,
                workflow_key=f"ui_status/{name}", workflow_steps=steps)
    return refs


def view_cells(name, step):
    """What the grid draws for *step*: /api/view, from the kernel app_refs ran it in."""
    from SIMPLE_STEPS.main import get_step_view
    try:
        return asyncio.run(get_step_view(f"ui_status/{name}", step, session_id=SESSION))["cells"]
    except Exception:
        return []


# ── Writing a formula ─────────────────────────────────────────────────────

toolbar = source("components/StepToolbar.tsx")
ok, why = parses('=is_big.map(wf["readings"])')
report("F1  autocomplete writes a formula that parses",
       "`.${op.type}`" not in toolbar,
       f"StepToolbar writes =tool.type( ; the parser: {why}",
       "StepToolbar no longer builds =tool.type( ; pick a tool in 01/pick_a_tool")

column = source("components/OperationColumn.tsx")
report("R1  the panel follows the bar without Enter",
       "savedFormula !== lastTyped.current" not in column,
       "OperationColumn skips the bar's own edits (lastTyped guard); the panel waits for Enter",
       "the lastTyped guard is gone; try 01/doubled")

enter = re.search(r"onEnter=\{\(\) => \{(.*?)\}\}", toolbar, re.S)
report("D3  Enter declares; Cmd/Ctrl+Enter runs",
       not (enter and "onRun" in enter.group(1)),
       "Enter calls onRun: it runs the step",
       "Enter no longer calls onRun; try 01/doubled")

editor = source("components/ToolEditor.tsx")
report("D4  the panel freezes on a formula that doesn't parse",
       not re.search(r"if \(!p\.isValid\) \{ setWarning\([^;]*\); return; \}", editor),
       "ToolEditor keeps the last parsed parts editable under a warning",
       "ToolEditor's invalid branch changed; try 01/doubled with a stray (")

monaco = source("shell/monacoSetup.ts")
report("F3  highlighting knows wf[\"x\"]",
       bool(re.search(r"wf\\?\[", monaco)),
       "monacoSetup colours only step1.col",
       "monacoSetup mentions wf[ ; look at any formula")

# ── References and selection ──────────────────────────────────────────────

for item, formula in [("D1  parser: a column as an argument", 'double[mod.map()](wf["readings"], n=wf["readings"][cols["n"]])'),
                      ("D1  parser: a selection as a step", 'wf["readings"][0:2][cols["n"]]'),
                      ("D1  parser: rows", 'wf["readings"][1:3]'),
                      ("D1  parser: a cell as an argument", 'double[mod.map()](wf["readings"], n=wf["readings"][0][cols["n"]])'),
                      ("F11 parser: wf[0]", 'double[mod.map()](wf[0])')]:
    ok, why = parses(formula)
    report(item, ok, f"refused: {why}", f"parses: {formula}")

selection = source("utils/selection.ts")
report("D1  picks write core's notation, no select step",
       "identity[mod." not in selection,
       "selection.ts writes identity[mod.select/slice] select steps",
       "selection.ts no longer writes select steps; try 03/reader")

grid = source("components/DataOutputGrid.tsx")
report("R7  cells can be picked while writing a formula",
       not re.search(r"if \(wiringMode\) return;\s*// single cells", grid),
       "DataOutputGrid ignores cell clicks while a formula has focus",
       "the cell-click guard is gone; try 03/reader")

report("R9  the index column is named #",
       ">\n          #\n        </div>" in grid,
       "the index header reads 'index'",
       "the header reads '#' (its values are R9 below)")

# ── Cell states and staged shape ──────────────────────────────────────────

cells = core_kernel("02-cell-states")
states = [r["cells"]["value"]["state"] for r in cells.view("doubled")["rows"]]
report("R5  core: per-cell states", True, "", f"doubled: {states}", kind="CORE")
absent = [r["cells"]["extra"]["state"] for r in cells.view("stacked")["rows"]]
report("D7  core: absent cells", "absent" in absent, "", f"stacked.extra: {absent}", kind="CORE")
empty = cells.step("empty_step")
report("D7  core: the empty step", True, "",
       f"state {empty.state!r}, cell {cells.view('empty_step')['rows'][0]['cells']}"
       " (rule 9 says one 'empty' cell)", kind="CORE")

staged = Kernel(example.catalog())
for s in example.workflow("ui_status", "02-cell-states")["steps"][:2]:
    staged[s["name"]] = operation_for(s["expression"], {}, example.catalog())
staged.run("readings")
plan = staged.step("doubled").plan
report("R6  core: a staged step's planned shape", True, "",
       f"rows {plan.get('rows')}, types {plan.get('types')}", kind="CORE")

app_refs("02-cell-states")
sent = view_cells("02-cell-states", "doubled")
report("R5  the grid's cells carry core's state",
       bool(sent) and all(c.get("state") for c in sent),
       f"cells carry {sorted(sent[0]) if sent else 'nothing'}: no state",
       f"doubled: {[c['state'] for c in sent]}; look at 02-cell-states")

from SIMPLE_STEPS.main import app as server  # noqa: E402
paths = {getattr(r, "path", "") for r in server.routes}
report("R6  an endpoint serves core's view / plan",
       "/api/view" in paths,
       "no /api route calls k.view or reads step.plan",
       "/api/view exists (kernels.view); declare 02/staged without running: pending cells under a typed header")

report("F12 staged cells carry no formula text",
       "↳" not in source("hooks/useStagedPreview.ts"),
       "useStagedPreview writes '↳ <ref>' into staged cells",
       "no '↳' in useStagedPreview; declare 02/staged")

# ── Lineage and the index ─────────────────────────────────────────────────

lineage = core_kernel("04-lineage")
for step in ["filtered", "sorted", "distinct_wards", "split", "per_ward", "stacked", "chain_split"]:
    d = lineage.step(step).data
    hashes = [c for c in d.columns if str(c).startswith("#")]
    report(f"D8  core: {step}", True, "", f"# = {list(d.index)[:6]}, lineage columns {hashes or 'none'}", kind="CORE")

app_refs("04-lineage")
sent = view_cells("04-lineage", "sorted")
shown = list(dict.fromkeys(c.get("id", c["row_id"]) for c in sent))
ids = list(lineage.step("sorted").data.index)
report("R9  the grid's index is core's #, not the position",
       bool(sent) and shown == ids,
       f"the grid's row ids = {shown}; core's # = {ids}",
       f"the grid's row ids = {shown} = core's #")

# ── Report ────────────────────────────────────────────────────────────────

width = max(len(r[0]) for r in results)
for kind in ("OPEN", "CHANGED", "CORE"):
    for item, k, text in results:
        if k == kind:
            print(f"{k:8} {item:{width}}  {text}")
counts = {k: sum(1 for r in results if r[1] == k) for k in ("OPEN", "CHANGED", "CORE")}
print(f"\n{counts['OPEN']} open, {counts['CHANGED']} changed (confirm in the browser), "
      f"{counts['CORE']} core facts. Plan: docs/dev_plan/126-formula-ui.md")
