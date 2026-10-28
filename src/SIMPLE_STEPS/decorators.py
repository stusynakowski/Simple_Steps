"""
decorators.py — ``@simple_step_tool``: a function, as a core tool.

A tool is core's ``Tool`` (``simple_steps_core.tool``): written the same way in
Python as in a saved formula, with nothing in between::

    from basic.basic_tools import scale
    k["scored"] = scale[mod.map(name="score")](wf["readings"])   # a core step
    k["auto"] = scale(wf["readings"])                            # verb inferred
    scale(3)                                                      # a plain call

What the UI adds — a label, a palette category, the verb it usually runs
under — rides in the tool's ``extras["simple_steps.ui"]``, which core keeps and
never reads. A tool is used by putting it in a catalog (``catalog.py``);
declaring it registers nothing with core.
"""

from __future__ import annotations

import inspect
from typing import Callable, Dict

from simple_steps_core import Tool, tool as _core_tool

from .core_bridge import bound, with_signature

#: The extras key the app's notes on a tool live under.
UI = "simple_steps.ui"

#: Every tool declared in this process, by id: what a catalog is built from
#: when no App lists its tools (``catalog.py``).
DECLARED: Dict[str, Tool] = {}


def _is_method(func: Callable) -> bool:
    """Whether *func* is being defined in a class body, taking ``self``."""
    parts = getattr(func, "__qualname__", "").split(".")
    if len(parts) < 2 or parts[-2] == "<locals>":
        return False
    try:
        params = list(inspect.signature(func).parameters)
    except (TypeError, ValueError):
        return False
    return bool(params) and params[0] == "self"


def simple_step(name: str = None, category: str = "General", operation_type: str = "map", id: str = None):
    """
    Deprecated alias for :func:`simple_step_tool`.

    Kept so existing tool modules keep importing cleanly. New code should say
    ``@simple_step_tool`` for a tool, and declare objects tools *use* with
    ``simple_step_resource``.
    """
    return simple_step_tool(name=name, category=category, operation_type=operation_type, id=id)


def simple_step_tool(
    name: str = None,
    category: str = "General",
    operation_type: str = "map",
    id: str = None,
    description: str = None,
):
    """
    Declare a function as a Simple Steps **tool**: one the user can call from
    the formula bar. Objects that tools *use* are declared with
    :func:`~SIMPLE_STEPS.core_bridge.simple_step_resource` instead.

    The tool's contract — parameters, types, defaults, the return — is core's,
    read from the signature and the docstring's ``Args:`` section.

    Args:
        name: display label for the UI. Defaults to a title-cased function name.
        category: palette grouping.
        operation_type: the verb the palette suggests ("map", "source", "dataframe", …).
        id: the tool's name in formulas. Defaults to the function name.
        description: overrides the docstring summary in the UI.

    Returns:
        Core's :class:`~simple_steps_core.Tool`. On a method of a resource
        type, the method itself, marked as one of the type's tools.
    """
    if callable(name):                       # bare @simple_step_tool
        return simple_step_tool()(name)

    def decorator(func: Callable):
        if _is_method(func):
            # A method of a @simple_step_resource class is a *bound* tool: core
            # records it on the type when the class decorator runs.
            return bound(func)
        ui = {"name": name or func.__name__.replace("_", " ").title(),
              "category": category, "operation_type": operation_type}
        if description:
            ui["description"] = description
        tool = with_signature(_core_tool(id=id or func.__name__, extras={UI: ui})(func))
        DECLARED[tool.id] = tool
        return tool

    return decorator
