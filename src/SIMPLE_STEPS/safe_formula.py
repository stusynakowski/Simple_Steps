"""
safe_formula.py
===============
Safe AST-based formula interpreter for Simple Steps.

The formula bar uses Python *syntax* but is NOT executed with ``eval``.
Every formula is parsed into an ``ast`` tree and walked by a small
interpreter that only knows how to do a closed set of things:

    • Look up step references (``step1``)
    • Read columns from steps via attribute or subscript (``step1.url``,
      ``step1["url"]``)
    • Call functions that are registered in ``OPERATION_REGISTRY``
      (the ``@simple_step``-decorated ops)
    • Literals (numbers, strings, bools, lists, tuples, dicts, None)
    • Unary ``+ -`` on numeric literals/refs
    • Binary arithmetic: ``+ - * / // % **``
    • Comparisons:        ``== != < > <= >=``
    • Nested calls — the Excel-like part: ``op_a(x=op_b(y=step1.url))``

Everything else (imports, attribute writes, ``__dunder__`` access,
arbitrary function calls, comprehensions, lambdas, f-strings, …) is
rejected at validation time.

Three entry points:

    validate(formula, available_steps)  -> list[Diagnostic]
    describe(formula)                   -> dict (structured info for UI)
    run_formula(formula, steps)         -> result (Step­Proxy / DF / scalar)

``run_formula`` always re-validates before executing, so misuse from the
API surface cannot bypass the allowlist.
"""

from __future__ import annotations

import ast
import inspect
import pandas as pd
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple, Union, TYPE_CHECKING

if TYPE_CHECKING:
    from .step_proxy import StepProxy

# Public type alias — what callers may pass as the "step environment".
StepEnv = Dict[str, Any]


class FormulaError(Exception):
    """Raised for malformed or disallowed formulas (parse/validate/interp)."""


# --------------------------------------------------------------------------- #
# Structured diagnostics                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class Diagnostic:
    """
    A structured validation error.

    ``col_offset`` / ``end_col_offset`` are zero-based character offsets
    *within the formula body* — i.e. the leading ``=`` is already stripped
    by ``parse()``. The frontend should draw a squiggle on
    ``[col_offset, end_col_offset)`` of the bar's contents, after the ``=``.

    ``code`` is a stable string the UI can switch on to choose icons,
    actions, etc. New codes will be added; existing ones won't be renamed.
    """
    message: str
    code: str
    col_offset: Optional[int] = None
    end_col_offset: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def __str__(self) -> str:  # pragma: no cover  (compat shim)
        return self.message

    def __contains__(self, needle: str) -> bool:
        # Lets legacy code write `"some text" in diagnostic` against the
        # message. New code should use ``d.message`` / ``d.code`` directly.
        return needle in self.message


# --------------------------------------------------------------------------- #
# Allowlist of AST node types.                                                #
# Everything not listed here is rejected, period.                             #
# --------------------------------------------------------------------------- #
_ALLOWED_NODES: Tuple[type, ...] = (
    ast.Expression,
    ast.Call,
    ast.keyword,
    ast.Name,
    ast.Attribute,
    ast.Subscript,
    ast.Constant,
    ast.List,
    ast.Tuple,
    ast.Dict,
    ast.UnaryOp,
    ast.USub,
    ast.UAdd,
    ast.BinOp,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.Compare,
    ast.Eq, ast.NotEq, ast.Lt, ast.Gt, ast.LtE, ast.GtE,
    ast.Load,
)

# Index-style slice nodes (Python <3.9 vs >=3.9 compatibility shim)
if hasattr(ast, "Index"):
    _ALLOWED_NODES = _ALLOWED_NODES + (ast.Index,)  # type: ignore[attr-defined]


# --------------------------------------------------------------------------- #
# Parsing                                                                     #
# --------------------------------------------------------------------------- #
def parse(formula: str) -> ast.Expression:
    """
    Parse a formula string into an ``ast.Expression``.

    Strips a single leading ``=`` (the formula-bar convention) and any
    surrounding whitespace. Raises ``FormulaError`` on syntax errors.
    """
    if formula is None:
        raise FormulaError("Formula is empty.")
    text = formula.strip()
    if text.startswith("="):
        text = text[1:].strip()
    if not text:
        raise FormulaError("Formula is empty.")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as e:
        raise FormulaError(f"Syntax error: {e.msg} (col {e.offset})") from e
    return tree


# --------------------------------------------------------------------------- #
# Validation — pure, no side effects, no execution.                           #
# --------------------------------------------------------------------------- #
def _node_range(node: ast.AST) -> Tuple[Optional[int], Optional[int]]:
    """Best-effort (col_offset, end_col_offset) for a single-line expression."""
    col = getattr(node, "col_offset", None)
    end = getattr(node, "end_col_offset", None)
    return col, end


def _signature_diagnostics(
    call: ast.Call,
    func,
) -> List[Diagnostic]:
    """
    Check the kwargs/positional args of a Call against the registered
    function's signature. Returns a list of Diagnostics (empty if clean).
    """
    diags: List[Diagnostic] = []
    try:
        sig = inspect.signature(func)
    except (TypeError, ValueError):
        return diags  # builtins / C funcs without signatures — skip silently

    params = sig.parameters
    has_var_kw = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
    has_var_pos = any(p.kind is inspect.Parameter.VAR_POSITIONAL for p in params.values())

    # ── Unknown kwargs ──
    valid_kwarg_names = {
        name for name, p in params.items()
        if p.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        )
    }
    provided_kwargs = {kw.arg for kw in call.keywords if kw.arg}
    if not has_var_kw:
        for kw in call.keywords:
            if kw.arg and kw.arg not in valid_kwarg_names:
                col, end = _node_range(kw.value)  # underline the value range
                # Slightly better: underline the keyword name itself; ast
                # doesn't expose it directly, so we approximate with the
                # value range. Good enough for v1.
                diags.append(Diagnostic(
                    message=f"Unknown argument '{kw.arg}' for "
                            f"'{call.func.id}'. Valid: "  # type: ignore[union-attr]
                            f"{sorted(valid_kwarg_names)}",
                    code="unknown_kwarg",
                    col_offset=col,
                    end_col_offset=end,
                ))

    # ── Required kwargs missing ──
    # A parameter is "required" if it has no default AND is not VAR_*.
    # If the caller supplied enough positional args to cover it, it's fine.
    n_positional_supplied = len(call.args)
    positional_names = [
        name for name, p in params.items()
        if p.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    positional_covered = set(positional_names[:n_positional_supplied])

    for name, p in params.items():
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue
        if p.default is not inspect.Parameter.empty:
            continue
        if name in positional_covered:
            continue
        if name in provided_kwargs:
            continue
        col, end = _node_range(call)
        diags.append(Diagnostic(
            message=f"Missing required argument '{name}' for '{call.func.id}'.",  # type: ignore[union-attr]
            code="missing_required",
            col_offset=col,
            end_col_offset=end,
        ))

    # ── Too many positional args ──
    if not has_var_pos and n_positional_supplied > len(positional_names):
        col, end = _node_range(call)
        diags.append(Diagnostic(
            message=f"'{call.func.id}' takes at most "  # type: ignore[union-attr]
                    f"{len(positional_names)} positional argument(s), "
                    f"got {n_positional_supplied}.",
            code="too_many_positional",
            col_offset=col,
            end_col_offset=end,
        ))

    return diags


def validate(
    formula: Union[str, ast.AST],
    available_steps: Optional[set] = None,
    registry: Optional[Dict[str, Any]] = None,
) -> List[Diagnostic]:
    """
    Walk the AST and return a list of structured diagnostics.
    Empty list = valid.

    Parameters
    ----------
    formula           Formula string (with or without leading ``=``) OR a
                      pre-parsed ``ast`` tree.
    available_steps   Names that are legal as bare ``Name`` references
                      (e.g. ``{"step1", "step2"}``). If ``None``, any
                      Name not matching an op is reported as unknown.
    registry          Operation registry to check call targets against.
                      Defaults to ``decorators.OPERATION_REGISTRY``.
    """
    if registry is None:
        from .decorators import OPERATION_REGISTRY
        registry = OPERATION_REGISTRY

    if isinstance(formula, str):
        try:
            tree = parse(formula)
        except FormulaError as e:
            return [Diagnostic(message=str(e), code="syntax_error")]
    else:
        tree = formula

    steps = available_steps or set()
    diags: List[Diagnostic] = []

    def add(msg: str, code: str, node: Optional[ast.AST] = None) -> None:
        col, end = _node_range(node) if node is not None else (None, None)
        diags.append(Diagnostic(message=msg, code=code, col_offset=col, end_col_offset=end))

    for node in ast.walk(tree):
        # 1. Node type allowlist
        if not isinstance(node, _ALLOWED_NODES):
            add(f"Disallowed syntax: {type(node).__name__}", "disallowed_node", node)
            continue

        # 2. Calls must target a Name that is a registered op
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                add(
                    "Only direct calls to registered operations are allowed "
                    "(no method calls, no computed callables).",
                    "indirect_call",
                    node,
                )
            elif node.func.id not in registry:
                add(f"Unknown operation: '{node.func.id}'", "unknown_op", node.func)
            else:
                # Signature check, only when the op is known
                entry = registry[node.func.id]
                diags.extend(_signature_diagnostics(node, entry["func"]))
            # *args / **kwargs unpacking is disallowed
            for arg in node.args:
                if isinstance(arg, ast.Starred):
                    add("Argument unpacking (*args) is not allowed.",
                        "starred_arg", arg)
            for kw in node.keywords:
                if kw.arg is None:
                    add("Keyword unpacking (**kwargs) is not allowed.",
                        "kwarg_unpack", kw.value)

        # 3. Attribute access only on step refs, and no dunders
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                add(f"Private/dunder attribute access not allowed: '.{node.attr}'",
                    "dunder_attr", node)
            if not (isinstance(node.value, ast.Name) and node.value.id in steps):
                add("Attribute access is only allowed on step references "
                    f"(got '.{node.attr}' on non-step expression).",
                    "attr_non_step", node)

        # 4. Subscript only on step refs, with a string literal key
        if isinstance(node, ast.Subscript):
            if not (isinstance(node.value, ast.Name) and node.value.id in steps):
                add("Subscript [...] is only allowed on step references.",
                    "subscript_non_step", node)
            key_node = node.slice
            if hasattr(ast, "Index") and isinstance(key_node, ast.Index):
                key_node = key_node.value  # type: ignore[attr-defined]
            if not (isinstance(key_node, ast.Constant) and isinstance(key_node.value, str)):
                add("Subscript key must be a string literal.",
                    "subscript_non_string", node)

        # 5. Bare Names must be either a step ref OR a registered op
        if isinstance(node, ast.Name):
            if node.id in steps or node.id in registry:
                continue
            add(f"Unknown name: '{node.id}'", "unknown_name", node)

    return diags


# --------------------------------------------------------------------------- #
# Interpretation                                                              #
# --------------------------------------------------------------------------- #
def _coerce_step_env(steps: StepEnv) -> Dict[str, "StepProxy"]:  # noqa: F821
    """Wrap raw DataFrames as StepProxy objects so column access works."""
    from .step_proxy import StepProxy
    out: Dict[str, "StepProxy"] = {}
    for k, v in steps.items():
        if isinstance(v, StepProxy):
            out[k] = v
        elif isinstance(v, pd.DataFrame):
            out[k] = StepProxy(v, label=k)
        else:
            raise FormulaError(
                f"Step '{k}' must be a DataFrame or StepProxy, got {type(v).__name__}"
            )
    return out


_BINOP_TABLE = {
    ast.Add:      lambda a, b: a + b,
    ast.Sub:      lambda a, b: a - b,
    ast.Mult:     lambda a, b: a * b,
    ast.Div:      lambda a, b: a / b,
    ast.FloorDiv: lambda a, b: a // b,
    ast.Mod:      lambda a, b: a % b,
    ast.Pow:      lambda a, b: a ** b,
}

_CMPOP_TABLE = {
    ast.Eq:    lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Lt:    lambda a, b: a < b,
    ast.Gt:    lambda a, b: a > b,
    ast.LtE:   lambda a, b: a <= b,
    ast.GtE:   lambda a, b: a >= b,
}


def _interpret(node: ast.AST, env: Dict[str, Any]) -> Any:
    steps: Dict[str, Any] = env["steps"]
    registry: Dict[str, Any] = env["registry"]

    if isinstance(node, ast.Expression):
        return _interpret(node.body, env)

    if isinstance(node, ast.Constant):
        return node.value

    if isinstance(node, ast.Name):
        if node.id in steps:
            return steps[node.id]
        if node.id in registry:
            return registry[node.id]["func"]
        raise FormulaError(f"Unknown name: '{node.id}'")

    if isinstance(node, ast.Attribute):
        step = steps[node.value.id]  # type: ignore[union-attr]
        return getattr(step, node.attr)

    if isinstance(node, ast.Subscript):
        slice_node = node.slice
        if hasattr(ast, "Index") and isinstance(slice_node, ast.Index):
            slice_node = slice_node.value  # type: ignore[attr-defined]
        key = _interpret(slice_node, env)
        step = steps[node.value.id]  # type: ignore[union-attr]
        return step[key]

    if isinstance(node, ast.List):
        return [_interpret(e, env) for e in node.elts]

    if isinstance(node, ast.Tuple):
        return tuple(_interpret(e, env) for e in node.elts)

    if isinstance(node, ast.Dict):
        return {
            _interpret(k, env): _interpret(v, env)
            for k, v in zip(node.keys, node.values)
        }

    if isinstance(node, ast.UnaryOp):
        operand = _interpret(node.operand, env)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return +operand
        raise FormulaError(f"Unsupported unary operator: {type(node.op).__name__}")

    if isinstance(node, ast.BinOp):
        op = _BINOP_TABLE.get(type(node.op))
        if op is None:
            raise FormulaError(f"Unsupported binary operator: {type(node.op).__name__}")
        return op(_interpret(node.left, env), _interpret(node.right, env))

    if isinstance(node, ast.Compare):
        # Python chains comparisons (a < b < c). We honour that.
        left = _interpret(node.left, env)
        for op_node, comparator in zip(node.ops, node.comparators):
            op = _CMPOP_TABLE.get(type(op_node))
            if op is None:
                raise FormulaError(f"Unsupported comparison: {type(op_node).__name__}")
            right = _interpret(comparator, env)
            result = op(left, right)
            # For chained comparisons we'd need short-circuit on the
            # Python truthiness of `result`; with pandas Series this is
            # ambiguous. Restrict to single comparisons for now.
            if len(node.ops) > 1:
                raise FormulaError(
                    "Chained comparisons (e.g. 1 < x < 10) are not supported; "
                    "use two comparisons combined externally."
                )
            return result

    if isinstance(node, ast.Call):
        op_id = node.func.id  # type: ignore[union-attr]
        entry = registry[op_id]
        from .decorators import _auto_broadcast
        raw_func = entry["func"]
        op_type = entry.get("type", "map")
        callable_fn = _auto_broadcast(raw_func, operation_type=op_type)

        args = [_interpret(a, env) for a in node.args]
        kwargs = {kw.arg: _interpret(kw.value, env) for kw in node.keywords}
        return callable_fn(*args, **kwargs)

    raise FormulaError(f"Unsupported AST node: {type(node).__name__}")


# --------------------------------------------------------------------------- #
# Public API                                                                  #
# --------------------------------------------------------------------------- #
def run_formula(
    formula: str,
    steps: Optional[StepEnv] = None,
    registry: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Parse, validate, and interpret a formula. Returns whatever the
    top-level expression evaluates to (typically a DataFrame, StepProxy,
    or scalar).

    Raises ``FormulaError`` if validation fails.
    """
    if registry is None:
        from .decorators import OPERATION_REGISTRY
        registry = OPERATION_REGISTRY

    step_env = _coerce_step_env(steps or {})
    tree = parse(formula)

    diags = validate(tree, available_steps=set(step_env.keys()), registry=registry)
    if diags:
        msg = "Invalid formula:\n  - " + "\n  - ".join(d.message for d in diags)
        raise FormulaError(msg)

    return _interpret(tree, {"steps": step_env, "registry": registry})


def describe(formula: str) -> Dict[str, Any]:
    """
    Return a static description of the formula's structure — useful for
    the UI and for ``/api/validate_formula``. No execution.

    The returned dict is JSON-serialisable.
    """
    try:
        tree = parse(formula)
    except FormulaError as e:
        return {
            "valid": False,
            "errors": [Diagnostic(message=str(e), code="syntax_error").to_dict()],
            "calls": [],
            "step_refs": [],
            "top_level_op": None,
        }

    step_refs: List[str] = []
    calls: List[Dict[str, Any]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            calls.append({
                "op": node.func.id,
                "kwargs": [kw.arg for kw in node.keywords if kw.arg],
                "positional_count": len(node.args),
            })
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            step_refs.append(f"{node.value.id}.{node.attr}")
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name):
            sl = node.slice
            if hasattr(ast, "Index") and isinstance(sl, ast.Index):
                sl = sl.value  # type: ignore[attr-defined]
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                step_refs.append(f"{node.value.id}[{sl.value!r}]")

    return {
        "valid": True,
        "errors": [],
        "calls": calls,
        "step_refs": step_refs,
        "top_level_op": calls[0]["op"] if calls else None,
    }
