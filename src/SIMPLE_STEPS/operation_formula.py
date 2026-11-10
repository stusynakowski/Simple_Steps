"""
operation_formula.py — the app's thin side of formulas; core reads them.

A step is written the way simple-steps-core writes it::

    =scale[mod.map(), mod.retry(times=2)](wf["readings"], weight=2)

**Core reads the text** (``simple_steps_core.formula``): it gives the
operation, pick or value the text writes, refuses anything else in its own
words, and never runs anything. What a formula *means* (which tools exist,
one shape verb per step, a setting's type, which steps it may read) is checked
when the step is assigned to the workflow's kernel (``k.check``), on Enter or
a change in the step editor (core_migration.md §6, D1–D2).

This module keeps only what the UI needs and core doesn't give:

- whether text is core's syntax, a value, or the removed old syntax
  (:func:`is_canonical`, :func:`is_literal`, :func:`not_a_step`);
- where each ``wf["…"]`` is in the text and what argument it fills, for the
  formula bar and the grid's reference boxes (:func:`references`, D5);
- ``/api/parse_formula``'s answer (:func:`describe`) and the step editor's
  *parts*, written back to text by :func:`format_parts` and read back by core.
"""

from __future__ import annotations

import ast
import json
from typing import Any, Dict, List, Optional

from simple_steps_core import FormulaError, Operation  # noqa: F401  (FormulaError is re-exported)
from .core_bridge import formula as _core_formula

#: Shape verbs that read no step: a call with nothing in it can be left out.
NO_INPUT_VERBS = ("source", "sweep")

#: Core's combines, as written: their positional arguments are steps, not inputs.
COMBINES = ("join", "stack", "zip_", "zip")


# ─────────────────────────────────────────────────────────────────────────────
# Reading: core's
# ─────────────────────────────────────────────────────────────────────────────

def read(formula: Optional[str]) -> Any:
    """What *formula* writes, read by core: an :class:`Operation`, a pick, or a
    value. Raises core's :class:`FormulaError`, in core's words."""
    return _core_formula(_body(formula))


def operation_of(value: Any, catalog) -> Any:
    """*value* as the kernel stores it. A pick on its own (``wf["s"][0:2]``) is
    an identity step with a select, as core saves it; anything else as it is."""
    if isinstance(value, Operation) or not _is_pick(value):
        return value
    return Operation.from_spec(_spec(value), catalog)


def resources_of(formula: Optional[str]) -> List[str]:
    """Every resource the text names, ``res["…"]``, in order: the one a bound
    tool runs on, keyword and positional ones alike."""
    try:
        tree = ast.parse(_body(formula), mode="eval")
    except SyntaxError:
        return []
    names = [_quoted(node.slice) for node in ast.walk(tree)
             if isinstance(node, ast.Subscript) and _is_name(node.value, "res")]
    return list(dict.fromkeys(n for n in names if n))


# ─────────────────────────────────────────────────────────────────────────────
# Recognising the syntax
# ─────────────────────────────────────────────────────────────────────────────

def is_canonical(formula: Optional[str]) -> bool:
    """Whether *formula* is written in core's syntax (``wf[…]``, ``res[…]`` or ``mod.``)."""
    body = _body(formula)
    if not body:
        return False
    try:
        tree = ast.parse(body, mode="eval")
    except SyntaxError:
        # Half-typed core syntax gets core's message, not the old syntax's.
        return 'wf[' in body or 'res[' in body or "mod." in body
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript) and (_is_name(node.value, "wf")
                                                or _is_name(node.value, "res")):
            return True
        if isinstance(node, ast.Attribute) and _is_name(node.value, "mod"):
            return True
    return False


#: What a formula in the removed syntax (``=scale(n=step1["n"])``,
#: ``step1["score"][1]``) is told.
OLD_SYNTAX = (
    "this formula is in the old syntax, which was removed. Write it in core's: "
    'tool[mod.map()](wf["step"], …) for a tool over a step, '
    'tool[mod.source()](…) for one with no input'
)


def not_a_step(formula: Optional[str]) -> str:
    """Why a formula that is neither core's syntax nor a value can't be a step:
    Python's own message when it doesn't parse, else :data:`OLD_SYNTAX`."""
    try:
        ast.parse(_body(formula), mode="eval")
    except SyntaxError as exc:
        return f"Invalid expression: {exc.msg}"
    return OLD_SYNTAX


def is_literal(formula: Optional[str]) -> bool:
    """Whether *formula* is a value — ``[1, 2]``, ``{"x": 1}``, ``7``, ``"text"``."""
    body = _body(formula)
    if not body:
        return False
    try:
        ast.literal_eval(body)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return False
    return True


def describe(formula: Optional[str]) -> Dict[str, Any]:
    """A formula as ``/api/parse_formula`` answers it, as you type: whether core
    can read it and why not, the tool, core's operation, the step editor's parts
    and the references. Cheap on purpose (D2): whether the step makes sense in
    its workflow is checked when it's assigned, on Enter."""
    raw = (formula or "").strip()
    out: Dict[str, Any] = {"operationId": None, "orchestration": None, "args": {},
                           "isValid": False, "rawInput": raw,
                           "references": references(formula or "")}
    body = _body(raw)
    if not body:
        return out
    if is_canonical(raw):
        try:
            value = read(raw)
        except FormulaError as exc:
            return {**out, "error": str(exc)}
        spec = _spec(value)
        return {**out, "operationId": spec["tool"].split(".")[-1], "isValid": True,
                "operation": spec, "parts": to_parts(raw, value)}
    if is_literal(raw):
        return {**out, "operationId": "literal", "isValid": True,
                "args": {"expr": body, "_literal": body}}
    return {**out, "error": not_a_step(raw)}


# ─────────────────────────────────────────────────────────────────────────────
# References: where each wf["…"] is, and what it fills (D5)
# ─────────────────────────────────────────────────────────────────────────────

def references(formula: str) -> List[Dict[str, Any]]:
    """Every step reference in *formula*, where it is and what it covers
    (dev_plan/126 F8): ``{"span": [start, end], "step": "r"}``, plus ``rows``
    and ``columns`` (core's spec, read by core) for a pick,
    ``wf["r"][0:2][cols["n"]]`` or ``wf["r"][cols["n"] > 1]``, and
    ``argument``: what the reference is given as, ``"input"`` for a tool's
    input or the keyword it's passed by (``n=wf["r"][cols["n"]]`` → ``"n"``).

    *span* is in characters of *formula* exactly as given, the leading ``=``
    included, so the formula bar can mark each reference and the source grid
    box what it covers. From Python's ``ast``: a formula that names an unknown
    tool still has its references; one that isn't Python yet (mid-typing) has
    none.
    """
    lead = len(formula) - len(formula.lstrip())
    start = lead + 1 if formula[lead:lead + 1] == "=" else lead
    start += len(formula[start:]) - len(formula[start:].lstrip(" \t"))   # spaces after the `=`
    body = formula[start:]
    try:
        tree = ast.parse(body, mode="eval")
    except SyntaxError:
        return []
    lines = body.split("\n")
    line_starts = [0]
    for line in lines[:-1]:
        line_starts.append(line_starts[-1] + len(line) + 1)

    def offset(lineno: int, col: int) -> int:
        # ast's columns are UTF-8 bytes; the formula bar counts characters.
        line = lines[lineno - 1]
        return start + line_starts[lineno - 1] + len(line.encode("utf-8")[:col].decode("utf-8", "ignore"))

    found: List[Dict[str, Any]] = []

    def visit(node: ast.AST, argument: Optional[str] = None) -> None:
        if isinstance(node, ast.Call):
            combine = isinstance(node.func, ast.Name) and node.func.id in COMBINES
            visit(node.func)
            for i, arg in enumerate(node.args):
                visit(arg, "input" if i == 0 and not combine else None)
            for kw in node.keywords:
                visit(kw.value, kw.arg)
            return
        if isinstance(node, ast.Subscript) and _wf_root(node):
            ref = _pick_ref(ast.get_source_segment(body, node) or "")
            if ref is not None:
                span = [offset(node.lineno, node.col_offset), offset(node.end_lineno, node.end_col_offset)]
                found.append({"span": span, **ref, **({"argument": argument} if argument else {})})
            return
        for child in ast.iter_child_nodes(node):
            visit(child, argument)

    visit(tree.body)
    return found


def _pick_ref(text: str) -> Optional[Dict[str, Any]]:
    """``wf["r"]…`` as ``{"step", "rows", "columns"}``, read by core; ``None``
    for a pick core refuses, which covers nothing."""
    try:
        value = _core_formula(text)
    except FormulaError:
        return None
    if not _is_pick(value):
        return None
    ref: Dict[str, Any] = {"step": value.id}
    if value.rows is not None:
        ref["rows"] = value.rows
    if value.columns is not None:
        ref["columns"] = value.columns
    return ref


# ─────────────────────────────────────────────────────────────────────────────
# The step editor's parts: core's operation as the editor edits it
# ─────────────────────────────────────────────────────────────────────────────
#
# Parts keep what the user wrote where core's operation fills things in (an
# inferred verb, a combine's defaults, a positional resource bound by type).
# Modifiers are in WRITTEN order (left to right). ``read(format_parts(p))``
# reads back what *p* says.

def to_parts(formula: str, value: Any) -> Optional[dict]:
    """*value* (what core read from *formula*) as the editor's parts, or
    ``None`` for a form the editor can't show, such as a pick as a tool's
    input: the formula bar still edits it (D6)."""
    if _is_pick(value):
        settings: Dict[str, Any] = {}
        if value.rows is not None:
            settings["rows"] = value.rows
        if value.columns is not None:
            settings["columns"] = (list(value.columns["names"]) if "names" in value.columns
                                   else value.columns)
        return {"tool": "identity", "bound_to": None,
                "modifiers": [{"kind": "select", "params": settings}],
                "input": value.id, "resources": [], "arguments": {}, "inputs": []}
    if not isinstance(value, Operation):
        return None
    call = _call_of(formula)
    spec = value.to_dict()
    arguments = {kw.arg: _part_value(kw.value, formula) for kw in (call.keywords if call else [])}
    if spec.get("inputs"):                               # a combine, by the name it's written with (zip_)
        written = call.func.id if call and isinstance(call.func, ast.Name) else spec["tool"]
        return {"tool": written, "bound_to": None, "modifiers": [], "input": spec["input"]["$ref"],
                "resources": [], "arguments": arguments,
                "inputs": [i["$ref"] for i in spec["inputs"]]}
    args = call.args if call else []
    if args and not _is_plain_ref(args[0]) and _res_of(args[0]) is None:
        return None                                      # a pick or an expression as the input
    head = call.func if call else _tree(formula)
    bracketed = isinstance(head, ast.Subscript) or (isinstance(head, ast.Call) and _mod_call(head))
    bound = spec.get("bound_to")
    return {
        "tool": spec["tool"].split(".")[-1],
        "bound_to": bound["$res"] if bound else None,
        "modifiers": [{"kind": m["kind"], "params": dict(m["settings"])}
                      for m in reversed(spec["modifiers"])] if bracketed else None,
        "input": spec["input"]["$ref"] if spec.get("input") else None,
        "resources": [r for r in (_res_of(a) for a in args) if r],
        "arguments": arguments,
        "inputs": [],
    }


def format_parts(parts: dict) -> str:
    """The editor's parts as a formula; raises :class:`FormulaError` if core
    can't read the result, so the editor can't write an invalid step."""
    tool = parts.get("tool") or ""
    if not tool:
        raise FormulaError("choose a tool")
    inputs = parts.get("inputs") or []
    arguments = parts.get("arguments") or {}
    modifiers = parts.get("modifiers")
    if (tool == "identity" and parts.get("input") and not inputs and not arguments
            and not parts.get("resources") and not parts.get("bound_to")
            and modifiers and len(modifiers) == 1 and modifiers[0]["kind"] == "select"
            and set(modifiers[0].get("params") or {}) <= {"rows", "columns"}
            and modifiers[0].get("params")):
        # A select step, written as core prints it: wf["r"][0:2][cols["n"]].
        settings = dict(modifiers[0]["params"])
        if isinstance(settings.get("columns"), list):
            settings["columns"] = {"names": settings["columns"]}
        formula = _selection_text({"$ref": parts["input"], **settings})
        read(formula)
        return formula
    if inputs:                                           # a combine
        args = [_ref("wf", name) for name in inputs]
        args += [f"{k}={_value(v)}" for k, v in arguments.items()]
        formula = f"{tool}({', '.join(args)})"
    else:
        head = f'{_ref("res", parts["bound_to"])}.{tool}' if parts.get("bound_to") else tool
        if modifiers is not None:
            head += "[" + ", ".join(_modifier(m["kind"], m.get("params") or {}) for m in modifiers) + "]"
        args = [_ref("wf", parts["input"])] if parts.get("input") else []
        args += [_ref("res", name) for name in parts.get("resources") or []]
        args += [f"{k}={_value(v)}" for k, v in arguments.items()]
        # tool[mod.source()] and tool[mod.sweep(…)] read nothing: no call needed.
        no_call = not args and modifiers and any(m["kind"] in NO_INPUT_VERBS for m in modifiers)
        formula = head if no_call else f"{head}({', '.join(args)})"
    read(formula)
    return formula


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _body(formula: Optional[str]) -> str:
    return (formula or "").strip().lstrip("=").strip()


def _tree(formula: str) -> Optional[ast.AST]:
    try:
        return ast.parse(_body(formula), mode="eval").body
    except SyntaxError:
        return None


def _call_of(formula: str) -> Optional[ast.Call]:
    tree = _tree(formula)
    return tree if isinstance(tree, ast.Call) else None


def _is_pick(value: Any) -> bool:
    """A pick of a step, ``wf["s"][…]``: core's step reference."""
    return type(value).__name__ == "StepRef"


def _spec(value: Any) -> dict:
    """Core's operation spec for what it read; a pick as the select it is."""
    if isinstance(value, Operation):
        return value.to_dict()
    parts = to_parts("", value) or {}
    # A plain reference copies the step: every column, as core declares it.
    settings = parts["modifiers"][0]["params"] or {"columns": {"positions": {"start": None, "stop": None}}}
    return {"tool": "identity", "input": {"$ref": parts.get("input")}, "arguments": {},
            "modifiers": [{"kind": "select", "settings": settings}]}


def _is_name(node: ast.AST, name: str) -> bool:
    return isinstance(node, ast.Name) and node.id == name


def _quoted(node: ast.AST) -> Optional[str]:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _wf_root(node: ast.Subscript) -> bool:
    """Whether a subscript chain starts at ``wf[…]``."""
    while isinstance(node, ast.Subscript):
        if _is_name(node.value, "wf"):
            return True
        node = node.value
    return False


def _is_plain_ref(node: ast.AST) -> bool:
    return isinstance(node, ast.Subscript) and _is_name(node.value, "wf") and _quoted(node.slice) is not None


def _res_of(node: ast.AST) -> Optional[str]:
    if isinstance(node, ast.Subscript) and _is_name(node.value, "res"):
        return _quoted(node.slice)
    return None


def _mod_call(node: ast.Call) -> bool:
    """``mod.sort(by="n")(wf["s"])``: core's printed form of a no-tool verb."""
    return isinstance(node.func, ast.Attribute) and _is_name(node.func.value, "mod")


def _part_value(node: ast.AST, formula: str) -> Any:
    """A keyword argument as the editor holds it: a literal, a step, a resource,
    or anything else as its text (``{"$expr": …}``), which core reads back."""
    if _is_plain_ref(node):
        return {"$ref": _quoted(node.slice)}
    if _res_of(node) is not None:
        return {"$res": _res_of(node)}
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return {"$expr": ast.get_source_segment(_body(formula), node) or ast.unparse(node)}


def _ref(kind: str, name: str) -> str:
    return f"{kind}[{_lit(name)}]"


def _value(v: Any) -> str:
    """A tool argument: a reference, a resource, text core reads, or a literal."""
    if isinstance(v, dict) and set(v) == {"$ref"}:
        return _ref("wf", v["$ref"])
    if isinstance(v, dict) and "$ref" in v and set(v) <= {"$ref", "rows", "columns"}:
        return _selection_text(v)
    if isinstance(v, dict) and set(v) == {"$res"}:
        return _ref("res", v["$res"])
    if isinstance(v, dict) and set(v) == {"$expr"}:
        return str(v["$expr"])
    return _lit(v)


def _modifier(kind: str, params: Dict[str, Any]) -> str:
    """One modifier as written: ``mod.map()``, ``mod.name("score")``."""
    if kind == "name" and set(params) == {"to"}:
        return f"mod.name({_lit(params['to'])})"
    return f"mod.{kind}({', '.join(f'{k}={_lit(v)}' for k, v in params.items())})"


def _selection_text(v: dict) -> str:
    """A pick as written: ``wf["r"][0:2][cols["n"]]``. (Core prints a pick only
    as part of a step, so the editor's select step is written here.)"""
    text = _ref("wf", v["$ref"])
    rows = v.get("rows")
    if isinstance(rows, dict) and set(rows) <= {"start", "stop"}:
        text += f'[{"" if rows.get("start") is None else rows["start"]}:{"" if rows.get("stop") is None else rows["stop"]}]'
    elif rows is not None:
        text += f"[{_lit(rows)}]"
    columns = v.get("columns")
    if columns is not None:
        if "names" in columns:
            names = columns["names"]
            text += f"[cols[{_lit(names[0]) if len(names) == 1 else _lit(list(names))}]]"
        else:
            text += f'[cols[{_lit(columns["from"])}:{_lit(columns["to"])}]]'
    return text


def _lit(v: Any) -> str:
    """A Python literal that ``ast.literal_eval`` reads back as *v*. Strings
    use double quotes, as the saved workflows do — single when the text holds
    double quotes (JSON, say), so it reads without escapes."""
    if isinstance(v, str):
        if '"' in v and "'" not in v:
            return repr(v)
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, list):
        return "[" + ", ".join(_lit(x) for x in v) + "]"
    if isinstance(v, tuple):
        return "(" + ", ".join(_lit(x) for x in v) + ("," if len(v) == 1 else "") + ")"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{_lit(k)}: {_lit(x)}" for k, x in v.items()) + "}"
    return repr(v)
