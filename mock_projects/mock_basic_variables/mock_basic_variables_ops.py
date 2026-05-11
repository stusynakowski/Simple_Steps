"""
Mock Basic Variables Operations
================================
Two operations for variable instantiation inside a Simple Steps pipeline.

``literal``         — parses a Python literal expression (string, int, float,
                      bool, list, dict, nested dict) using ast.literal_eval.
                      The formula bar reads exactly like Python assignment:
                          = "hello world"
                          = 42
                          = [1, 2, 3]
                          = {"name": "alice"}

``define_variable`` — legacy helper; accepts a serialised string + explicit
                      type tag.  Kept for backwards-compatibility with the
                      table-manipulations project.

Both operations ALWAYS produce a 1×1 DataFrame so any variable is
referenceable from later steps with a stable, predictable shape.
"""

import ast
import json
import os
import sys

# Allow imports from src/ when loaded outside the installed package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

import pandas as pd

try:
    from SIMPLE_STEPS.decorators import simple_step
except ImportError:
    from src.SIMPLE_STEPS.decorators import simple_step


@simple_step(
    name="Literal Value",
    category="Variables",
    operation_type="source",
    id="literal",
)
def literal(expr: str = '""') -> pd.DataFrame:
    """
    Instantiate a variable from a Python literal expression.

    Uses ``ast.literal_eval`` for safe, eval-free parsing — only valid
    Python literals are accepted (strings, ints, floats, bools, lists,
    dicts, tuples, None).

    The formula bar looks just like Python assignment::

        = "hello world"
        = 42
        = 3.14
        = True
        = [1, 2, 3, 4, 5]
        = {"name": "alice", "age": 30}
        = {"user": {"name": "alice", "scores": [90, 85, 92]}}

    The result is always a 1×1 DataFrame::

        ┌──────────────────────┐
        │        value         │
        ├──────────────────────┤
        │  <python literal>    │
        └──────────────────────┘
    """
    cell = ast.literal_eval(expr.strip())
    return pd.DataFrame({"value": [cell]})


@simple_step(
    name="Define Variable",
    category="Variables",
    operation_type="source",
    id="define_variable",
)
def define_variable(value: str = "", type: str = "auto") -> pd.DataFrame:
    """
    Instantiate a variable as a single-cell step.

    The result is always a 1×1 DataFrame::

        ┌──────────┐
        │  value   │
        ├──────────┤
        │  <cell>  │
        └──────────┘

    Parameters
    ----------
    value:
        The value to store.  For complex types pass a JSON-encoded string.
    type:
        How to interpret *value*.  One of:
        "string", "int", "float", "bool", "json", "auto".

    Examples
    --------
        =define_variable(value="hello world", type="string")
        =define_variable(value="42", type="int")
        =define_variable(value="3.14", type="float")
        =define_variable(value="true", type="bool")
        =define_variable(value="[1, 2, 3]", type="json")
        =define_variable(value='{"name": "alice"}', type="json")
        =define_variable(value='{"user": {"name": "alice", "scores": [90, 85]}}', type="json")
    """
    cell: object

    if type == "string":
        cell = value

    elif type == "int":
        cell = int(value)

    elif type == "float":
        cell = float(value)

    elif type == "bool":
        cell = value.strip().lower() in ("true", "1", "yes")

    elif type == "json":
        cell = json.loads(value)

    else:
        # auto — try JSON → int → float → string
        try:
            cell = json.loads(value)
        except (ValueError, json.JSONDecodeError):
            try:
                cell = int(value)
            except ValueError:
                try:
                    cell = float(value)
                except ValueError:
                    cell = value

    # Always wrap in a 1×1 DataFrame so the shape is predictable.
    return pd.DataFrame({"value": [cell]})
