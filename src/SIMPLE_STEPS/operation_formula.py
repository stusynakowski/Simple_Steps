"""
operation_formula.py — formulas in core's operation syntax.

A step written the way simple-steps-core writes it::

    =scale[mod.map(name="score"), mod.retry(times=2)](wf["readings"], weight=2)
     └┬─┘ └───────────────┬─────────────────────────┘ └──────┬──────┘ └───┬───┘
     tool          modifier stack                         the input    arguments

compiles straight to core's operation spec (``Operation.from_spec``)::

    {"tool": "scale",
     "input": {"$ref": "readings"},
     "arguments": {"weight": 2},
     "modifiers": [{"kind": "retry", "settings": {"times": 2}},
                   {"kind": "map", "settings": {"name": "score"}}]}

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
``join(wf["a"], wf["b"], on="k")``          a combine: reads several steps
``stack(wf["a"], wf["b"], …)``              (``join`` / ``stack`` / ``zip_``)
``zip_(wf["a"], wf["b"], …)``
==========================================  ===================================

**Resources** (core 007) are ``res["name"]``, declared in the workflow's
``resources`` section:

==============================================  ===============================
``tool[mod.map()](wf["x"], llm=res["claude"])``   an unbound tool taking a resource
``tool[mod.map()](wf["x"], res["claude"])``       the same, matched by type at run
``res["db"].lookup[mod.map()](wf["x"])``          a bound tool: a marked method
``res["db"].query(sql="…")``                      the same, verb inferred
==============================================  ===============================

The rule becomes: ``wf["…"]`` is a table, ``res["…"]`` is a resource, everything
else is a literal. A resource is never a modifier setting or a combine setting.

A combine is core's own constructor (``join`` / ``stack`` / ``zip_``),
not a tool: it takes no modifiers, its positional arguments are the steps it
reads, and its keyword settings are literals. Those names are therefore
reserved — a tool called ``join`` can still be written with brackets,
``join[mod.map()](wf["x"])``, but not called bare.

Built-in tools are written by name: ``identity[mod.select(…)]``,
``count[mod.collapse()]``, ``gather``, ``total``, ``first``, ``last``.

A step is also a value: ``=[1, 2]``, ``={"x": 1}``, ``=7`` (:func:`is_literal`).
Anything else is the old syntax, which was removed (:data:`OLD_SYNTAX`).

Nothing here runs anything: :func:`compile_formula` is pure, so the formula
bar can validate as you type. ``grid_runner.run_formula`` runs the result.
"""

from __future__ import annotations

import ast
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from simple_steps_core import join, stack, wf, zip_

from .core_bridge import check_modifier, shape_verbs


#: Shape verbs that read no step.
NO_INPUT_VERBS = ("source", "sweep")

#: Combine verbs (core 005 B), as written → core's constructor. ``zip`` is
#: accepted too: core's tool is ``zip``; ``zip_`` is only Python's spelling.
COMBINES = {"join": join, "stack": stack, "zip_": zip_, "zip": zip_}


def _modifier_catalog() -> Dict[str, dict]:
    """Core's modifiers, from the app's catalog: name → class, settings, tool."""
    from .catalog import modifiers
    return modifiers()


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
    #: Every step a combine reads, primary first (``input`` is the first);
    #: empty for an ordinary single-input step.
    inputs: List[str] = field(default_factory=list)
    #: For a bound tool (``res["db"].lookup``): the resource it runs on.
    #: ``tool_id`` is then the method name, qualified with the resource's type
    #: (``FakeDB.lookup``) once the declarations are known — see :meth:`operation`.
    bound_to: Optional[str] = None
    #: Resources passed by position (``tool(wf["x"], res["llm"])``). Core takes
    #: keywords only, so the runner binds each to the parameter whose type fits.
    positional_resources: List[str] = field(default_factory=list)

    @property
    def resources(self) -> List[str]:
        """Every resource this uses: the one it's bound to, then its arguments."""
        names = [self.bound_to] if self.bound_to else []
        names += [v["$res"] for v in self.arguments.values() if _is_res(v)]
        names += self.positional_resources
        return list(dict.fromkeys(names))

    @property
    def is_combine(self) -> bool:
        """A ``join`` / ``stack`` / ``zip`` — reads several steps, applies no tool."""
        return bool(self.inputs)

    @property
    def verb(self) -> Optional[str]:
        """The shape verb (a combine's kind) — ``"auto"`` for ``mod.auto()`` —
        or ``None`` when there are no brackets."""
        if self.is_combine:
            return self.tool_id
        if self.modifiers is None:
            return None
        shapes = [m["kind"] for m in self.modifiers if m["kind"] in shape_verbs()]
        return shapes[-1] if shapes else None

    @property
    def needs_inference(self) -> bool:
        """Whether the runner must pick the verb: no brackets. ``mod.auto()``
        is core's, and core resolves it each run."""
        return self.modifiers is None and not self.is_combine

    @property
    def reads(self) -> List[str]:
        """Every step this reads: its input(s), then any argument references."""
        names = list(self.inputs) or ([self.input] if self.input is not None else [])
        names += [v["$ref"] for v in self.arguments.values() if _is_ref(v)]
        return list(dict.fromkeys(names))

    def operation(self, inferred_verb: Optional[str] = None,
                  bound_type: Optional[str] = None) -> dict:
        """Core's operation spec. *inferred_verb* fills in an inferred form;
        *bound_type* is the declared type of :attr:`bound_to`, which qualifies a
        bound tool's name (``FakeDB.lookup``)."""
        modifiers = self.modifiers
        if modifiers is None:
            modifiers = [{"kind": inferred_verb or "map", "params": {}}]
        tool = self.tool_id
        if self.bound_to and bound_type:
            tool = f"{bound_type}.{self.tool_id}"
        operation = {
            "tool": tool,
            "input": {"$ref": self.input} if self.input is not None else None,
            "arguments": dict(self.arguments),
            "modifiers": [{"kind": m["kind"], "settings": dict(m["params"])} for m in modifiers],
        }
        if self.inputs:
            operation["inputs"] = [{"$ref": name} for name in self.inputs]
        if self.bound_to:
            operation["bound_to"] = {"$res": self.bound_to}
        return operation


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
        # Half-typed core syntax should get this module's messages.
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
    """A formula as ``/api/parse_formula`` answers it: the tool, whether it is
    valid and why not, core's operation, and the step editor's parts."""
    raw = (formula or "").strip()
    out: Dict[str, Any] = {"operationId": None, "orchestration": None, "args": {},
                           "isValid": False, "rawInput": raw}
    body = _body(raw)
    if not body:
        return out
    if is_canonical(raw):
        try:
            compiled = compile_formula(raw)
        except FormulaError as exc:
            return {**out, "error": str(exc)}
        return {**out, "operationId": compiled.tool_id, "isValid": True,
                "operation": compiled.operation(), "parts": to_parts(compiled)}
    if is_literal(raw):
        return {**out, "operationId": "literal", "isValid": True,
                "args": {"expr": body, "_literal": body}}
    return {**out, "error": not_a_step(raw)}


# ─────────────────────────────────────────────────────────────────────────────
# Compiling
# ─────────────────────────────────────────────────────────────────────────────

_DEFINES_RESOURCE = re.compile(r"^res\s*\[[^\]]*\]\s*=(?!=)")


def compile_formula(formula: str) -> Compiled:
    """Compile a formula in core's syntax, or raise :class:`FormulaError`."""
    body = _body(formula)
    if _DEFINES_RESOURCE.match(body):
        # A resource belongs to the workflow, never to a step.
        raise FormulaError(
            "a step can use a resource but not create one. Create it from the "
            "Resources menu in the toolbar, or in the console: "
            'res["name"] = Type(setting=…)'
        )
    try:
        tree = ast.parse(body, mode="eval").body
    except SyntaxError as exc:
        raise FormulaError(f"Invalid expression: {exc.msg}") from None

    if isinstance(tree, ast.Call):
        func = tree.func
        if isinstance(func, ast.Subscript) and _bound(func.value):   # res["db"].tool[mods](…)
            resource, method = _bound(func.value)
            return _with_call(method, _modifiers(func.slice), tree, bound_to=resource)
        if _bound(func):                                 # res["db"].tool(…): inferred
            resource, method = _bound(func)
            return _with_call(method, None, tree, bound_to=resource)
        if isinstance(func, ast.Subscript) and _res_name(func) is not None:
            raise FormulaError(
                f'res["{_res_name(func)}"] is a resource, not a tool. Call one of its '
                f'tools, res["{_res_name(func)}"].<tool>(…), or pass it to a tool'
            )
        if isinstance(func, ast.Subscript):              # tool[mods](…)
            if _wf_name(func) is not None:
                raise FormulaError(
                    'a step reference can\'t be called. Write the tool first: '
                    f'tool[mod.map()]({ast.unparse(func)})'
                )
            return _with_call(_tool_name(func.value), _modifiers(func.slice), tree)
        if isinstance(func, ast.Name) and func.id in COMBINES:   # join(wf["a"], wf["b"], …)
            return _combine(func.id, tree)
        if isinstance(func, ast.Name):                   # tool(wf["x"], …): inferred
            return _with_call(func.id, None, tree)
        raise FormulaError(f"{ast.unparse(func)} is not a tool")

    if isinstance(tree, ast.Subscript) and _bound(tree.value):   # res["llm"].tool[mod.source()]
        resource, method = _bound(tree.value)
        compiled = Compiled(method, _modifiers(tree.slice), None, {}, bound_to=resource)
        _check_stack(compiled.modifiers, method, f'res["{resource}"].{method}')
        if compiled.verb not in NO_INPUT_VERBS:
            raise FormulaError(
                f'{compiled.verb or "this"} reads a step: '
                f'res["{resource}"].{method}[{_written(compiled.modifiers)}](wf["…"])'
            )
        return compiled

    if isinstance(tree, ast.Subscript) and _res_name(tree) is not None:
        name = _res_name(tree)
        raise FormulaError(
            f'res["{name}"] on its own is a resource, not a step. Use one of its tools, '
            f'res["{name}"].<tool>(…), or pass it to a tool: tool[mod.map()](wf["…"], res["{name}"])'
        )

    if isinstance(tree, ast.Subscript):
        name = _wf_name(tree)
        if name is not None:
            raise FormulaError(
                f'wf["{name}"] on its own is a reference, not a step. To copy it, '
                f'write identity[mod.slice()](wf["{name}"])'
            )
        picked = _selection(tree)
        if picked is not None:                           # wf["r"][0:2][cols["n"]]: a select step
            step, sel = picked
            settings = dict(sel)
            if "columns" in settings and "names" in settings["columns"]:
                settings["columns"] = list(settings["columns"]["names"])
            return Compiled("identity", [{"kind": "select", "params": settings}], step, {})
        tool = _tool_name(tree.value)                    # tool[mods]: no input
        modifiers = _modifiers(tree.slice)
        compiled = Compiled(tool, modifiers, None, {})
        _check_stack(modifiers, tool, tool)
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


def _with_call(tool: str, modifiers: Optional[List[dict]], call: ast.Call,
               bound_to: Optional[str] = None) -> Compiled:
    if any(isinstance(a, ast.Starred) for a in call.args) or any(k.arg is None for k in call.keywords):
        raise FormulaError("*args and **kwargs aren't allowed in a formula")
    # Positional arguments: at most one step (the input, first), then any
    # resources — res["…"] — which the runner binds to parameters by type.
    positional = list(call.args)
    input_name = None
    if positional and _res_name(positional[0]) is None:
        input_name = _input_ref(positional.pop(0))
    resources = []
    for arg in positional:
        name = _res_name(arg)
        if name is not None:
            resources.append(name)
        elif _wf_name(arg) is not None:
            raise FormulaError(
                "a step reads one input; to combine steps use join(wf[\"a\"], wf[\"b\"], on=…), "
                "stack(wf[\"a\"], wf[\"b\"]) or zip_(wf[\"a\"], wf[\"b\"])"
            )
        else:
            raise FormulaError(
                f"after the input, only resources go by position (res[\"…\"]); "
                f"give {ast.unparse(arg)} a name: {tool}(…, name={ast.unparse(arg)})"
            )
    arguments = {kw.arg: _argument(kw.value, kw.arg) for kw in call.keywords}
    compiled = Compiled(tool, modifiers, input_name, arguments,
                        bound_to=bound_to, positional_resources=resources)

    verb = compiled.verb
    if modifiers is not None:
        _check_stack(modifiers, tool, f'res["{bound_to}"].{tool}' if bound_to else tool)
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


def _combine(name: str, call: ast.Call) -> Compiled:
    """``join(wf["a"], wf["b"], on="k")`` → core's combine operation.

    Built with core's own constructor, so its defaults (``how="inner"``,
    ``join="outer"``, …) and its signature are core's, never a copy.
    """
    if any(isinstance(a, ast.Starred) for a in call.args) or any(k.arg is None for k in call.keywords):
        raise FormulaError("*args and **kwargs aren't allowed in a formula")
    if not call.args:
        raise FormulaError(f'{name} reads steps: {name}(wf["a"], wf["b"], …)')
    inputs = [_combine_input(arg, name) for arg in call.args]
    settings = {kw.arg: _setting_of(name, kw.arg, kw.value) for kw in call.keywords}
    try:
        spec = COMBINES[name](*(wf[i] for i in inputs), **settings).to_dict()
    except (TypeError, ValueError) as exc:
        raise FormulaError(f"{name}: {exc}") from None
    return Compiled(spec["tool"], [], inputs[0], dict(spec.get("arguments") or {}), inputs)


def _combine_input(node: ast.AST, name: str) -> str:
    """A combine's positional argument: a step, ``wf["x"]``."""
    ref = _wf_name(node)
    if ref is not None:
        return ref
    _reject_column_ref(node)
    raise FormulaError(
        f'{name} combines steps; each positional argument is wf["…"], '
        f"not {ast.unparse(node)}. Settings go by keyword, e.g. on=\"city\""
    )


def _setting_of(name: str, key: str, node: ast.AST) -> Any:
    """A combine setting: a literal, like a modifier's."""
    if _res_name(node) is not None:
        raise FormulaError(f"{name} applies no tool, so it takes no resource")
    if _wf_name(node) is not None:
        raise FormulaError(
            f"{name}({key}=…) is a setting, and settings are literals. The steps "
            f"it combines go first, as positional wf[\"…\"]"
        )
    if isinstance(node, ast.Name) and node.id not in ("True", "False", "None"):
        raise FormulaError(f'{name}({key}={node.id}): text needs quotes, "{node.id}"')
    try:
        return ast.literal_eval(node)
    except ValueError:
        raise FormulaError(f"{name}({key}=…) must be a literal, not {ast.unparse(node)}") from None


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
        known = _modifier_catalog()
        if kind not in known:
            raise FormulaError(
                f"unknown modifier mod.{kind}; the modifiers are "
                f"{', '.join('mod.' + k for k in sorted(known))}"
            )
        params: Dict[str, Any] = {}
        if item.args:
            # mod.name("score"), mod.name(["a", "b"]): the one positional
            # setting core has, which it calls `to`.
            if kind != "name" or len(item.args) != 1:
                raise FormulaError(f"mod.{kind}(…) takes keyword settings, e.g. mod.{kind}(by=\"x\")")
            params["to"] = _setting(item.args[0], kind, "to")
        for kw in item.keywords:
            if kw.arg is None:
                raise FormulaError("**kwargs aren't allowed in a formula")
            if kw.arg == "over":
                raise FormulaError(
                    "write the input once, in the call: "
                    f'tool[mod.{kind}()](wf["…"]), not over= inside the brackets'
                )
            params[kw.arg] = _setting(kw.value, kind, kw.arg)
        _check_settings(kind, params)
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
    """A tool argument: a literal, ``wf["x"]`` for another step's value, or
    ``res["x"]`` for a resource."""
    ref = _wf_name(node)
    if ref is not None:
        return {"$ref": ref}
    resource = _res_name(node)
    if resource is not None:
        return {"$res": resource}
    picked = _selection(node)
    if picked is not None:                               # n=wf["r"][cols["n"]]: part of a step
        step, sel = picked
        return {"$ref": step, **sel}
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


def _check_settings(kind: str, params: Dict[str, Any]) -> None:
    """A modifier's settings, checked as you type rather than when it runs."""
    problems = check_modifier(kind, params)
    if problems:
        raise FormulaError("; ".join(problems))


def _check_stack(modifiers: List[dict], tool: str, written: str) -> None:
    """Core's rules for the brackets, checked as you type rather than at Run:
    one shape verb per step, and a verb that applies no tool keeps its own
    (``identity[mod.select(…)]``). *written* is the tool as the formula
    spells it, for the message."""
    catalog = _modifier_catalog()
    shapes = [m["kind"] for m in reversed(modifiers) if m["kind"] in shape_verbs()]
    if len(shapes) > 1:
        raise FormulaError(
            f"{len(shapes)} shape verbs in one step ({', '.join(shapes)}); at most one "
            "is allowed. Split them into separate steps, the second reading the first "
            'with wf["…"]'
        )
    if not shapes:
        return
    verb, info = shapes[0], catalog[shapes[0]]
    if info.get("takes_tool") is False and tool != info.get("default_tool"):
        default = info["default_tool"]
        raise FormulaError(
            f"{verb} applies no tool, so it runs on {default}: "
            f'{default}[{_written(modifiers)}](wf["…"]). To compute with {written}, '
            f'use map: {written}[mod.map()](wf["…"])'
        )


def _setting(node: ast.AST, kind: str, name: str) -> Any:
    """A modifier setting: always a literal."""
    if _res_name(node) is not None:
        raise FormulaError(
            f"mod.{kind}({name}=…) is a setting, and settings are literals. "
            "A resource goes in the call: tool[…](wf[\"…\"], name=res[\"…\"])"
        )
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
    """A selection as a tool's input (``tool(wf["x"][cols["n"]])``): core
    refuses it, so say so here, with its remedy."""
    picked = _selection(node) if isinstance(node, ast.Subscript) else None
    if picked is not None:
        written = _selection_text({"$ref": picked[0], **picked[1]})
        raise FormulaError(
            f"a selection can't be a tool's input: make it its own step, whose formula "
            f"is {written}, and pass that step. As an argument it works: "
            f'tool(wf["…"], n={written})'
        )


def _selection(node: ast.AST) -> Optional[tuple]:
    """``wf["r"][0:2][cols["n"]]`` → ``("r", {"rows": …, "columns": …})`` in core's
    spec (dev_plan/126 D1, F7); ``None`` for anything that isn't one.

    Rows go by core's row id: ``[1]``, ``[[0, 2]]``, ``[1:3]``. Columns are
    ``cols["n"]``, ``cols[["a", "b"]]`` or ``cols["a":"b"]``. Syntax only:
    whether the rows and columns exist is core's check.
    """
    picks = []
    while isinstance(node, ast.Subscript) and not _is_name(node.value, "wf"):
        picks.append(node.slice)
        node = node.value
    if not picks or not (isinstance(node, ast.Subscript) and _is_name(node.value, "wf")):
        return None
    step = _wf_name(node)
    sel: Dict[str, Any] = {}
    for pick in reversed(picks):
        kind, value = _pick(pick, step)
        if kind in sel:
            raise FormulaError(f'wf["{step}"]: pick the {kind} once, e.g. wf["{step}"][0:2][cols["n"]]')
        sel[kind] = value
    return step, sel


def _pick(node: ast.AST, step: str) -> tuple:
    """One subscript of a selection: ``("rows", …)`` or ``("columns", …)``."""
    if isinstance(node, ast.Subscript) and _is_name(node.value, "cols"):
        key = node.slice
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            return "columns", {"names": [key.value]}
        if isinstance(key, (ast.List, ast.Tuple)) and all(
                isinstance(e, ast.Constant) and isinstance(e.value, str) for e in key.elts):
            return "columns", {"names": [e.value for e in key.elts]}
        if (isinstance(key, ast.Slice) and key.step is None
                and all(isinstance(e, ast.Constant) and isinstance(e.value, str) for e in (key.lower, key.upper))):
            return "columns", {"from": key.lower.value, "to": key.upper.value}
        raise FormulaError('cols[…] takes a column name, a list of names or a range: '
                           'cols["n"], cols[["a", "b"]], cols["a":"b"]')
    if isinstance(node, ast.Slice):
        if node.step is not None:
            raise FormulaError(f'wf["{step}"][a:b]: a range of rows takes no step')
        ends = []
        for end in (node.lower, node.upper):
            if end is not None and not (isinstance(end, ast.Constant) and isinstance(end.value, int)):
                raise FormulaError(f'wf["{step}"][a:b]: a range of rows is two numbers, either one left out')
            ends.append(None if end is None else end.value)
        return "rows", {"start": ends[0], "stop": ends[1]}
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, str)) and not isinstance(node.value, bool):
        return "rows", node.value
    if isinstance(node, ast.List) and all(isinstance(e, ast.Constant) and isinstance(e.value, (int, str)) for e in node.elts):
        return "rows", [e.value for e in node.elts]
    raise FormulaError(f'wf["{step}"][…] takes rows ([1], [[0, 2]], [1:3]) or columns (cols["n"])')


def _wf_name(node: ast.AST) -> Optional[str]:
    """``wf["name"]`` → ``"name"``; anything else → ``None``."""
    if isinstance(node, ast.Subscript) and _is_name(node.value, "wf"):
        key = node.slice
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            return key.value
        raise FormulaError('wf[…] takes a step name in quotes: wf["readings"]')
    return None


def _res_name(node: ast.AST) -> Optional[str]:
    """``res["name"]`` → ``"name"``; anything else → ``None``."""
    if isinstance(node, ast.Subscript) and _is_name(node.value, "res"):
        key = node.slice
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            return key.value
        raise FormulaError('res[…] takes a resource name in quotes: res["db"]')
    return None


def _bound(node: ast.AST) -> Optional[tuple]:
    """``res["db"].lookup`` → ``("db", "lookup")``; anything else → ``None``."""
    if isinstance(node, ast.Attribute):
        resource = _res_name(node.value)
        if resource is not None:
            return resource, node.attr
    return None


def _tool_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        if node.id in ("wf", "mod", "res"):
            raise FormulaError(f"{node.id} isn't a tool")
        return node.id
    raise FormulaError(f"{ast.unparse(node)} is not a tool name")


def _is_name(node: ast.AST, name: str) -> bool:
    return isinstance(node, ast.Name) and node.id == name


def _is_ref(value: Any) -> bool:
    """``{"$ref": step}``, or part of a step: with ``rows`` and/or ``columns``."""
    return isinstance(value, dict) and "$ref" in value and set(value) <= {"$ref", "rows", "columns"}


def _selection_text(v: dict) -> str:
    """A selection argument as written: ``wf["r"][0:2][cols["n"]]``."""
    text = _ref("wf", v["$ref"])
    rows = v.get("rows")
    if isinstance(rows, dict):
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


def _is_res(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"$res"}


def _body(formula: Optional[str]) -> str:
    return (formula or "").strip().lstrip("=").strip()


def _written(modifiers: List[dict]) -> str:
    """The modifier stack as written (outermost first), for messages."""
    return ", ".join(_modifier(m["kind"], m["params"], repr) for m in reversed(modifiers))


def _modifier(kind: str, params: Dict[str, Any], lit) -> str:
    """One modifier as written: ``mod.map()``, ``mod.name("score")``."""
    if kind == "name" and set(params) == {"to"}:
        return f"mod.name({lit(params['to'])})"
    return f"mod.{kind}({', '.join(f'{k}={lit(v)}' for k, v in params.items())})"


# ─────────────────────────────────────────────────────────────────────────────
# Writing a formula back: the step editor's half of the round trip
# ─────────────────────────────────────────────────────────────────────────────
#
# The step editor edits *parts*, which keep what the user wrote — unlike core's
# operation JSON, which fills in an inferred verb and drops positional
# resources. Modifiers in parts are in WRITTEN order (left to right), so the
# editor lists them top to bottom exactly as the formula reads.
# ``compile_formula(format_parts(to_parts(c)))`` gives back ``c``.

def to_parts(c: Compiled) -> dict:
    """A compiled formula as the editor's parts."""
    return {
        "tool": c.tool_id,
        "bound_to": c.bound_to,
        "modifiers": None if c.modifiers is None else [
            {"kind": m["kind"], "params": dict(m["params"])} for m in reversed(c.modifiers)
        ],
        "input": c.input,
        "resources": list(c.positional_resources),
        # A selection travels as its text ({"$expr": …}): the parser here reads it back.
        "arguments": {k: ({"$expr": _selection_text(v)} if _is_ref(v) and set(v) != {"$ref"} else v)
                      for k, v in c.arguments.items()},
        "inputs": list(c.inputs),
    }


def format_parts(parts: dict) -> str:
    """The editor's parts as a formula; raises :class:`FormulaError` if the
    result doesn't compile, so the editor can't write an invalid step."""
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
        compile_formula(formula)
        return formula
    if inputs:                                           # a combine
        args = [_ref("wf", name) for name in inputs]
        args += [f"{k}={_lit(v)}" for k, v in arguments.items()]
        formula = f"{tool}({', '.join(args)})"
    else:
        head = f'{_ref("res", parts["bound_to"])}.{tool}' if parts.get("bound_to") else tool
        modifiers = parts.get("modifiers")
        if modifiers is not None:
            head += "[" + ", ".join(
                _modifier(m["kind"], m.get("params") or {}, _lit) for m in modifiers) + "]"
        args = [_ref("wf", parts["input"])] if parts.get("input") else []
        args += [_ref("res", name) for name in parts.get("resources") or []]
        args += [f"{k}={_value(v)}" for k, v in arguments.items()]
        # tool[mod.source()] and tool[mod.sweep(…)] read nothing: no call needed.
        no_call = not args and modifiers and any(m["kind"] in NO_INPUT_VERBS for m in modifiers)
        formula = head if no_call else f"{head}({', '.join(args)})"
    compile_formula(formula)
    return formula


def _ref(kind: str, name: str) -> str:
    return f"{kind}[{_lit(name)}]"


def _value(v: Any) -> str:
    """A tool argument: a reference, a resource, or a literal."""
    if _is_ref(v):
        return _selection_text(v)
    if _is_res(v):
        return _ref("res", v["$res"])
    if isinstance(v, dict) and set(v) == {"$expr"}:      # text the editor can't read: parsed here
        return str(v["$expr"])
    return _lit(v)


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
