Notebook Dataflow Viewer
========================

Quick developer utility to publish a snapshot of steps defined in Jupyter
notebooks so you can visualize the layout while iterating.

Usage from a notebook
---------------------

1. Import the helper and register steps when you define or run them:

```python
from SIMPLE_STEPS.notebook_dataflow import register_step

# call this when you define a step in your notebook
register_step(
    step_id="step_1",
    title="Load CSV",
    inputs=["path"],
    outputs=["df"],
)
```

2. The helper writes a file to `.simple_steps/notebook_dataflow.json` under the
   current working directory (or under the directory configured by
   `SIMPLE_STEPS_WORKSPACE`).

Opening the viewer
------------------

- Open `docs/tools/notebook_dataflow_viewer.html` in a browser and either let
  it load the default `./.simple_steps/notebook_dataflow.json` or pass a
  full path as a query param, e.g.:

  file:///.../Simple_Steps/docs/tools/notebook_dataflow_viewer.html?file=/path/to/your/project/.simple_steps/notebook_dataflow.json

Notes
-----
- This is intentionally minimal: it's just a developer convenience for
  visualizing the declared steps and doesn't affect runtime logic.
- The data format is stable but simple: top-level key `steps` is a list of
  entries with `id`, `title`, `inputs`, `outputs`, and `metadata`.
