"""
scope.py — what the agent reads before it proposes (docs/dev_plan/122 §3.2).

The scope is plain text, kept short enough for a small local model:

- **tools**: the application's tools (``App(tools=…)``; without an App, every
  tool not built into this package), each as a signature and its docstring's
  first line;
- **resources**: the resource types with their marked tools, and the
  resources this workflow can use by name (its own and the deployment's);
- **the workflow**: each step's name, formula, status, error, and what its
  output looks like — columns, row count and a few sample rows, with rich
  cells as their summaries ("16×16 RGB image"), never raw data.

Nothing here reads a resource or runs a tool.
"""

from __future__ import annotations

import inspect
from typing import Any, List, Mapping, Optional

#: Sample rows of each step's output the agent sees.
SAMPLE_ROWS = 3
#: Longest cell text in a sample.
CELL_TEXT = 40


def _first_line(text: Optional[str]) -> str:
    return (text or "").strip().split("\n", 1)[0].strip()


def _signature(func: Any) -> str:
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return "(…)"
    parts = []
    for p in sig.parameters.values():
        if p.name == "self":
            continue
        ann = p.annotation
        text = p.name
        if ann is not inspect.Parameter.empty:
            text += f": {ann if isinstance(ann, str) else getattr(ann, '__name__', ann)}"
        if p.default is not inspect.Parameter.empty:
            text += f" = {p.default!r}"
        parts.append(text)
    ret = sig.return_annotation
    out = "" if ret is inspect.Signature.empty else \
        f" -> {ret if isinstance(ret, str) else getattr(ret, '__name__', ret)}"
    return f"({', '.join(parts)}){out}"


def tool_ids() -> List[str]:
    """The tools the agent may use."""
    from .. import application
    from ..decorators import OPERATION_REGISTRY

    app = application.CURRENT
    if app is not None and app.explicit:
        ids = list(app.tool_ids)
    else:
        ids = [i for i, e in OPERATION_REGISTRY.items()
               if not str(getattr(e.get("func"), "__module__", "")).startswith("SIMPLE_STEPS")]
    if "to_rows" in OPERATION_REGISTRY and "to_rows" not in ids:
        ids.append("to_rows")          # how a step makes a table from literal data
    return ids


def catalog_text() -> str:
    """Tools and resource types, one per line."""
    from simple_steps_core import grid
    from ..decorators import OPERATION_REGISTRY
    from ..resources import RESOURCE_TYPES

    lines = ["TOOLS (use as tool[mod.verb(…)](wf[\"step\"], arg=…)):"]
    for op_id in tool_ids():
        entry = OPERATION_REGISTRY.get(op_id)
        if not entry:
            continue
        func = entry.get("func")
        lines.append(f"- {op_id}{_signature(func)} — {_first_line(inspect.getdoc(func))}")
    lines.append("- identity, count, gather, total, first, last — built in; identity applies no "
                 "tool (for select/drop/rename/sort/slice/distinct/widen)")
    if RESOURCE_TYPES:
        lines.append("")
        lines.append("RESOURCE TYPES (a resource is used by name: res[\"name\"]):")
        for name, cls in sorted(RESOURCE_TYPES.items()):
            entry = grid.resource_entry(cls)
            bases = [b for b in entry.get("bases", []) if b != name]
            fits = f" (is a {', '.join(bases)})" if bases else ""
            lines.append(f"- {name}{fits} — {_first_line(entry.get('description'))}")
            for tool_id, tool in entry.get("tools", {}).items():
                params = ", ".join(f"{p['name']}: {p.get('type') or 'any'}" for p in tool.get("params", []))
                method = tool_id.split(".", 1)[1]
                lines.append(f"    res[\"<name>\"].{method}({params}) — {_first_line(tool.get('description'))}")
    return "\n".join(lines)


def resources_text(workflow_resources: Mapping[str, Any]) -> str:
    """The resources this workflow can name, and what each is."""
    from ..resources import LOADED

    lines = []
    for name, decl in (workflow_resources or {}).items():
        settings = {**(decl.get("as_loaded") or {}), **(decl.get("settings") or {}),
                    **(decl.get("overrides") or {})}
        shown = ", ".join(f"{k}={v!r}" for k, v in settings.items())
        lines.append(f"- res[\"{name}\"]: {decl.get('type')}({shown})")
    for name, loaded in sorted(LOADED.items()):
        if name not in (workflow_resources or {}):
            shown = ", ".join(f"{k}={v!r}" for k, v in loaded.visible.items())
            lines.append(f"- res[\"{name}\"]: {loaded.type.__name__}({shown}) — ready-made, "
                         "add it to the workflow from the Resources menu to use it")
    return "RESOURCES THIS WORKFLOW CAN USE:\n" + ("\n".join(lines) if lines else "- none")


def _sample(value: Any) -> str:
    """A step's output as columns, size and a few sample rows."""
    import pandas as pd
    from ..cell_types import cell

    if not isinstance(value, pd.DataFrame):
        text = cell(0, "value", value)["display_value"]
        return f"one value: {text[:CELL_TEXT]}"
    columns = [str(c) for c in value.columns]
    rows = []
    for i in range(min(SAMPLE_ROWS, len(value))):
        shown = {c: cell(i, c, v)["display_value"][:CELL_TEXT] for c, v in zip(columns, value.iloc[i])}
        rows.append(", ".join(f"{k}: {v}" for k, v in shown.items()))
    sample = "; ".join("{" + r + "}" for r in rows)
    return f"{len(value)} rows × {len(columns)} columns ({', '.join(columns)}); sample: {sample}"


def workflow_text(steps: List[Mapping[str, Any]], session_id: Optional[str]) -> str:
    """The workflow so far, one step per line, with what each produced."""
    from ..engine import get_value

    if not steps:
        return "THE WORKFLOW: empty — no steps yet."
    lines = ["THE WORKFLOW (in order; a step reads only earlier steps):"]
    for i, step in enumerate(steps, 1):
        name = step.get("name") or f"step{i}"
        formula = (step.get("formula") or "").strip() or "(empty)"
        status = step.get("status") or "pending"
        line = f"{i}. {name} = {formula}  [{status}]"
        if step.get("error"):
            line += f"\n   error: {str(step['error'])[:300]}"
        ref = step.get("output_ref")
        if ref:
            try:
                value = get_value(ref, session_id=session_id)
            except Exception:
                value = None
            if value is not None:
                line += f"\n   output: {_sample(value)}"
        lines.append(line)
    return "\n".join(lines)
