# The Simple Steps package

The app around `simple_steps_core`: the server, the UI's API, and hosting a
kernel per open workflow. Core owns what a workflow means: tools, the
catalog, steps, checks and runs. This package owns transport, the UI's notes
and where things are kept.

| Module | What it does |
|---|---|
| `application.py` | `App(tools=[…], resources=[…], loaded={…})`: what an application offers |
| `decorators.py` | `@simple_step_tool`: core's `@tool`, with the UI's label and category in `extras["simple_steps.ui"]` |
| `catalog.py` | the one `Catalog` (every declared tool and resource type), and the palette from `describe()` |
| `operation_formula.py` | the formula parser: core's syntax → core's operation spec, and back for the step editor |
| `kernels.py` | each open workflow as a core `Kernel`: declare, run, states; put away and restored |
| `engine.py` | `/api/run`'s entry, and the store `/api/data` pages outputs from |
| `grid_runner.py` | a formula run outside a workflow, and the metrics every run reports |
| `resources.py` | ready-made resources, settings from the environment, live objects per session |
| `core_bridge.py` | every shim over a core gap, tagged `SHIM(core §X)` |
| `main.py` | the FastAPI routes and the bundled UI |
| `file_manager.py` | workflow files under `projects/` |
| `agent/` | the agent: its scope, proposals and their checks |

A tool:

```python
from SIMPLE_STEPS import App, simple_step_tool

@simple_step_tool(name="Word count", category="Text")
def word_count(text: str) -> int:
    """How many words *text* has."""
    return len(text.split())

App(tools=[word_count]).serve()
```

and a step that uses it, in the formula bar or in Python with core:

```
=word_count[mod.map()](wf["notes"])
```
