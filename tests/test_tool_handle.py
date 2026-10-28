"""
A decorated tool is core's tool handle (spec 011).

TEST-TOOL-01 covers REQ-TOOL-001: brackets and a step input build a core
step from the tool's own function, without registering it with core.
TEST-TOOL-02 covers REQ-TOOL-002: every other call behaves as before.
"""
from __future__ import annotations

import inspect

import pandas as pd
from simple_steps_core import Catalog, Kernel, Tool, mod

from SIMPLE_STEPS.decorators import simple_step_tool


@simple_step_tool(id="th_scale")
def th_scale(n: int, weight: int = 1) -> int:
    """Ten times n, weighted."""
    return n * 10 * weight


def _readings() -> Kernel:
    k = Kernel(Catalog(tools=[th_scale]))
    k["r"] = pd.DataFrame({"n": [1, 2, 3]})
    return k


# ── TEST-TOOL-01 · REQ-TOOL-001 ──────────────────────────────────────────────

def test_tool_is_a_core_handle():
    """REQ-TOOL-001: the handle's id is the tool id, its fn the function."""
    assert isinstance(th_scale, Tool)
    assert th_scale.id == "th_scale"
    assert th_scale.fn(2) == 20


def test_brackets_build_a_core_step_that_runs_the_function():
    """REQ-TOOL-001: tool[mod.map(…)](wf["x"]) is a core step."""
    wf = _readings()
    wf["s"] = th_scale[mod.map(), mod.name("score")](wf["r"], weight=2)
    assert wf.step("s").problems == ()
    wf.run("s")
    assert list(wf.step("s").output.data["score"]) == [20, 40, 60]


def test_a_step_input_infers_the_verb():
    """REQ-TOOL-001: tool(wf["x"]) declares a step, its verb inferred.

    Since core 009 (decisions 5-6) the step saves ``mod.auto()`` and core picks
    the verb from the data at each run; here it picks ``map``."""
    wf = _readings()
    wf["a"] = th_scale(wf["r"])
    assert wf.step("a").operation.to_dict()["modifiers"][0]["kind"] == "auto"
    wf.run("a")
    assert wf.step("a").output.meta["auto"]["verb"] == "map"


def test_the_tool_is_not_registered_with_core():
    """REQ-TOOL-001: the handle carries its function; core's registry is untouched."""
    assert "th_scale" not in Catalog().functions


# ── TEST-TOOL-02 · REQ-TOOL-002 ──────────────────────────────────────────────

def test_plain_calls_are_unchanged():
    """REQ-TOOL-002: a plain call runs the function."""
    assert th_scale(3) == 30
    assert th_scale(3, weight=2) == 60


def test_name_doc_and_signature_are_the_functions():
    """REQ-TOOL-002: the tool looks like its function to introspection."""
    assert th_scale.__name__ == "th_scale"
    assert th_scale.__doc__ == "Ten times n, weighted."
    assert list(inspect.signature(th_scale).parameters) == ["n", "weight"]
