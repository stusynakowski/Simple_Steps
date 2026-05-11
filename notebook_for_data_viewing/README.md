This folder contains example notebooks demonstrating the notebook dataflow helper and viewer.

Open and run `01_demo_register_and_launch.ipynb` in a Jupyter environment that has the project's package on PYTHONPATH (or run from the repo root with the venv active). The notebook will:

- Register a few example steps using `SIMPLE_STEPS.notebook_dataflow.register_step`
- Start a tiny HTTP server that serves the project root (so the viewer can fetch `./.simple_steps/notebook_dataflow.json`)
- Launch the default web browser to `http://127.0.0.1:8765/docs/tools/notebook_dataflow_viewer.html`

Run `02_demo_update_and_refresh.ipynb` to see updating a step and reloading the viewer.

Notes:
- The notebook starts a simple HTTP server on port 8765. If the port is in use, stop the server and re-run the cell with a different port.
- The HTTP server runs in the same process as the notebook cell and is spawned as a background thread; stop it by interrupting the kernel or re-running the provided `stop_server()` helper.
