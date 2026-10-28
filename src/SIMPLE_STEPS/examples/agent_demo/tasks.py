"""
tasks.py — the requests the agent example asks, and how to tell a good answer.

Each task is one request a user might type into the chat pane, the step a good
answer adds (``formula``, which the reference workflow saves), and a check on
that step's *output* — not its formula, since a model may write the same step
another way (a different column name, ``threshold=100`` left as the default).

``runme.py`` checks the reference answers; ``ask.py`` asks a live model and
checks its answers the same way.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Union

import pandas as pd

#: The workflow the agent starts from: one source step.
START = [{"name": "orders", "formula": "=sample_orders[mod.source()]()"}]

TOTALS = [140.0, 112.0, 13.5, 60.0, 72.0, 13.5, 140.0, 28.0, 234.0, 78.0, 9.0, 60.0]
MONTHS = ["2026-02", "2026-02", "2026-03", "2026-01", "2026-02", "2026-02",
          "2026-02", "2026-02", "2026-01", "2026-03", "2026-03", "2026-01"]
CITY_REVENUE = [94.5, 213.5, 234.0, 418.0]


@dataclass
class Task:
    name: str
    request: str
    formula: str
    check: Callable[[pd.DataFrame], Union[bool, str]]


def _column_equal(data: pd.DataFrame, values: list) -> bool:
    return any(list(data[c]) == values for c in data.columns)


def _totals(data):
    return _column_equal(data, TOTALS) or "no column holds price × quantity for every order"


def _with_totals(data):
    if "order_id" not in data or "city" not in data:
        return f"columns {list(data.columns)}: want each order (order_id, city, …) beside its total"
    return _column_equal(data, TOTALS) or "no column holds price × quantity for every order"


def _large(data):
    found = sorted(data["order_id"]) if "order_id" in data else None
    return found == [1001, 1002, 1007, 1009] or f"kept orders {found}, not 1001, 1002, 1007, 1009"


def _ranked(data):
    found = list(data["order_id"]) if "order_id" in data else None
    return (bool(found) and len(found) == 4 and found[0] == 1009 and found[-1] == 1002) \
        or f"order {found}: want the 4 large orders, 1009 first and 1002 last"


def _per_city(data):
    numeric = [sorted(data[c]) for c in data.columns if pd.api.types.is_numeric_dtype(data[c])]
    return (len(data) == 4 and CITY_REVENUE in numeric) \
        or f"{len(data)} rows; want 4 cities with revenue {CITY_REVENUE}"


def _months(data):
    return _column_equal(data, MONTHS) or "no column holds each order's YYYY-MM month"


TASKS: List[Task] = [
    Task("totals", "Add a step called totals with each order's total: price times quantity.",
         '=line_total[mod.map(), mod.name("total")](wf["orders"])', _totals),
    # A map step is only its results: totals holds the totals, on the orders'
    # row ids. zip_ puts each order beside its total for the steps after.
    Task("with_totals", "Add a step called with_totals: each order beside its total.",
         '=zip_(wf["orders"], wf["totals"])', _with_totals),
    Task("large", "Add a step called large that keeps only the orders whose total is over 100.",
         '=is_large_order[mod.filter()](wf["with_totals"], threshold=100)', _large),
    Task("ranked", "Add a step called ranked: the large orders sorted by total, highest first.",
         '=identity[mod.sort(by="total", ascending=False)](wf["large"])', _ranked),
    Task("per_city", "Add a step called per_city with the total revenue for each city.",
         '=sum_totals[mod.collapse(by="city", initial=0)](wf["with_totals"])', _per_city),
    Task("months", "Add a step called months with the month each order was placed.",
         '=month_of[mod.map(), mod.name("month")](wf["orders"])', _months),
]


def as_expectation(task: Task):
    """*task*'s check, in the shape ``Example.check(expect=…)`` takes."""
    return lambda data, metrics: task.check(data)
