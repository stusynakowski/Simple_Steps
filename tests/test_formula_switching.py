"""
Switching a step's tool or verb: what the editor writes runs, or is refused
when written (spec 012).

TEST-FORM-01 covers REQ-FORM-001 (one shape verb per step), TEST-FORM-02
REQ-FORM-002 (a verb that applies no tool keeps its default tool), TEST-FORM-03
the switches the editor makes, end to end through ``/api/run``, TEST-FORM-06
REQ-FORM-006 (every tool, switched to and run), and TEST-FORM-07 REQ-FORM-007
(the shipped examples round-trip through the editor's parts).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from SIMPLE_STEPS.decorators import simple_step_tool
from SIMPLE_STEPS.main import app
from SIMPLE_STEPS.operation_formula import (
    FormulaError, compile_formula, format_parts, is_canonical, to_parts,
)
from SIMPLE_STEPS.catalog import catalog

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "src" / "SIMPLE_STEPS" / "examples"

#: Core's verbs that apply no tool, from its own catalog.
MODIFIERS = catalog().describe()["modifiers"]
NO_TOOL_VERBS = sorted(k for k, v in MODIFIERS.items() if v["takes_tool"] is False)
SHAPE_VERBS = sorted(k for k, v in MODIFIERS.items() if v["class"] == "shape")

#: Settings that make each verb valid on the `numbers` step (n, city).
SETTINGS = {"select": 'columns=["n"]', "drop": 'columns=["n"]', "rename": 'columns={"n": "m"}',
            "sort": 'by="n"', "group": 'by=["city"]'}


# ── Tools of every kind a step can be switched between ───────────────────────

@simple_step_tool(id="fs_numbers", operation_type="source")
def fs_numbers() -> pd.DataFrame:
    return pd.DataFrame({"n": [1, 2, 3, 4], "city": ["SF", "NYC", "SF", "LA"]})


@simple_step_tool(id="fs_double")
def fs_double(n: int) -> int:
    return n * 2


@simple_step_tool(id="fs_is_big")
def fs_is_big(n: int) -> bool:
    return n > 2


@simple_step_tool(id="fs_fan")
def fs_fan(n: int) -> list:
    return list(range(n))


@simple_step_tool(id="fs_shout")
def fs_shout(city: str) -> str:
    return city.upper()


@pytest.fixture
def client():
    return TestClient(app)


def _run(client, formula, step_map):
    """``/api/run`` as the UI calls it: the formula is the step's definition."""
    return client.post("/api/run", json={
        "step_id": "s", "operation_id": "x", "config": {},
        "step_map": step_map, "formula": formula,
    })


@pytest.fixture
def numbers(client):
    r = _run(client, "=fs_numbers[mod.source()]", {})
    assert r.status_code == 200, r.json()
    return {"numbers": r.json()["output_ref_id"]}


def _parts(tool, modifiers, input_="numbers", **arguments):
    return {"tool": tool, "bound_to": None, "modifiers": modifiers, "input": input_,
            "resources": [], "arguments": arguments, "inputs": []}


def _mod(kind, **params):
    return {"kind": kind, "params": params}


# ── TEST-FORM-01 · REQ-FORM-001 ──────────────────────────────────────────────

@pytest.mark.parametrize("formula", [
    '=fs_double[mod.map(), mod.filter()](wf["numbers"])',
    '=fs_double[mod.auto(), mod.map()](wf["numbers"])',
    '=identity[mod.select(columns=["n"]), mod.sort(by="n")](wf["numbers"])',
    '=res["db"].lookup[mod.map(), mod.filter()](wf["numbers"])',
])
def test_two_shape_verbs_are_refused_when_written(formula):
    """REQ-FORM-001: refused by the compiler, naming the verbs and the fix."""
    with pytest.raises(FormulaError, match=r"shape verbs.*separate steps"):
        compile_formula(formula)


def test_two_shape_verbs_are_refused_by_the_editor_write():
    """REQ-FORM-001: the editor's write path (format_parts) refuses them too."""
    with pytest.raises(FormulaError, match="shape verbs"):
        format_parts(_parts("fs_double", [_mod("map"), _mod("filter")]))


@pytest.mark.parametrize("execution", ['mod.retry(times=2)', 'mod.timeout(seconds=5)'])
def test_execution_modifiers_go_with_any_shape_verb(execution):
    """REQ-FORM-001: retry / timeout are not shape verbs; either side of one is fine."""
    compile_formula(f'=fs_double[mod.map(), {execution}](wf["numbers"])')
    compile_formula(f'=fs_double[{execution}, mod.map()](wf["numbers"])')


# ── TEST-FORM-02 · REQ-FORM-002 ──────────────────────────────────────────────

@pytest.mark.parametrize("verb", NO_TOOL_VERBS)
def test_a_verb_that_applies_no_tool_refuses_another_tool(verb):
    """REQ-FORM-002: refused when written, with both fixes in the message."""
    default = MODIFIERS[verb]["default_tool"]
    with pytest.raises(FormulaError) as err:
        compile_formula(f'=fs_double[mod.{verb}({SETTINGS.get(verb, "")})](wf["numbers"])')
    message = str(err.value)
    assert f"{verb} applies no tool" in message
    assert f"{default}[mod.{verb}(" in message            # the verb, with its tool
    assert "fs_double[mod.map()]" in message               # or the tool, with map


@pytest.mark.parametrize("verb", NO_TOOL_VERBS)
def test_a_verb_that_applies_no_tool_takes_its_default_tool(verb):
    """REQ-FORM-002: the default tool is still accepted."""
    default = MODIFIERS[verb]["default_tool"]
    compile_formula(f'={default}[mod.{verb}({SETTINGS.get(verb, "")})](wf["numbers"])')


def test_bound_tools_follow_the_same_rule():
    """REQ-FORM-002: a resource's method is a tool, so select refuses it."""
    with pytest.raises(FormulaError, match="select applies no tool"):
        compile_formula('=res["db"].lookup[mod.select(columns=["n"])](wf["numbers"])')


def test_the_refusal_reaches_the_formula_bar(client):
    """REQ-FORM-002: /api/parse_formula reports it as you type, not at Run."""
    parsed = client.post("/api/parse_formula",
                         json={"formula": '=fs_double[mod.sort(by="n")](wf["numbers"])'}).json()
    assert parsed["isValid"] is False
    assert "sort applies no tool" in parsed["error"]


# ── TEST-FORM-03 · the editor's switches, run end to end ─────────────────────
#
# Each case is a step as the editor rewrites it after a switch: the step reads
# `numbers`; the tool or the verb changed. Every one must run. A map step is
# only its results (core 009 decision 1), so its columns are just `value`.

SWITCHES = {
    # tool switched: the verb goes back to auto (partsForTool + autoForWiring)
    "to a map tool":           (_parts("fs_double", [_mod("auto")]), ["value"]),
    "to a filter tool":        (_parts("fs_is_big", [_mod("auto")]), ["n", "city"]),
    "to a list tool":          (_parts("fs_fan", [_mod("auto")]), None),
    "to a text tool":          (_parts("fs_shout", [_mod("auto")]), ["value"]),
    "to a source tool":        (_parts("fs_numbers", [_mod("source")], None), ["n", "city"]),
    # verb switched: the tool kept (withShapeVerb)
    "map to filter":           (_parts("fs_is_big", [_mod("filter")]), ["n", "city"]),
    "map to expand":           (_parts("fs_fan", [_mod("expand")]), None),
    "auto to collapse":        (_parts("gather", [_mod("collapse")]), None),
    # a no-tool verb chosen: the tool becomes its default (REQ-FORM-004)
    "to select":               (_parts("identity", [_mod("select", columns=["city"])]), ["city"]),
    "to sort":                 (_parts("identity", [_mod("sort", by="n", ascending=False)]), ["n", "city"]),
    "back from select to map": (_parts("fs_double", [_mod("map")]), ["value"]),
    # an execution modifier kept across a verb switch
    "retry kept":              (_parts("fs_double", [_mod("map"), _mod("retry", times=2)]), ["value"]),
}


@pytest.mark.parametrize("name", list(SWITCHES))
def test_each_editor_switch_runs(client, numbers, name):
    """REQ-FORM-003 / REQ-FORM-004: what the editor writes after a switch runs."""
    parts, columns = SWITCHES[name]
    formula = "=" + format_parts(parts)
    r = _run(client, formula, numbers)
    assert r.status_code == 200, (formula, r.json().get("detail"))
    if columns is not None:
        assert r.json()["metrics"]["columns"] == columns, formula


def test_switching_back_and_forth_runs_each_time(client, numbers):
    """REQ-FORM-003: a step switched through several tools and verbs runs at every stop,
    and the later step that reads it runs on its new output."""
    sequence = [
        _parts("fs_double", [_mod("auto")]),
        _parts("identity", [_mod("select", columns=["n"])]),
        _parts("fs_is_big", [_mod("auto")]),
        _parts("fs_fan", [_mod("expand")]),
        _parts("fs_double", [_mod("map"), _mod("name", to="twice")]),
    ]
    for parts in sequence:
        formula = "=" + format_parts(parts)
        r = _run(client, formula, numbers)
        assert r.status_code == 200, (formula, r.json().get("detail"))
        refs = {**numbers, "middle": r.json()["output_ref_id"]}
        after = _run(client, '=identity[mod.slice(stop=2)](wf["middle"])', refs)
        assert after.status_code == 200, (formula, after.json().get("detail"))


@pytest.mark.parametrize("verb", SHAPE_VERBS)
def test_every_verb_on_a_tool_runs_or_is_refused_when_written(client, numbers, verb):
    """REQ-FORM-001/002: no verb the editor offers writes a formula that compiles
    but then fails with an internal error."""
    no_input = verb in ("source", "sweep")
    head = f'fs_double[mod.{verb}({SETTINGS.get(verb, "")})]'
    try:
        formula = "=" + format_parts(to_parts(compile_formula(
            head if no_input else f'{head}(wf["numbers"])')))
    except FormulaError:
        return                                      # refused when written: fine
    r = _run(client, formula, numbers)
    if r.status_code != 200:
        detail = r.json()
        assert detail["error_type"] in ("ValueError", "GridStepError"), (formula, detail)


# ── TEST-FORM-06 · REQ-FORM-006 ──────────────────────────────────────────────

def test_every_example_tool_switched_to_runs_or_says_why():
    """REQ-FORM-006: over the main example's tools (every sub-example's), a switch
    always compiles and never ends in an internal error."""
    done = subprocess.run(
        [sys.executable, str(ROOT / "tests" / "fixtures" / "switch_sweep.py"),
         str(EXAMPLES / "app.py")],
        capture_output=True, text=True, timeout=300,
    )
    assert done.returncode == 0, done.stdout[-3000:] + done.stderr[-3000:]
    result = json.loads(done.stdout.strip().splitlines()[-1])
    assert result["ran"] > 50, result                 # most tools fit some upstream
    assert result["internal"] == [], json.dumps(result["internal"], indent=1)


# ── TEST-FORM-07 · REQ-FORM-007 ──────────────────────────────────────────────

def _example_formulas():
    for path in sorted(EXAMPLES.rglob("*.simple-steps-workflow")):
        if "bad_examples" in path.parts:
            continue                                  # its mistakes are meant to fail
        for step in json.loads(path.read_text()).get("steps", []):
            formula = step.get("expression") or step.get("formula") or ""
            if is_canonical(formula):
                yield pytest.param(formula, id=f"{path.stem}:{step.get('name')}")


@pytest.mark.parametrize("formula", list(_example_formulas()))
def test_example_formulas_round_trip_through_the_editor(formula):
    """REQ-FORM-007: compile → to_parts → format_parts → compile is the identity."""
    compiled = compile_formula(formula)
    again = compile_formula(format_parts(to_parts(compiled)))
    assert again.operation() == compiled.operation()
    assert to_parts(again) == to_parts(compiled)
