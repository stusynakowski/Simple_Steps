"""
safe_formula.py
===============
Safe AST-based formula interpreter for Simple Steps.

The formula bar uses Python *syntax* but is NOT executed with ``eval``.
Instead, every formula is parsed into an ``ast`` tree and walked by a
small interpreter that only knows how to do a closed set of things:

    • Look up step references (``step1``)
    • Read columns from steps via attribute or subscript (``step1.url``,
      ``step1["url"]``)
    • Call functions that are registered in ``OPERATION_REGISTRY``
      (the ``@simple_step``-decorated ops)
    • Literals (numbers, strings, bools, lists, tuples, dicts, None)
    • Unary minus on numeric literals
    • Nested calls — the Excel-like part: ``op_a(x=op_b(y=step1.url))``

Everything else (imports, attribute writes, ``__dunder__`` access,
arbitrary function calls, comprehensions, lambdas, f-strings, …) is
rejected at validation time.

Two entry points:

    validate(formula, available_steps)  -> list[str]   # diagnostics
    run_formula(formula, steps)         -> pd.DataFrame  # execute

``run_formula`` always re-validates before executing, so misuse from the
API surface cannot bypass the allowlist.
"""

from __future__ import annotations

import ast
import pandas as pd
from typing import Any, Dict, List, Optional, Tuple, Union, TYPE_CHECKING

if TYPE_CHECKING:
    from .step_proxy import StepProxy

# Public type alias — what callers may pass as the "step environment".
StepEnv = Dict[str, Any]


class FormulaError(Exception):
    """Raised for malformed or disallowed formulas (parse/validate/interp)."""


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
def validate(
    formula: Union[str, ast.AST],
    available_steps: Optional[set] = None,
    registry: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """
    Walk the AST and return a list of error messages. Empty list = valid.

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
            return [str(e)]
    else:
        tree = formula

    steps = available_steps or set()
    errors: List[str] = []

    for node in ast.walk(tree):
        # 1. Node type allowlist
        if not isinstance(node, _ALLOWED_NODES):
            errors.append(f"Disallowed syntax: {type(node).__name__}")
            continue

        # 2. Calls must target a Name that is a registered op
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                errors.append(
                    "Only direct calls to registered operations are allowed "
                    "(no method calls, no computed callables)."
                )
            elif node.func.id not in registry:
                errors.append(f"Unknown operation: '{node.func.id}'")
            # *args / **kwargs unpacking is disallowed
            for arg in node.args:
                if isinstance(arg, ast.Starred):
                    errors.append("Argument unpacking (*args) is not allowed.")
            for kw in node.keywords:
                if kw.arg is None:
                    errors.append("Keyword unpacking (**kwargs) is not allowed.")

        # 3. Attribute access only on step refs, and no dunders
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                errors.append(
                    f"Private/dunder attribute access not allowed: '.{node.attr}'"
                )
            if not (isinstance(node.value, ast.Name) and node.value.id in steps):
                errors.append(
                    "Attribute access is only allowed on step references "
                    f"(got '.{node.attr}' on non-step expression)."
                )

        # 4. Subscript only on step refs, with a string literal key
        if isinstance(node, ast.Subscript):
            if not (isinstance(node.value, ast.Name) and node.value.id in steps):
                errors.append(
                    "Subscript [...] is only allowed on step references."
                )
            key_node = node.slice
            if hasattr(ast, "Index") and isinstance(key_node, ast.Index):
                key_node = key_node.value  # type: ignore[attr-defined]
            if not (isinstance(key_node, ast.Constant) and isinstance(key_node.value, str)):
                errors.append("Subscript key must be a string literal.")

        # 5. Bare Names must be either a step ref OR a registered op
        if isinstance(node, ast.Name):
            if node.id in steps:
                continue
            if node.id in registry:
                continue
            errors.append(f"Unknown name: '{node.id}'")

    return errors


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
        # A bare op name with no call — rare but legal as e.g. `fn=op_id`.
        # We return the registry entry's raw function so it can be passed
        # to higher-order ops like ss_map.
        if node.id in registry:
            return registry[node.id]["func"]
        raise FormulaError(f"Unknown name: '{node.id}'")

    if isinstance(node, ast.Attribute):
        # Guaranteed by validate(): node.value is a Name pointing at a step.
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

    if isinstance(node, ast.Call):
        op_id = node.func.id  # type: ignore[union-attr]
        entry = registry[op_id]
        # Use the auto-broadcasting wrapper if available so that ColumnProxy
        # arguments are mapped row-wise — same behavior as direct Python calls.
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

    errors = validate(tree, available_steps=set(step_env.keys()), registry=registry)
    if errors:
        raise FormulaError("Invalid formula:\n  - " + "\n  - ".join(errors))

    return _interpret(tree, {"steps": step_env, "registry": registry})


def describe(formula: str) -> Dict[str, Any]:
    """
    Return a static description of the formula's structure — useful for
    the UI and for ``/api/validate_formula``. No execution.
    """
    try:
        tree = parse(formula)
    except FormulaError as e:
        return {"valid": False, "errors": [str(e)], "calls": [], "step_refs": []}

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
