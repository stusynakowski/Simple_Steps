"""
tools.py — the registry from simple-steps-core's ``all_orchestrations`` example.

The same nine tools as core's ``examples/all_orchestrations/pipeline.py``,
declared for the app. Bodies and annotations match core's on purpose: core
infers a step's verb from them (``-> bool`` filters, ``-> list`` expands,
``(acc, n)`` collapses), so the same signals have to be here.

    python tools.py --workspace .        # open the app on this folder

Then open ``projects/demo/all-orchestrations.simple-steps-workflow`` and run
it. ``check.py`` runs the same workflow headlessly and compares every step
with core's own output.
"""

from __future__ import annotations

from SIMPLE_STEPS import simple_step_tool


@simple_step_tool(category="All orchestrations")
def scale(n, weight=1):
    """map: a value per row — the score.

    Args:
        n: the reading.
        weight: multiplies the score.
    """
    return n * 10 * weight


@simple_step_tool(category="All orchestrations")
def is_big(n) -> bool:
    """filter: a predicate — keep rows whose n is greater than one.

    Args:
        n: the reading.
    """
    return n > 1


@simple_step_tool(category="All orchestrations")
def label_city(city):
    """group: a key function — the bucket a row belongs to.

    Args:
        city: the row's city.
    """
    return city


@simple_step_tool(category="All orchestrations")
def add_n(acc, n):
    """collapse: a two-argument reducer — running sum of n.

    Args:
        acc: the running total.
        n: the reading to add.
    """
    return (acc or 0) + n


@simple_step_tool(category="All orchestrations")
def fan_out(n) -> list:
    """expand: each row yields a list — n copies of n.

    Args:
        n: how many copies, and their value.
    """
    return [n] * n


@simple_step_tool(category="All orchestrations")
def make_coords(n):
    """expand -> widen: each row yields a list of records to be spread wide.

    Args:
        n: the reading.
    """
    return [{"axis": "x", "val": n}, {"axis": "y", "val": n * 2}]


@simple_step_tool(category="All orchestrations")
def grid_cell(model, window):
    """sweep: run over the cross product of named parameter lists.

    Args:
        model: the model name.
        window: the window length.
    """
    return f"{model}:{window}"


@simple_step_tool(category="All orchestrations")
def risky(n):
    """failure: raises on a specific value so some rows fail and some pass.

    Args:
        n: the reading; 2 raises.
    """
    if n == 2:
        raise ValueError("twos are not allowed")
    return n * 100


@simple_step_tool(category="All orchestrations")
def make_pair(n):
    """tuple return — widen auto-names the positions c0, c1.

    Args:
        n: the reading.
    """
    return (n * 10, n * n)


if __name__ == "__main__":
    from SIMPLE_STEPS.cli import main

    main()
