"""
main_pipeline.py — the main example's workflow, written in Python.

The twin of ``workspace/projects/main/all-examples.simple-steps-workflow``:
one Python line per saved step, using tools from all three sub-examples.
``runme.py`` runs both and checks every step's output is the same.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import mod, op, res, zip_

from SIMPLE_STEPS.catalog import catalog

from SIMPLE_STEPS.operations import to_rows

from basic.basic_tools import add_n, is_big, scale
from dummy_llm.llm_tools import FakeDB, FakeLLM, enrich, summarize
from plotly_charts.chart_tools import bar_chart, swatch

identity = op("identity")  # core's built-in tool, by name, as core's own example writes it


def build_all_examples() -> Kernel:
    """``all-examples``: readings scored and filtered (basic), looked up and
    summarized by resources (dummy_llm), then drawn (plotly_charts)."""
    wf = Kernel(catalog())
    wf.define("db", FakeDB)
    wf.define("llm", FakeLLM, model="main-1")

    wf["readings"] = to_rows[mod.source()](data='{"city": ["SF", "NYC", "LA", "SF"], "n": [1, 4, 2, 3]}')

    # basic: a map, then a filter
    # a map step is only its results; zip_ puts the readings beside them
    wf["score"] = scale[mod.map(), mod.name("score")](wf["readings"])
    wf["scored"] = zip_(wf["readings"], wf["score"])
    wf["big"] = is_big[mod.filter()](wf["scored"])

    # dummy_llm: a database lookup, then a model's summary, per row
    wf["regions"] = enrich[mod.map(), mod.name("region")](wf["big"], db=res["db"])
    wf["texts"] = identity[mod.rename(columns={"city": "text"})](wf["big"])
    wf["summaries"] = summarize[mod.map(), mod.name("summary")](wf["texts"], llm=res["llm"])

    # basic again: a reducer over the filtered rows
    wf["total_n"] = add_n[mod.collapse(initial=0)](wf["big"])

    # plotly_charts: an image per row, and one chart of them all
    wf["swatches"] = swatch[mod.map(), mod.name("swatch")](wf["big"])
    wf["chart"] = bar_chart[mod.collapse()](wf["big"])
    return wf


def live_resources() -> dict:
    """The objects the twin runs with."""
    return {"db": FakeDB(), "llm": FakeLLM(model="main-1")}
