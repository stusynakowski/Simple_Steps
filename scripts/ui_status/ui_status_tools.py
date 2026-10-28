"""
ui_status_tools.py — the few tools the UI-status workflows need.

Each one is there to put the grid into a particular state: a failed cell, a
null, a row that splits into several, a group. See README.md.
"""

from typing import Optional

from SIMPLE_STEPS import simple_step_tool


@simple_step_tool(category="UI status")
def double(n: Optional[int]) -> Optional[int]:
    """Twice the number; refuses 3, so one cell fails.

    Args:
        n: the number to double. A null stays null.
    """
    if n == 3:
        raise ValueError("three is refused, on purpose")
    return None if n is None else n * 2


@simple_step_tool(category="UI status")
def is_big(n: int) -> bool:
    """Whether the number is 20 or more: a filter that drops rows.

    Args:
        n: the number to test.
    """
    return n >= 20


@simple_step_tool(category="UI status")
def split_in_two(n: int) -> list:
    """The number and the one after it: each row becomes two.

    Args:
        n: the number to split.
    """
    return [n, n + 1]


@simple_step_tool(category="UI status")
def add_up(n: list) -> int:
    """The sum of a group's numbers.

    Args:
        n: the group's numbers.
    """
    return sum(n)
