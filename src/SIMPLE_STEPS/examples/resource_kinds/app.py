"""
app.py — the resource kinds example as a Simple Steps application.

    simple-steps run examples/resource_kinds/app.py
    python examples/resource_kinds/app.py

Its workflow is in ``workspace/projects/resource_kinds/``. ``runme.py`` runs
it headlessly and checks it.
"""

from pathlib import Path

from SIMPLE_STEPS import App

import resource_tools

app = App(
    # No tools of its own: every tool here is a resource's method, written
    # res["db"].lookup[…](…), and comes with its resource type.
    resources=resource_tools.TYPES,
    loaded=resource_tools.ready_made(),
    workspace=str(Path(__file__).resolve().parent / "workspace"),
    title="Resource kinds",
)

if __name__ == "__main__":
    app.serve()
