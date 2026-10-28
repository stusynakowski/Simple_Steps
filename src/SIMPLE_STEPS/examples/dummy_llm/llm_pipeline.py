"""
llm_pipeline.py — the dummy LLM example's workflow, written in Python.

The twin of ``workspace/projects/dummy_llm/resources.simple-steps-workflow``:
one Python line per saved step, in simple-steps-core's syntax. ``runme.py``
runs both and checks every step's output is the same.

Resources are declared on the workflow (``wf.define``: a type and literal
settings, never an object), and the objects themselves are the caller's —
:func:`live_resources` — handed to each run. That's the split the app makes
too: the saved file declares, the server owns the live objects.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import mod, op, res, zip_

from SIMPLE_STEPS.catalog import catalog

from SIMPLE_STEPS.operations import to_rows

from llm_tools import FakeDB, FakeLLM, TinyLLM, enrich, summarize

identity = op("identity")  # core's built-in tool, by name, as core's own example writes it


def build_resources() -> Kernel:
    """``resources``: unbound tools taking a resource, bound tools on one
    named instance, and a ready-made resource with a saved override."""
    wf = Kernel(catalog())
    wf.define("db", FakeDB)
    wf.define("llm", FakeLLM, model="fake-1")
    wf.define("tiny", TinyLLM, model="tiny-1")
    # The app provides house_llm ready-made (model="house-1"); the workflow
    # saves an override, so the step runs with the merged settings.
    wf.define("house_llm", FakeLLM, model="house-2")

    wf["readings"] = to_rows[mod.source()](data='{"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]}')
    wf["notes"] = to_rows[mod.source()](data='{"text": ["a", "b"]}')
    wf["keys"] = identity[mod.rename(columns={"city": "key"})](wf["readings"])

    # unbound tools: the resource is an argument, chosen per step
    wf["regions"] = enrich[mod.map()](wf["readings"], db=res["db"])
    wf["summaries"] = summarize[mod.map()](wf["notes"], llm=res["llm"])
    # The saved step passes res["tiny"] by position; the app binds it to the
    # one parameter its type fits. Core takes resources by keyword.
    wf["tiny_summaries"] = summarize[mod.map()](wf["notes"], llm=res["tiny"])

    # bound tools: a marked method of one named instance
    wf["regions_bound"] = res["db"].lookup[mod.map()](wf["keys"])
    wf["hello"] = res["llm"].complete[mod.source()](prompt="hi")
    wf["inferred"] = res["db"].lookup(wf["keys"])

    # a resource step's output feeds later steps like any other; a map step is
    # only its results, so zip_ puts each city beside its region (by row id)
    wf["region_table"] = zip_(wf["readings"], wf["regions"])
    wf["house_summaries"] = summarize[mod.map()](wf["notes"], llm=res["house_llm"])
    return wf


def live_resources() -> dict:
    """The objects the twin runs with — what the app builds from the
    declarations, once per session."""
    return {"db": FakeDB(), "llm": FakeLLM(model="fake-1"), "tiny": TinyLLM(model="tiny-1"),
            "house_llm": FakeLLM(model="house-2")}
