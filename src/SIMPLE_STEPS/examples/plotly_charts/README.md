# Plotly charts — and other rich cells

A cell can hold more than text: a Plotly figure, an image, a whole table. The
grid shows a thumbnail or a summary (`bar chart · 1 trace · Readings per
city`, `16×16 RGB image`, `table 1×3`); clicking the cell opens the full
view. A later step reads the real object, never the thumbnail. Plotly is
installed with Simple Steps.

```bash
simple-steps run examples/plotly_charts/app.py
python examples/plotly_charts/runme.py
```

The folder isn't called `plotly/`: the main example imports it as a package
from the examples folder, where a `plotly` folder would hide the library itself.

## Workflows

**[`table-filter-chart`](workspace/projects/plotly_charts/table-filter-chart.simple-steps-workflow)**
— the shortest real workflow, and the simplest place to start:

| step | formula | what it does |
|---|---|---|
| `readings` | `to_rows[mod.source()](data='{"city": […], "n": […]}')` | loads a 6-row table |
| `big` | `above_one[mod.filter()](wf["readings"])` | keeps the 4 rows with `n > 1` |
| `chart` | `bar_chart[mod.collapse()](wf["big"])` | one bar chart of those rows |

A tool that builds one thing from a whole table is a **reducer** under
`collapse`: `bar_chart(acc, city, n)` is called once per row with the chart so
far. Written `bar_chart[mod.auto()](wf["big"])` it picks `collapse` by itself.
To chart your own data, make the first step
`load_csv[mod.source()](filepath="/absolute/path/to/readings.csv")`.

**[`rich-cells`](workspace/projects/plotly_charts/rich-cells.simple-steps-workflow)**
— one of each kind of rich cell:

| step | formula | each cell is |
|---|---|---|
| `swatches` | `swatch[mod.map(), mod.name("swatch")](wf["readings"])` | an image: a uint8 numpy array |
| `bright` | `brightness[mod.map(), mod.name("brightness")](wf["swatches"])` | a number read from the real image |
| `profiles` | `profile[mod.map(), mod.name("profile")](wf["readings"])` | a one-row table |
| `chart` | `city_chart[mod.source()](cities=[…], counts=[…])` | a Plotly figure |

## What `runme.py` checks

Each step's output is compared with its Python twin
([`chart_pipeline.py`](chart_pipeline.py)) by content: figures by their full
Plotly JSON, images pixel for pixel. Each chart is also checked by its
data — one `bar` trace with the expected labels, heights and title — and
each swatch by its shape, type and colour.
