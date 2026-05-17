"""
formula_parser.py
================
Canonical formula parsing and building logic for Simple Steps.
This is the single source of truth for formula syntax, used by both backend and frontend (via API or Pyodide).
"""
import re
from typing import Dict, Any, Optional, Literal, Union

OrchestrationMode = Literal['source', 'map', 'rowmap', 'filter', 'dataframe', 'expand', 'raw_output']

class ParsedFormula:
    def __init__(self, operation_id: Optional[str], orchestration: Optional[str], args: Dict[str, str], is_valid: bool, raw_input: str):
        self.operation_id = operation_id
        self.orchestration = orchestration
        self.args = args
        self.is_valid = is_valid
        self.raw_input = raw_input

    def as_dict(self):
        return {
            'operationId': self.operation_id,
            'orchestration': self.orchestration,
            'args': self.args,
            'isValid': self.is_valid,
            'rawInput': self.raw_input,
        }

ORCHESTRATION_MODES = {'source', 'map', 'rowmap', 'filter', 'dataframe', 'expand', 'raw_output'}


def is_step_reference(value: str) -> bool:
    # Accepted forms (docs/dev_plan/102, 103):
    #   step_id                  bare whole-step ref
    #   step_id.col              dot-form column ref (legacy, still tolerated)
    #   step_id["col"]           bracket-form column ref
    #   step_id["col"][N]        bracket-form cell ref
    if re.match(r'^step[\w-]*$', value, re.IGNORECASE):
        return True
    if re.match(r'^step[\w-]*\.\w+$', value, re.IGNORECASE):
        return True
    if re.match(r'^step[\w-]*\[.*\]$', value, re.IGNORECASE):
        return True
    return False


def format_formula_value(v: Any) -> str:
    if v is None:
        return ''
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if s.startswith('='):
        return s
    if is_step_reference(s):
        return s
    if re.match(r'^-?\d+(\.\d+)?$', s):
        return s
    return f'"{s}"'


def _try_parse_literal(body: str, raw_input: str) -> Optional[ParsedFormula]:
    # Every bare-literal route maps to the core `literal` op, which uses
    # ast.literal_eval and stores the whole value in a single cell.
    if (body.startswith('"') and body.endswith('"')) or (body.startswith("'") and body.endswith("'")):
        return ParsedFormula('literal', 'source', {'expr': body, '_literal': body}, True, raw_input)
    if re.match(r'^-?\d+(\.\d+)?$', body):
        return ParsedFormula('literal', 'source', {'expr': body, '_literal': body}, True, raw_input)
    if body in ('true', 'false', 'True', 'False'):
        # Normalise to Python casing so ast.literal_eval accepts it.
        canonical = body.capitalize()
        return ParsedFormula('literal', 'source', {'expr': canonical, '_literal': body}, True, raw_input)
    if (body.startswith('[') and body.endswith(']')) or (body.startswith('{') and body.endswith('}')):
        return ParsedFormula('literal', 'source', {'expr': body, '_literal': body}, True, raw_input)
    return None


def split_args(raw: str) -> list:
    tokens = []
    current = ''
    depth = 0
    in_single = False
    in_double = False
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


def parse_formula(input_str: str) -> ParsedFormula:
    raw = (input_str or '').strip()
    if not raw.startswith('='):
        return ParsedFormula(None, None, {}, False, raw)
    body = raw[1:]
    trimmed = body.strip()
    literal_result = _try_parse_literal(trimmed, raw)
    if literal_result:
        return literal_result
    if re.match(r'^step[\w-]*(\.\w+)?$', trimmed, re.IGNORECASE) or re.match(r'^step[\w-]*\[.*\]$', trimmed, re.IGNORECASE):
        return ParsedFormula('passthrough', None, {'_ref': trimmed}, True, raw)
    paren_idx = body.find('(')
    if paren_idx == -1:
        dot_idx = body.find('.')
        operation_id = body[:dot_idx] if dot_idx != -1 else body
        return ParsedFormula(operation_id.upper() or None, None, {}, False, raw)
    head = body[:paren_idx]
    dot_idx = head.find('.')
    if dot_idx != -1:
        operation_id = head[:dot_idx]
        maybe_mode = head[dot_idx + 1:]
        orchestration = maybe_mode if maybe_mode in ORCHESTRATION_MODES else None
    else:
        operation_id = head
        orchestration = None
    if not operation_id:
        return ParsedFormula(None, None, {}, False, raw)
    has_closing_paren = raw.endswith(')')
    args_raw = body[paren_idx + 1 : -1] if has_closing_paren else body[paren_idx + 1 :]
    args = {}
    if args_raw.strip():
        tokens = split_args(args_raw)
        for token in tokens:
            eq_idx = token.find('=')
            if eq_idx != -1:
                key = token[:eq_idx].strip()
                val = token[eq_idx + 1 :].strip()
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                if key:
                    args[key] = val
    return ParsedFormula(operation_id, orchestration, args, has_closing_paren, raw)


def build_formula(operation_id: str, config: Dict[str, Any], orchestration: Optional[str] = None) -> str:
    if not operation_id or operation_id in ('noop', ''):
        return ''
    if operation_id == 'passthrough':
        return str(config.get('_ref', ''))
    if operation_id == 'literal' and '_literal' in config:
        return f"={config['_literal']}"
    if operation_id == 'define_value' and '_literal' in config:
        return f"={config['_literal']}"
    if operation_id == 'to_rows' and '_literal' in config:
        return f"={config['_literal']}"
    effective_mode = orchestration if orchestration is not None else config.get('_orchestrator')
    modifier = f'.{effective_mode}' if effective_mode else ''
    args = ', '.join(f"{k}={format_formula_value(v)}" for k, v in config.items() if not k.startswith('_'))
    return f"={operation_id}{modifier}({args})"
