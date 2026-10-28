"""
app.py — the UI-status workflows, as an app you can open and click through.

    simple-steps-dev --workspace scripts/ui_status    # dev UI on :5173, hot reload
    simple-steps run scripts/ui_status/app.py         # the built UI

Not shipped: this lives in scripts/, outside the package. ``status.py`` checks the same
workflows headlessly. See README.md.
"""

from pathlib import Path

from SIMPLE_STEPS import App

import ui_status_tools

app = App(
    tools=[ui_status_tools],
    workspace=str(Path(__file__).resolve().parent),
    title="UI status: formula bar, cell states, references, lineage",
)

if __name__ == "__main__":
    app.serve()
