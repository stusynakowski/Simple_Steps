"""
order_pipeline.py — the agent example's reference workflow, written in Python.

The twin of ``workspace/projects/agent_demo/reference.simple-steps-workflow``:
the steps a good agent adds for the requests in ``tasks.py``, one Python line
per step. ``runme.py`` runs both and checks every step's output is the same.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import mod, op, zip_

from SIMPLE_STEPS.catalog import catalog

from order_tools import is_large_order, line_total, month_of, sample_orders, sum_totals

identity = op("identity")  # core's built-in tool, by name


def build_reference() -> Kernel:
    """``reference``: the start workflow, plus one step per request."""
    wf = Kernel(catalog())
    wf["orders"] = sample_orders[mod.source()]()
    wf["totals"] = line_total[mod.map(), mod.name("total")](wf["orders"])
    wf["with_totals"] = zip_(wf["orders"], wf["totals"])     # each order beside its total
    wf["large"] = is_large_order[mod.filter()](wf["with_totals"], threshold=100)
    wf["ranked"] = identity[mod.sort(by="total", ascending=False)](wf["large"])
    wf["per_city"] = sum_totals[mod.collapse(by="city", initial=0)](wf["with_totals"])
    wf["months"] = month_of[mod.map(), mod.name("month")](wf["orders"])
    return wf
