"""
operation_formula.py — formulas in core's operation syntax.

A step written the way simple-steps-core writes it::

    =scale[mod.map(name="score"), mod.retry(times=2)](wf["readings"], weight=2)
     └┬─┘ └───────────────┬─────────────────────────┘ └──────┬──────┘ └───┬───┘
     tool          modifier stack                         the input    arguments

compiles straight to core's operation JSON::

    {"tool_id": "scale",
     "input": {"$ref": "readings"},
     "arguments": {"weight": 2},
     "modifiers": [{"kind": "retry", "params": {"times": 2}},
                   {"kind": "map", "params": {"name": "score"}}]}

The rule (``docs/dev_plan/120-literals-and-references.md``): **a reference is
``wf["<step name>"]``; everything else is a literal.** A reference is the
call's input, or a keyword argument (a value read from another step). It is
never a modifier setting, a bare name, or a string.

Forms:

==========================================  ===================================
``tool[mod.verb(…), …](wf["x"], k=v)``      the canonical form
``tool[mod.source()](k=v)``                 a source: no input
``tool[mod.sweep(a=[…], b=[…])]``           a sweep: no input, no call needed
``tool(wf["x"], k=v)``                      the verb is inferred from the tool
==========================================  ===================================

Built-in tools are written by name: ``identity[mod.select(…)]``,
``count[mod.collapse()]``, ``gather``, ``total``, ``first``, ``last``.

Formulas without ``wf[…]`` or ``mod.`` are not this syntax; they keep going
through ``formula_parser`` / ``safe_formula`` as before.

Nothing here runs anything: :func:`compile_formula` is pure, so the formula
bar can validate as you type. ``grid_runner.run_formula`` runs the result.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from simple_steps_core import grid

#: Shape verbs that read no step.
NO_INPUT_VERBS = ("source", "sweep")


class FormulaError(ValueError):
    """A formula in core's syntax that can't be compiled, with the reason."""


@dataclass
class Compiled:
    """A formula, as the parts of a core operation."""

    tool_id: str
    #: Core's order: innermost first. ``None`` when the verb is to be inferred.
    modifiers: Optional[List[dict]]
    #: The step whose grid this reads, or ``None`` (source, sweep).
    input: Optional[str]
    #: Literals, or ``{"$ref": name}`` for a value read from another step.
    arguments: Dict[str, Any] = field(default_factory=dict)

    @property
    def verb(self) -> Optional[str]:
        """The shape verb, or ``None`` when it is to be inferred."""
        if self.modifiers is None:
            return None
        shapes = [m["kind"] for m in self.modifiers if m["kind"] in grid.SHAPE_VERBS]
        return shapes[-1] if shapes else None

    @property
    def reads(self) -> List[str]:
        """Every step this reads: its input, then any argument references."""
        names = [self.input] if self.input is not None else []
        names += [v["$ref"] for v in self.arguments.values() if _is_ref(v)]
        return list(dict.fromkeys(names))

    def operation(self, inferred_verb: Optional[str] = None) -> dict:
        """Core's operation JSON. *inferred_verb* fills in an inferred form."""
        modifiers = self.modifiers
        if modifiers is None:
            modifiers = [{"kind": inferred_verb or "map", "params": {}}]
        return {
            "tool_id": self.tool_id,
            "input": {"$ref": self.input} if self.input is not None else None,
            "arguments": dict(self.arguments),
            "modifiers": [dict(m) for m in modifiers],
        }


# ─────────────────────────────────────────────────────────────────────────────
# Recognising the syntax
# ─────────────────────────────────────────────────────────────────────────────

def is_canonical(formula: Optional[str]) -> bool:
    """Whether *formula* is written in core's syntax (uses ``wf[…]`` or ``mod.``)."""
    body = _body(formula)
    if not body:
        return False
    try:
        tree = ast.parse(body, mode="eval")
    except SyntaxError:
        # Half-typed core syntax should get this module's messages.
        return 'wf[' in body or "mod." in body
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript) and _is_name(node.value, "wf"):
            return True
        if isinstance(node, ast.Attribute) and _is_name(node.value, "mod"):
            return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Compiling
# ─────────────────────────────────────────────────────────────────────────────

def compile_formula(formula: str) -> Compiled:
    """Compile a formula in core's syntax, or raise :class:`FormulaError`."""
    body = _body(formula)
    try:
        tree = ast.parse(body, mode="eval").body
    except SyntaxError as exc:
        raise FormulaError(f"Invalid expression: {exc.msg}") from None

    if isinstance(tree, ast.Call):
        func = tree.func
        if isinstance(func, ast.Subscript):              # tool[mods](…)
            if _wf_name(func) is not None:
                raise FormulaError(
                    'a step reference can\'t be called. Write the tool first: '
                    f'tool[mod.map()]({ast.unparse(func)})'
                )
            return _with_call(_tool_name(func.value), _modifiers(func.slice), tree)
        if isinstance(func, ast.Name):                   # tool(wf["x"], …): inferred
            return _with_call(func.id, None, tree)
        raise FormulaError(f"{ast.unparse(func)} is not a tool")

    if isinstance(tree, ast.Subscript):
        name = _wf_name(tree)
        if name is not None:
            raise FormulaError(
                f'wf["{name}"] on its own is a reference, not a step. To copy it, '
                f'write identity[mod.slice()](wf["{name}"])'
            )
        _reject_column_ref(tree)
        tool = _tool_name(tree.value)                    # tool[mods]: no input
        modifiers = _modifiers(tree.slice)
        compiled = Compiled(tool, modifiers, None, {})
        verb = compiled.verb
        if verb not in NO_INPUT_VERBS:
            raise FormulaError(
                f'{verb or "this"} reads a step: {tool}[{_written(modifiers)}](wf["…"])'
            )
        return compiled

    raise FormulaError(
        'expected tool[mod.verb(…)](wf["…"], …) — a tool, its modifiers in '
        "brackets, and a call with the step it reads"
    )


def _with_call(tool: str, modifiers: Optional[List[dict]], call: ast.Call) -> Compiled:
    if any(isinstance(a, ast.Starred) for a in call.args) or any(k.arg is None for k in call.keywords):
        raise FormulaError("*args and **kwargs aren't allowed in a formula")
    if len(call.args) > 1:
        raise FormulaError(
            "a step reads one input; combining two steps needs a merge verb, "
            "which core doesn't have yet"
        )
    input_name = _input_ref(call.args[0]) if call.args else None
    arguments = {kw.arg: _argument(kw.value, kw.arg) for kw in call.keywords}
    compiled = Compiled(tool, modifiers, input_name, arguments)

    verb = compiled.verb
    if modifiers is not None:
        if verb is None:
            raise FormulaError(
                "the brackets need a shape verb (map, filter, select, …); "
                "retry and timeout only wrap one"
            )
        if verb in NO_INPUT_VERBS and input_name is not None:
            raise FormulaError(f"{verb} takes no input: {tool}[{_written(modifiers)}](…)")
        if verb not in NO_INPUT_VERBS and input_name is None:
            raise FormulaError(f'{verb} reads a step: {tool}[{_written(modifiers)}](wf["…"])')
    return compiled


def _modifiers(node: ast.AST) -> List[dict]:
    """``mod.map(name="x"), mod.retry(times=2)`` → core's list, innermost first."""
    items = node.elts if isinstance(node, ast.Tuple) else [node]
    written: List[dict] = []
    for item in items:
        if not (isinstance(item, ast.Call) and isinstance(item.func, ast.Attribute)
                and _is_name(item.func.value, "mod")):
            raise FormulaError(
                f"{ast.unparse(item)} isn't a modifier; write mod.map(…), "
                "mod.select(…), mod.retry(…), …"
            )
        kind = item.func.attr
        if kind not in grid.MODIFIERS:
            raise FormulaError(
                f"unknown modifier mod.{kind}; core's are "
                f"{', '.join('mod.' + k for k in sorted(grid.MODIFIERS))}"
            )
        if item.args:
            raise FormulaError(f"mod.{kind}(…) takes keyword settings, e.g. mod.{kind}(name=\"x\")")
        params: Dict[str, Any] = {}
        for kw in item.keywords:
            if kw.arg is None:
                raise FormulaError("**kwargs aren't allowed in a formula")
            if kw.arg == "over":
                raise FormulaError(
                    "write the input once, in the call: "
                    f'tool[mod.{kind}()](wf["…"]), not over= inside the brackets'
                )
            params[kw.arg] = _setting(kw.value, kind, kw.arg)
        written.append({"kind": kind, "params": params})
    return list(reversed(written))      # core stores innermost first


# ─────────────────────────────────────────────────────────────────────────────
# References and literals
# ─────────────────────────────────────────────────────────────────────────────

def _input_ref(node: ast.AST) -> str:
    """The call's input: must be ``wf["name"]``."""
    name = _wf_name(node)
    if name is not None:
        return name
    _reject_column_ref(node)
    if isinstance(node, ast.Call):
        raise FormulaError(
            "an operation can't be an input yet (core's P0); make it its own "
            'step and pass wf["…"]'
        )
    if isinstance(node, ast.Name):
        raise FormulaError(
            f'{node.id} is not defined. To use the step "{node.id}", write wf["{node.id}"]'
        )
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        raise FormulaError(
            f'the input must be a step reference; "{node.value}" is a string. '
            f'Did you mean wf["{node.value}"]?'
        )
    raise FormulaError(f'the input must be a step reference, wf["…"], not {ast.unparse(node)}')


def _argument(node: ast.AST, name: str) -> Any:
    """A tool argument: a literal, or ``wf["x"]`` for another step's value."""
    ref = _wf_name(node)
    if ref is not None:
        return {"$ref": ref}
    _reject_column_ref(node)
    if isinstance(node, ast.Call):
        raise FormulaError(
            f"{name}: an operation can't be an argument; make it its own step "
            'and pass wf["…"]'
        )
    if isinstance(node, ast.Name) and node.id not in ("True", "False", "None"):
        raise FormulaError(
            f'{name}={node.id}: {node.id} is not defined. A step is wf["{node.id}"]; '
            f'text is "{node.id}"'
        )
    try:
        return ast.literal_eval(node)
    except ValueError:
        raise FormulaError(
            f'{name} must be a literal (text, a number, a list, …) or wf["…"], '
            f"not {ast.unparse(node)}"
        ) from None


def _setting(node: ast.AST, kind: str, name: str) -> Any:
    """A modifier setting: always a literal."""
    if _wf_name(node) is not None:
        raise FormulaError(
            f"mod.{kind}({name}=…) is a setting, and settings are literals. "
            "A step reference goes in the call"
        )
    if isinstance(node, ast.Name) and node.id not in ("True", "False", "None"):
        raise FormulaError(f'mod.{kind}({name}={node.id}): text needs quotes, "{node.id}"')
    try:
        return ast.literal_eval(node)
    except ValueError:
        raise FormulaError(
            f"mod.{kind}({name}=…) must be a literal, not {ast.unparse(node)}"
        ) from None


def _reject_column_ref(node: ast.AST) -> None:
    """``wf["x"]["n"]`` — there are no column references."""
    if isinstance(node, ast.Subscript) and _wf_name(node.value) is not None:
        step = _wf_name(node.value)
        raise FormulaError(
            f'wf["{step}"][…]: there are no column or row references. Make a '
            f'select step — identity[mod.select(columns=[…])](wf["{step}"]) — '
            "and read that"
        )


def _wf_name(node: ast.AST) -> Optional[str]:
    """``wf["name"]`` → ``"name"``; anything else → ``None``."""
    if isinstance(node, ast.Subscript) and _is_name(node.value, "wf"):
        key = node.slice
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            return key.value
        raise FormulaError('wf[…] takes a step name in quotes: wf["readings"]')
    return None


def _tool_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        if node.id in ("wf", "mod"):
            raise FormulaError(f"{node.id} isn't a tool")
        return node.id
    raise FormulaError(f"{ast.unparse(node)} is not a tool name")


def _is_name(node: ast.AST, name: str) -> bool:
    return isinstance(node, ast.Name) and node.id == name


def _is_ref(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"$ref"}


def _body(formula: Optional[str]) -> str:
    return (formula or "").strip().lstrip("=").strip()


def _written(modifiers: List[dict]) -> str:
    """The modifier stack as written (outermost first), for messages."""
    parts = []
    for m in reversed(modifiers):
        settings = ", ".join(f"{k}={v!r}" for k, v in m["params"].items())
        parts.append(f"mod.{m['kind']}({settings})")
    return ", ".join(parts)
