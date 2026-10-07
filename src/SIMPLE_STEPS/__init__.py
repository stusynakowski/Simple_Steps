"""
Simple Steps — Visual pipeline orchestrator for Python functions.

Usage:
    from SIMPLE_STEPS import simple_step_tool, step

    @simple_step_tool(name="My Op", category="Demo")
    def my_operation(text: str) -> str:
        return text.upper()

    # Steps are variables — use them like Python objects:
    step1 = step({"url": ["a.com", "b.com"]})
    step2 = my_operation(text=step1.url)   # auto-broadcasts row-wise
    print(step2.df)                        # the resulting DataFrame

    # Or use any plain function without decorating:
    from SIMPLE_STEPS import map_each, apply_to, filter_by, expand_each

    step3 = map_each(str.upper, text=step1.url)
    step4 = apply_to(lambda s: s.mean(), step1.score)
    step5 = filter_by(lambda x: x > 50, step1.score)
"""

# Also register as simple_steps so both import styles work:
#   from SIMPLE_STEPS import simple_step
#   from simple_steps import simple_step
import sys as _sys

__version__ = "0.0.0"

from .decorators import simple_step, simple_step_tool, register_operation  # noqa: F401
from .core_bridge import simple_step_resource  # noqa: F401
from .resources import simple_step_loaded, env, Loaded  # noqa: F401
from .application import App  # noqa: F401
from .agent.model import Agent  # noqa: F401
from .step_proxy import step, StepProxy, ColumnProxy, raw, RawValue  # noqa: F401
from .helpers import map_each, apply_to, filter_by, expand_each, val, col  # noqa: F401

# Register this module under both names so `import simple_steps` works
_sys.modules.setdefault('simple_steps', _sys.modules[__name__])
