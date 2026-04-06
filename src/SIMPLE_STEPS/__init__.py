"""
Simple Steps — Visual pipeline orchestrator for Python functions.

Usage:
    from simple_steps import simple_step

    @simple_step(name="My Op", category="Demo")
    def my_operation(text: str) -> str:
        return text.upper()
"""

__version__ = "0.1.0"

from .decorators import simple_step, register_operation  # noqa: F401
from .operation_pack import OperationPack  # noqa: F401
