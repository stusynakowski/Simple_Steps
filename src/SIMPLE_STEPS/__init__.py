"""
Simple Steps — Visual pipeline orchestrator for Python functions.

Usage:
    from SIMPLE_STEPS import App, simple_step_tool

    @simple_step_tool(name="My Op", category="Demo")
    def my_operation(text: str) -> str:
        return text.upper()

    App(tools=[my_operation]).serve()

In Python, a workflow is core's (``simple_steps_core``):
``wf["up"] = my_operation[mod.map()](wf["texts"])``.
"""

# Also register as simple_steps so both import styles work:
#   from SIMPLE_STEPS import simple_step
#   from simple_steps import simple_step
import sys as _sys

__version__ = "0.0.0"

from .decorators import simple_step, simple_step_tool  # noqa: F401
from .core_bridge import simple_step_resource  # noqa: F401
from .resources import simple_step_loaded, env, Loaded  # noqa: F401
from .application import App  # noqa: F401
from .agent.model import Agent  # noqa: F401

# Register this module under both names so `import simple_steps` works
_sys.modules.setdefault('simple_steps', _sys.modules[__name__])
