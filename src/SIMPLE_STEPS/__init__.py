"""
Simple Steps — Visual pipeline orchestrator for Python functions.

Usage:
    from simple_steps import simple_step, step

    @simple_step(name="My Op", category="Demo")
    def my_operation(text: str) -> str:
        return text.upper()

    # Steps are variables — use them like Python objects:
    step1 = step({"url": ["a.com", "b.com"]})
    step2 = my_operation(text=step1.url)   # auto-broadcasts row-wise
    print(step2.df)                        # the resulting DataFrame

    # Or use any plain function without decorating:
    from simple_steps import map_each, apply_to, filter_by, expand_each

    step3 = map_each(str.upper, text=step1.url)
    step4 = apply_to(lambda s: s.mean(), step1.score)
    step5 = filter_by(lambda x: x > 50, step1.score)
"""

__version__ = "0.1.0"

from .decorators import simple_step, register_operation  # noqa: F401
from .operation_pack import OperationPack  # noqa: F401
from .step_proxy import step, StepProxy, ColumnProxy, raw, RawValue  # noqa: F401
from .helpers import map_each, apply_to, filter_by, expand_each, val, col  # noqa: F401
