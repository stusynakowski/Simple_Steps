"""
catalog.py — what a workflow in this app may use: core's ``Catalog``.

One catalog per process, built from every tool declared in it
(``decorators.DECLARED``: the standard tools in ``operations.py``, the App's,
and whatever a script or a test declared) and every resource type declared
with ``@simple_step_resource``. The App's ``tools=[…]`` is what the agent is
shown (``agent/scope.py``).

Core's built-in tools, modifiers and combines are in every catalog. The palette
(``GET /api/operations``) and the Environment explorer read it through
``cat.describe()``, so neither can drift from what a kernel accepts.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional, Tuple

from simple_steps_core import Catalog, Tool

from .decorators import DECLARED, UI

_LOCK = threading.Lock()
_BUILT: Optional[Tuple[tuple, Catalog]] = None
_FROZEN: Optional[Catalog] = None


def _tools() -> List[Tool]:
    from . import operations  # noqa: F401 — declares the standard tools
    return list(DECLARED.values())


def catalog() -> Catalog:
    """The catalog this process serves; rebuilt when a tool or resource type
    is declared, until :func:`freeze`."""
    global _BUILT
    if _FROZEN is not None:
        return _FROZEN
    from .resources import RESOURCE_TYPES
    tools = _tools()
    types = list(RESOURCE_TYPES.values())
    key = tuple(id(t) for t in tools) + tuple(id(c) for c in types)
    with _LOCK:
        if _BUILT is None or _BUILT[0] != key:
            _BUILT = (key, Catalog(tools=tools, resources=types))
        return _BUILT[1]


def freeze() -> None:
    """Fix the catalog: no tool declared from now on is offered (``App(freeze=True)``)."""
    global _FROZEN
    _FROZEN = catalog()


def functions() -> Dict[str, Any]:
    """Tool name → its function, for every tool the catalog has."""
    return dict(catalog().functions)


# ─────────────────────────────────────────────────────────────────────────────
# The palette: GET /api/operations
# ─────────────────────────────────────────────────────────────────────────────

#: Core's type name for a parameter → the UI's coarser widget type.
_UI_TYPE = {
    "int": "number", "float": "number", "complex": "number",
    "bool": "boolean",
    "list": "list", "tuple": "list", "set": "list",
    "dict": "object", "Mapping": "object",
    "DataFrame": "dataframe", "Series": "dataframe",
}
#: A return type → its cardinality word.
_FORM = {"DataFrame": "grid", "Series": "column"}


def _ui_type(type_name: Optional[str]) -> str:
    base = (type_name or "").split("[")[0].strip()
    return _UI_TYPE.get(base) or next(
        (ui for key, ui in _UI_TYPE.items() if base.lower() == key.lower()), "string")


def resource_bases() -> Dict[str, List[str]]:
    """A type name → the resource types that fit a parameter of that type
    (each type, and every type derived from it)."""
    fits: Dict[str, List[str]] = {}
    for name, entry in catalog().describe()["resource_types"].items():
        for base in entry.get("bases") or [name]:
            fits.setdefault(base, []).append(name)
    return fits


def palette() -> list:
    """The app's tools, as the palette and the step editor show them."""
    from .core_bridge import docstring_summary
    from .models import OperationDefinition, OperationParam, OperationReturn

    cat = catalog()
    fits = resource_bases()
    out = []
    for name, entry in cat.describe()["tools"].items():
        if entry.get("origin") == "builtin":
            continue
        ui = (entry.get("extras") or {}).get(UI) or {}
        fn = cat.functions.get(name)
        params = [OperationParam(
            name=p["name"], type=_ui_type(p.get("type")),
            description=p.get("description") or "", default=p.get("default"),
            required=bool(p.get("required")), options=p.get("choices"),
            kind="resource" if p.get("type") in fits else "data",
        ) for p in entry.get("params") or []]
        returns = entry.get("returns") or "Any"
        out.append(OperationDefinition(
            id=name, label=ui.get("name") or name,
            description=ui.get("description") or (docstring_summary(fn) if fn else "")
            or entry.get("description") or "",
            type=ui.get("operation_type") or "map", category=ui.get("category") or "General",
            params=params, returns=OperationReturn(type=returns, form=_FORM.get(returns)),
            dependencies=[p.name for p in params if p.kind == "resource"],
        ))
    return out
