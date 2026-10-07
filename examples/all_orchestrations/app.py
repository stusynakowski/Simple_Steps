"""
app.py — this workspace as a Simple Steps application (docs/dev_plan/122 §1).

    python examples/all_orchestrations/app.py            # serve it
    simple-steps --workspace examples/all_orchestrations # the same: the server
                                                          # finds this file

`App` lists what the application offers. Because it lists its tools, the
workspace's other .py files are not scanned: `tools.py` is imported once, here.
Every other setting (workspace, port, sessions, storage) has a default.
"""

from SIMPLE_STEPS import App, Loaded

import tools
from tools import FakeDB, FakeLLM, TinyLLM

app = App(
    tools=[tools],
    resources=[FakeDB, FakeLLM, TinyLLM],
    # A ready-made resource: every workflow here can use res["house_llm"]. A
    # real deployment reads credentials with env("NAME"), which workflows never see.
    loaded={"house_llm": Loaded(FakeLLM, model="house-1")},
    title="All orchestrations",
)

if __name__ == "__main__":
    app.serve()
