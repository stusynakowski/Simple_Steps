"""
environment.py — everything a workflow in this app can use, for the
Environment explorer (``GET /api/environment``, spec 013).

Tools and resource types come from the app's catalog (``cat.describe()``), so a
parameter's type is the Python annotation as written (``int``, ``LLM``,
``DataFrame``) — not the palette's coarse form-field type — and core's built-in
tools are listed next to the app's. The palette's label, category and
orchestration hint come from each tool's ``extras["simple_steps.ui"]``.
The ready-made resources are :func:`resources.loaded_info`.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .decorators import UI


def describe_environment() -> Dict[str, Any]:
    """The tools, resource types and ready-made resources of this app."""
    from .catalog import catalog, resource_bases
    from .core_bridge import docstring_summary
    from .resources import loaded_info

    cat = catalog()
    described = cat.describe()
    fits = resource_bases()

    entries = []
    for tool_id, entry in described["tools"].items():
        ui = (entry.get("extras") or {}).get(UI) or {}
        builtin = entry.get("origin") == "builtin"
        fn = cat.functions.get(tool_id)
        entries.append({
            "id": tool_id,
            "label": ui.get("name") or tool_id,
            "category": ui.get("category") or ("Built-in" if builtin else "Uncategorized"),
            "origin": entry.get("origin"),
            "kind": ui.get("operation_type"),
            # Core keeps the docstring's first line; its first paragraph may be longer.
            "description": max(entry.get("description") or "", ui.get("description") or "",
                               docstring_summary(fn) if fn else "", key=len),
            "params": [_param(p, fits) for p in entry.get("params") or []],
            "returns": entry.get("returns"),
            "returns_form": {"DataFrame": "grid", "Series": "column"}.get(entry.get("returns") or ""),
        })
    entries.sort(key=lambda t: (t["origin"] == "builtin", t["category"].lower(), t["id"]))

    return {"tools": entries, "resource_types": described["resource_types"],
            "resources": loaded_info()}


def _param(p: Dict[str, Any], fits: Dict[str, List[str]]) -> Dict[str, Any]:
    out = {
        "name": p.get("name"),
        "type": p.get("type"),
        "required": bool(p.get("required")),
        "default": p.get("default"),
        "choices": p.get("choices"),
        "nullable": bool(p.get("nullable")),
        "description": p.get("description") or "",
    }
    takes = fits.get(p.get("type") or "")
    if takes:
        out["resource"] = sorted(takes)
    return out
