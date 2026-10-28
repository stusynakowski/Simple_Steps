import functools
import inspect
from typing import Callable, Dict, List
from .models import OperationParam, OperationDefinition, OperationReturn

# Global registry for operations
# We will use this to replace the old REGISTRY and DEFINITIONS
OPERATION_REGISTRY: Dict[str, OperationDefinition] = {}
DEFINITIONS_LIST: List[OperationDefinition] = []


def simple_step(name: str = None, category: str = "General", operation_type: str = "map", id: str = None):
    """
    Deprecated alias for :func:`simple_step_tool`.

    Kept so existing tool modules keep importing cleanly. New code should say
    ``@simple_step_tool`` for a tool, and declare objects tools *use* with
    ``simple_step_resource``. This delegates rather than duplicating the
    registration path — there is exactly one place a contract is derived.
    """
    return simple_step_tool(
        name=name,
        category=category,
        operation_type=operation_type,
        id=id,
    )


# --------------------------------------------------------------------------- #
# simple_step_tool — the core-backed decorator                                #
# --------------------------------------------------------------------------- #

# Core's type name for a parameter ("str", "int", "DataFrame"; a Literal is
# already its values' type) -> the UI's coarser widget vocabulary.
_UI_TYPE_BY_ANNOTATION = {
    "int": "number", "float": "number", "complex": "number",
    "bool": "boolean",
    "list": "list", "tuple": "list", "set": "list",
    "dict": "object", "Mapping": "object",
    "DataFrame": "dataframe", "Series": "dataframe",
}


def _ui_type(type_name: str) -> str:
    """Map core's type name for a parameter onto the UI's widget type."""
    base = (type_name or "").split("[")[0].strip()
    if base in _UI_TYPE_BY_ANNOTATION:
        return _UI_TYPE_BY_ANNOTATION[base]
    lowered = base.lower()
    for key, ui in _UI_TYPE_BY_ANNOTATION.items():
        if lowered == key.lower():
            return ui
    return "string"


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


from simple_steps_core import grid as _grid  # noqa: E402


class Tool(_grid.ToolHandle):
    """What ``@simple_step_tool`` returns: core's tool handle for the function.

    So a tool is written the same way in Python as in a saved formula, with
    nothing in between::

        from basic.basic_tools import scale
        wf["scored"] = scale[mod.map(name="score")](wf["readings"])   # a core step
        wf["auto"] = scale(wf["readings"])                            # verb inferred

    Brackets, or a call whose input is ``wf[…]``, build a core step from the
    tool's own function (core's ``ToolHandle``). The handle is never added to
    core's tool registry: it carries the function itself. Any other call is a
    plain call of the function: ``scale(3)``.
    """

    def __init__(self, func: Callable, tool_id: str):
        super().__init__(func, tool_id)
        functools.update_wrapper(self, func)   # name, doc, module, __wrapped__

    def __call__(self, *args, **kwargs):
        if (args and isinstance(args[0], _grid.StepRef)) or any(
                isinstance(v, (_grid.StepRef, _grid.Operation))
                for v in (*args, *kwargs.values())):
            return super().__call__(*args, **kwargs)
        return self.fn(*args, **kwargs)

    @property
    def _tool_id(self) -> str:
        return self.id


def simple_step_tool(
    name: str = None,
    category: str = "General",
    operation_type: str = "map",
    id: str = None,
    description: str = None,
    resource: str = None,
):
    """
    Register a function as a Simple Steps **tool**.

    This is the explicit successor to ``@simple_step``: a tool is a function the
    user can call from the formula bar. Objects that tools *use* are declared
    with :func:`~SIMPLE_STEPS.core_bridge.simple_step_resource` instead.

    The tool's contract — parameters, types, required flags, input/output
    schema, resource dependencies — comes from ``simple_steps_core``'s
    ``ToolRegistry``. Core is the heart; this decorator is the adapter that
    also keeps the local engine's registry populated during the migration.

    Args:
        name: display label for the UI. Defaults to a title-cased function name.
        category: sidebar grouping.
        operation_type: default orchestration ("map", "source", "dataframe", …).
        id: explicit tool id. Defaults to the function name.
        description: overrides the docstring summary, which is used otherwise.
        resource: the resource this tool is bound to, if any.

    Returns:
        A :class:`Tool`: core's tool handle, so ``tool[mod.map()](wf["x"])``
        builds a core step; any other call runs the function.
    """
    if callable(name):                       # bare @simple_step_tool
        return simple_step_tool()(name)

    def decorator(func: Callable):
        from .core_bridge import core_contract

        if _is_method(func):
            # A method of a @simple_step_resource class is a *bound* tool
            # (core 007): core records it on the type when the class decorator
            # runs, and it stays an ordinary method. It is never a global tool.
            from simple_steps_core import grid
            return grid.bound_tool(func)

        op_name = name or func.__name__.replace("_", " ").title()
        op_id = id or func.__name__

        # Core registers the tool and derives the contract (core_bridge).
        contract = core_contract(
            func,
            op_id,
            category=category,
            operation_type=operation_type,
            description=description,
            resource=resource,
        )

        params = [
            OperationParam(
                name=p["name"],
                type=_ui_type(p["type_name"]),
                description=p["description"],
                default=p["default"],
                required=p["required"],
                kind=p["kind"],
                options=p.get("options"),
            )
            for p in contract.params
        ]

        definition = OperationDefinition(
            id=op_id,
            label=op_name,
            description=contract.description or (func.__doc__ or ""),
            type=operation_type,
            category=category,
            params=params,
            returns=OperationReturn(
                type=contract.output_type,
                form=contract.output_form,
            ),
            resource=contract.resource,
            dependencies=contract.dependencies,
        )

        OPERATION_REGISTRY[op_id] = {
            "definition": definition,
            "func": func,            # raw, unwrapped — the engine calls this
            "category": category,
            "type": operation_type,
            "contract": contract,    # core's view, for the registry API
        }
        DEFINITIONS_LIST.append(definition)

        return Tool(func, op_id)

    return decorator
