"""
core_asks.py — check every open ask in docs/core-proposals/005-core-changes.md
against the installed simple-steps-core.

    python scripts/core_asks.py

Each ask prints OPEN (core still behaves as the proposal describes) or DONE
(the probe now gets the asked-for behaviour), with what it observed. Rerun it
after changing core: an ask is finished when its line says DONE.

The probes run core directly, not through the app, so a result here is
core's behaviour and nothing else.
"""

from __future__ import annotations

import inspect
import json
import subprocess
import sys
from pathlib import Path
from typing import Callable

import pandas as pd
from simple_steps_core import grid
from simple_steps_core.grid import mod, op, tool

I = op("identity")


# ── The example's tools, so probes read like the docs ─────────────────────────
@tool
def scale(n, weight=1):
    return n * 10 * weight


@tool
def add_n(acc, n):
    return (acc or 0) + n


@tool
def grid_cell(model, window):
    return f"{model}:{window}"


@tool
def to_rows(data: str) -> pd.DataFrame:
    return pd.DataFrame(json.loads(data))


@tool
def piv(df: pd.DataFrame) -> pd.DataFrame:
    return df.groupby("city", as_index=False)["n"].sum()


def readings() -> pd.DataFrame:
    return pd.DataFrame({"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]})


DATA = json.dumps({"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]})


def _wf() -> grid.Workflow:
    wf = grid.Workflow()
    wf["readings"] = readings()
    return wf


def _try(fn: Callable):
    try:
        return fn(), None
    except Exception as exc:  # the probes report exceptions, never raise them
        return None, f"{type(exc).__name__}: {exc}"


# ── Probes: each returns (done, observed) ──────────────────────────────────────

def k1_unrun_source_columns():
    wf = grid.Workflow()
    wf["readings"] = to_rows.bind(data=DATA)[mod.source()]
    wf["scored"] = scale[mod.map(name="score")](wf["readings"])
    wf["picked"] = mod.select(over=wf["scored"], columns=["city", "score"])
    declared = wf.step("picked").status
    wf.run_all()
    got = wf.step("picked").output.data.to_dict("list")
    done = got == {"city": ["SF", "NYC", "SF", "LA"], "score": [10, 20, 30, 20]}
    return done, f"declared {declared}; after run_all -> {got}"


def k2_inference_run_state():
    a = _wf()
    a["x"] = add_n(a["readings"])
    b = grid.Workflow()
    b["readings"] = to_rows.bind(data=DATA)[mod.source()]
    b["x"] = add_n(b["readings"])
    va = a.steps["x"].operation.to_dict()["modifiers"][-1]["kind"]
    vb = b.steps["x"].operation.to_dict()["modifiers"][-1]["kind"]
    return va == vb, f"with data: {va}; before a tool-backed source runs: {vb}"


def k3_operation_as_input():
    wf = _wf()
    inner = I[mod.select(columns=["n"])](wf["readings"])
    built, err = _try(lambda: scale[mod.map()](inner))
    if err:
        return True, f"refused: {err[:120]}"
    wf["x"] = built
    wf.run("x")
    return False, (f"accepted; ran as {wf.steps['x'].operation.to_dict()['modifiers'][-1]['kind']}, "
                   f"status {wf.step('x').status}, data {wf.step('x').output.data.to_dict('list')}")


def k4_over_twice():
    wf = _wf()
    wf["other"] = pd.DataFrame({"n": [5]})
    built, err = _try(lambda: scale[mod.map(over=wf["readings"])](wf["other"]))
    if err:
        return True, f"refused: {err[:120]}"
    wf["x"] = built
    return False, f"accepted; over = {wf.steps['x'].operation.to_dict()['modifiers'][-1]['params']['over']!r} (the call won)"


def k5_string_over():
    wf = _wf()
    built, err = _try(lambda: mod.map(over="readings"))
    as_source = scale[mod.map()]("readings")
    source_kind = type(as_source).__name__
    if err:
        return True, f"mod.map(over='readings') refused: {err[:100]}"
    wf["x"] = scale[built]
    return False, (f"mod.map(over='readings') -> reference to step {wf.steps['x'].operation.to_dict()['modifiers'][-1]['params']['over']!r}; "
                   f"scale[mod.map()]('readings') -> {source_kind} (the string as data)")


def k6_source_call_form():
    built, err = _try(lambda: to_rows[mod.source()](data=DATA))
    if err:
        return False, f"to_rows[mod.source()](data=…) -> {err[:110]}"
    return isinstance(built, grid.Operation), f"-> {type(built).__name__}"


def k7_sweep_call_form():
    built, err = _try(lambda: grid_cell[mod.sweep(model=["a"], window=[7])]())
    if err:
        return False, f"grid_cell[mod.sweep(…)]() -> {err[:110]}"
    return isinstance(built, grid.Operation), f"-> {type(built).__name__} (a DataFrame means it ran instead of declaring)"


def k8_modifier_callable():
    wf = _wf()
    built, err = _try(lambda: mod.select(columns=["n"])(wf["readings"]))
    if err:
        return False, f"mod.select(columns=['n'])(wf['readings']) -> {err[:100]}"
    return True, f"-> {type(built).__name__}"


def k9_select_rows_and_columns():
    wf = _wf()
    built, err = _try(lambda: I[mod.select(columns=["n"], rows=[0, 2])](wf["readings"]))
    if err:
        return False, f"select(columns=…, rows=…) -> {err[:110]}"
    wf["x"] = built
    if wf.step("x").problems:
        return False, f"select(columns=…, rows=…) invalid: {wf.step('x').problems}"
    wf.run("x")
    got = wf.step("x").output.data.to_dict("list")
    return got == {"n": [1, 3]}, f"-> {got}"


def k10_value_from_step():
    wf = _wf()
    wf["params"] = 2
    built, err = _try(lambda: scale[mod.map()](wf["readings"], weight=wf["params"]))
    if err:
        return False, f"weight=wf['params'] -> {err[:110]}"
    wf["x"] = built
    wf.run_all()
    got = wf.step("x").output.data.get("value")
    return got is not None and list(got) == [20, 40, 60, 40], f"-> {None if got is None else list(got)}"


def k11_multi_input():
    wf = _wf()
    wf["other"] = pd.DataFrame({"n": [5]})
    built, err = _try(lambda: scale[mod.map(over=[wf["readings"], wf["other"]])])
    if err:
        return False, f"over=[a, b] -> {err[:110]}"
    wf["x"] = built
    probs = wf.step("x").problems
    return not probs, f"over=[a, b] -> {probs or 'accepted'}"


def k12_whole_table_verb():
    verbs = set(grid.modifier_catalog())
    candidates = verbs & {"table", "apply", "frame", "whole", "pipe"}
    wf = _wf()
    wf["x"] = piv[mod.collapse(over=wf["readings"])]
    wf.run("x")
    err = wf.step("x").output.ledger["error"].iloc[0]
    return bool(candidates), (f"verbs: {sorted(verbs)}; piv[mod.collapse()] -> {str(err)[:90]}"
                              if not candidates else f"found {sorted(candidates)}")


def k13_catalog_takes_tool():
    entry = grid.modifier_catalog()["select"]
    keys = set(entry) - {"name", "class", "row_rule", "settings"}
    return bool(keys & {"takes_tool", "tool", "default_tool"}), f"modifier_catalog()['select'] keys: {sorted(entry)}"


def k14_progress_callback():
    params = inspect.signature(grid.Workflow.run).parameters
    return any(p not in ("self", "step_id", "tools") for p in params), f"Workflow.run{inspect.signature(grid.Workflow.run)}"


def k15_redrive():
    return hasattr(grid.Workflow, "redrive"), f"Workflow.redrive exists: {hasattr(grid.Workflow, 'redrive')}"


def k16_results_store():
    has = hasattr(grid.Output, "ref") or any("store" in n.lower() for n in dir(grid))
    return has, f"Output.ref: {hasattr(grid.Output, 'ref')}; store names in grid: {[n for n in dir(grid) if 'store' in n.lower()]}"


def k17_json_version():
    blob = json.loads(_wf().to_json())
    return False, f"to_json version = {blob.get('version')!r} (check by hand once P0 lands: v1 files must still load)"


def k18_timeout_enforced():
    import time

    @tool
    def slow(n):
        time.sleep(0.3)
        return n

    wf = _wf()
    wf["x"] = slow[mod.map(), mod.timeout(seconds=0.05)](wf["readings"])
    t0 = time.time()
    wf.run("x")
    took = time.time() - t0
    statuses = wf.step("x").output.ledger["status"].tolist()
    return "failed" in statuses or took < 0.3, f"4 units × 0.3s with timeout=0.05 took {took:.1f}s; statuses {statuses}"


ASKS = [
    ("K1", "Unrun source: columns unknown, re-check later", k1_unrun_source_columns),
    ("K2", "Verb inference independent of run state", k2_inference_run_state),
    ("K3", "Refuse an operation used as an input", k3_operation_as_input),
    ("K4", "Refuse `over` given twice", k4_over_twice),
    ("K5", "`over` takes a StepRef, not a string, in Python", k5_string_over),
    ("K6", "Declare a source in call form", k6_source_call_form),
    ("K7", "Declare a sweep in call form", k7_sweep_call_form),
    ("K8", "Tool-less modifiers callable on a reference", k8_modifier_callable),
    ("K9", "One select for rows and columns", k9_select_rows_and_columns),
    ("K10", "A value from another step as an argument (P5)", k10_value_from_step),
    ("K11", "A step reading two steps", k11_multi_input),
    ("K12", "A whole-table verb", k12_whole_table_verb),
    ("K13", "modifier_catalog says which verbs take a tool", k13_catalog_takes_tool),
    ("K14", "Progress callback on run", k14_progress_callback),
    ("K15", "Re-run only the failed rows", k15_redrive),
    ("K16", "Pluggable results store", k16_results_store),
    ("K17", "Stable JSON version across P0", k17_json_version),
    ("K18", "timeout is enforced", k18_timeout_enforced),
]


def main() -> int:
    root = Path(__file__).resolve().parents[1] / "external" / "simple-steps-core"
    commit = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True).stdout.strip() or "?"
    print(f"simple-steps-core at {commit}\n")
    open_count = 0
    for ask_id, title, probe in ASKS:
        result, err = _try(probe)
        if err:
            done, observed = False, f"probe raised {err[:120]}"
        else:
            done, observed = result
        open_count += not done
        print(f"{ask_id:4} {'DONE' if done else 'OPEN':4}  {title}\n           {observed}")
    print(f"\n{len(ASKS) - open_count}/{len(ASKS)} done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
