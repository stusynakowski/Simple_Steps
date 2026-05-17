"""
formula_parser.py
=================
**Legacy-shape adapter** around the AST-based parser in ``safe_formula.py``.

Since Stage 3, all parsing is done by ``safe_formula``. This module exists
only to preserve the older :class:`ParsedFormula` shape (a dict with
``operationId / orchestration / args / isValid / rawInput``) that the
frontend and the v1 models in ``models.py`` still consume.

Once the frontend is migrated to the new ``safe_formula.describe()`` shape
(returns ``{op, kwargs, step_refs, …}``), this module can be deleted in a
single commit.

**There is no regex parsing here.** All grammar decisions live in
``safe_formula``.
"""

from typing import Any, Dict, Optional, Literal

from .safe_formula import build as _sf_build
from .safe_formula import parse_call as _sf_parse_call
from .safe_formula import format_value as _sf_format_value

# Kept as a type alias for callers that import it. The set of legal
# *runtime* orchestration tags (used as the ``_orchestrator`` config key)
# is unchanged — those tags are still meaningful inside the engine, even
# though they are no longer encoded in the formula bar grammar.
OrchestrationMode = Literal[
    'source', 'map', 'rowmap', 'filter', 'dataframe', 'expand', 'raw_output'
]
ORCHESTRATION_MODES = {
    'source', 'map', 'rowmap', 'filter', 'dataframe', 'expand', 'raw_output'
}


class ParsedFormula:
    """
    Legacy parsed-formula container. Returned by :func:`parse_formula`.

    The ``orchestration`` field is always ``None`` for Stage 3+ formulas
    (modifier syntax has been removed from the grammar). It is preserved
    for backwards compatibility with frontend code that still reads it.
    """
    def __init__(
        self,
        operation_id: Optional[str],
        orchestration: Optional[str],
        args: Dict[str, str],
        is_valid: bool,
        raw_input: str,
    ):
        self.operation_id = operation_id
        self.orchestration = orchestration
        self.args = args
        self.is_valid = is_valid
        self.raw_input = raw_input

    def as_dict(self) -> Dict[str, Any]:
        return {
            'operationId':  self.operation_id,
            'orchestration': self.orchestration,
            'args':         self.args,
            'isValid':      self.is_valid,
            'rawInput':     self.raw_input,
        }


# Re-exported helpers — same names the rest of the codebase has been
# importing from this module. They now delegate to safe_formula.
format_formula_value = _sf_format_value


def is_step_reference(value: str) -> bool:
    """True if *value* looks like a step reference token."""
    import re
    if not isinstance(value, str) or not value:
        return False
    return bool(re.match(r'^step[\w-]*(\[.*\]|\.\w+)*$', value, re.IGNORECASE))


def parse_formula(input_str: str) -> ParsedFormula:
    """
    Parse a formula and return a legacy-shape :class:`ParsedFormula`.

    The orchestration field is always ``None`` (the modifier grammar is
    gone). Bare references / literals are represented as a synthetic
    ``passthrough`` / ``literal`` op with a ``_ref`` / ``_literal`` arg,
    matching the pre-Stage-3 contract that downstream code relies on.
    """
    raw = (input_str or '').strip()
    if not raw:
        return ParsedFormula(None, None, {}, False, raw)

    info = _sf_parse_call(raw)
    if not info["is_valid"]:
        return ParsedFormula(None, None, {}, False, raw)

    op = info["op"]

    # Top-level is a call → normal op invocation.
    if info["is_call"]:
        # Literal short-circuit: ``=literal(...)`` (or define_value / to_rows)
        # is preserved as before for the few callers that still depend on
        # ``_literal`` being present.
        if op in ("literal", "define_value", "to_rows"):
            expr = info["args"].get("expr") or info["args"].get("value")
            args = dict(info["args"])
            if expr is not None:
                args.setdefault("_literal", expr)
            return ParsedFormula(op, None, args, True, raw)
        return ParsedFormula(op, None, info["args"], True, raw)

    # Bare reference — keep the historical passthrough/literal split.
    body = info["args"].get("_ref", "").strip()
    if not body:
        return ParsedFormula(None, None, {}, False, raw)

    # Detect a bare literal (number, string, list, dict, bool).
    if (
        (body.startswith('"') and body.endswith('"')) or
        (body.startswith("'") and body.endswith("'")) or
        body in ("True", "False", "true", "false") or
        body[0] in "[{(-" or body[0].isdigit() or
        body.startswith("-")
    ):
        canonical = body
        if body in ("true", "false"):
            canonical = body.capitalize()
        return ParsedFormula(
            'literal', None,
            {'expr': canonical, '_literal': body},
            True, raw,
        )

    # Otherwise it's a step / column / cell reference → passthrough.
    return ParsedFormula('passthrough', None, {'_ref': body}, True, raw)


def build_formula(
    operation_id: str,
    config: Dict[str, Any],
    orchestration: Optional[str] = None,  # accepted for back-compat; ignored
) -> str:
    """
    Build a modifier-free formula string from operation id + config.

    The ``orchestration`` parameter is accepted for backwards compatibility
    with the frontend's ``/api/build_formula`` payload but is silently
    ignored — the grammar no longer carries orchestration modifiers.
    """
    if not operation_id or operation_id in ('noop', ''):
        return ''
    if operation_id == 'passthrough':
        return f"={config.get('_ref', '')}"
    if operation_id in ('literal', 'define_value', 'to_rows') and '_literal' in config:
        return f"={config['_literal']}"
    # Drop internal markers; let safe_formula.build emit the rest.
    public_kwargs = {k: v for k, v in config.items() if not k.startswith('_')}
    return _sf_build(operation_id, public_kwargs)


# ── Internal helper kept for tests that import it ────────────────────────
def split_args(raw: str) -> list:
    """
    Top-level comma split of an argument list, respecting quotes and
    brackets. Retained because `tests/test_formula_alignment.py` imports
    it as a reference for cross-language parity checks.
    """
    tokens, current, depth = [], '', 0
    in_single = in_double = False
    for ch in raw:
        if ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "'" and not in_double:
            in_single = not in_single
        elif not in_single and not in_double:
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
            elif ch == ',' and depth == 0:
                tokens.append(current)
                current = ''
                continue
        current += ch
    if current:
        tokens.append(current)
    return tokens
