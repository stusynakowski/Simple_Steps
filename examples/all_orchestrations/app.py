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
from local_llm import DEFAULT_HOST, DEFAULT_MODEL, OllamaLLM, ollama_available
from tools import FakeDB, FakeLLM, TinyLLM

# Ready-made resources: every workflow here can use them by name. A real
# deployment reads credentials with env("NAME"), which workflows never see.
loaded = {"house_llm": Loaded(FakeLLM, model="house-1")}

# A real local model, only if it can be loaded: Ollama running, model pulled.
# Without it the app runs as usual; `local_llm` just isn't offered.
ok, why_not = ollama_available(DEFAULT_MODEL, DEFAULT_HOST)
if ok:
    loaded["local_llm"] = Loaded(OllamaLLM, model=DEFAULT_MODEL, host=DEFAULT_HOST)
else:
    print(f"  ⓘ  local_llm not loaded: {why_not}")

app = App(
    tools=[tools],
    # OllamaLLM is offered as a type either way, so a user can point one at
    # another server from the Resources menu.
    resources=[FakeDB, FakeLLM, TinyLLM, OllamaLLM],
    loaded=loaded,
    title="All orchestrations",
)

if __name__ == "__main__":
    app.serve()
