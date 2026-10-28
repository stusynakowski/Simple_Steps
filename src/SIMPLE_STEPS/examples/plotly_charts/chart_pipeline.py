"""
chart_pipeline.py — the Plotly example's workflows, written in Python.

Each saved workflow in ``workspace/projects/plotly_charts/`` has a twin here:
one Python line per saved step, in simple-steps-core's syntax. ``runme.py``
runs both and checks every step's output is the same — figures, images and
tables in cells compared by content.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import mod

from SIMPLE_STEPS.catalog import catalog

from SIMPLE_STEPS.operations import to_rows

from chart_tools import above_one, bar_chart, brightness, city_chart, profile, swatch


def build_rich_cells() -> Kernel:
    """``rich-cells``: an image, a table and a Plotly figure in cells. A later
    step reads the real object: ``brightness`` gets the image array."""
    wf = Kernel(catalog())
    wf["readings"] = to_rows[mod.source()](data='{"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]}')
    wf["swatches"] = swatch[mod.map(), mod.name("swatch")](wf["readings"])
    wf["bright"] = brightness[mod.map(), mod.name("brightness")](wf["swatches"])
    wf["profiles"] = profile[mod.map(), mod.name("profile")](wf["readings"])
    wf["chart"] = city_chart[mod.source()](cities=["SF", "NYC", "LA"], counts=[2, 1, 1])
    return wf


def build_table_filter_chart() -> Kernel:
    """``table-filter-chart``: load a table, keep the rows with n > 1, chart
    them — one figure from a whole table, by a reducer under collapse."""
    wf = Kernel(catalog())
    wf["readings"] = to_rows[mod.source()](data='{"city": ["SF", "NYC", "LA", "Austin", "Boston", "Denver"], "n": [1, 4, 2, 5, 1, 3]}')
    wf["big"] = above_one[mod.filter()](wf["readings"])
    wf["chart"] = bar_chart[mod.collapse()](wf["big"])
    return wf
