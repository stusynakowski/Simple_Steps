"""
runme.py — run the Plotly example's workflows and check every step.

    python examples/plotly_charts/runme.py

For each saved workflow in ``workspace/projects/plotly_charts/``, every step
is run the way the UI runs it, then compared with its Python twin
(``chart_pipeline.py``) run straight in simple-steps-core. Each chart is also
checked by its data: a Plotly figure, with the trace type, labels, heights and
title it should have. Exits non-zero if any step doesn't match.
"""

import sys
from pathlib import Path

import numpy as np

from SIMPLE_STEPS.example_check import Example

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

import chart_pipeline as pipeline  # noqa: E402


def bar_figure(x, y, title, column):
    """The step's one cell is a Plotly bar chart of *x* against *y*, titled *title*."""
    def check(data, metrics):
        figure = data[column].iloc[0]
        if not hasattr(figure, "to_plotly_json"):
            return f"not a Plotly figure: {type(figure).__name__}"
        if len(figure.data) != 1 or figure.data[0].type != "bar":
            return f"want one bar trace, got {[t.type for t in figure.data]}"
        bar = figure.data[0]
        if list(bar.x) != x or list(bar.y) != y:
            return f"bars x={list(bar.x)} y={list(bar.y)}, want x={x} y={y}"
        if figure.layout.title.text != title:
            return f"title {figure.layout.title.text!r}, want {title!r}"
        return True
    return check


def images(ns, size=16):
    """Every swatch is a size×size RGB uint8 image, redder as n grows.

    A map step is only its results, so the swatches carry no ``n``: *ns* is
    the readings' ``n``, row for row."""
    def check(data, metrics):
        if len(data["swatch"]) != len(ns):
            return f"{len(data['swatch'])} swatches, want {len(ns)}"
        for n, image in zip(ns, data["swatch"]):
            if not (isinstance(image, np.ndarray) and image.shape == (size, size, 3) and image.dtype == np.uint8):
                return f"not a {size}×{size} RGB image: {type(image).__name__}"
            if image[0, 0, 0] != min(255, 60 * n):
                return f"swatch for n={n} has red {image[0, 0, 0]}, want {min(255, 60 * n)}"
        return True
    return check


example.check("plotly_charts", "rich-cells", twin=pipeline.build_rich_cells, expect={
    "swatches": images(ns=[1, 2, 3, 2]),
    # brightness reads the real array: a swatch's mean is (60·n + 0 + 128) / 3
    "bright": {"brightness": [62.67, 82.67, 102.67, 82.67]},
    "profiles": lambda data, metrics: all(list(t.columns) == ["city", "n", "double"] for t in data["profile"])
                or "each profile should be a city/n/double table",
    "chart": bar_figure(["SF", "NYC", "LA"], [2, 1, 1], "Readings per city", column="chart"),
})

example.check("plotly_charts", "table-filter-chart", twin=pipeline.build_table_filter_chart, expect={
    "big": {"city": ["NYC", "LA", "Austin", "Denver"], "n": [4, 2, 5, 3]},
    "chart": bar_figure(["NYC", "LA", "Austin", "Denver"], [4, 2, 5, 3], "Readings above one", column="chart"),
})

sys.exit(example.finish())
