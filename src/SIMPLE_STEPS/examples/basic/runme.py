"""
runme.py — run the basic example's workflows and check every step.

    python examples/basic/runme.py

For each saved workflow in ``workspace/projects/basic/``, every step is run
the way the UI runs it, then compared with the same workflow written in
Python (``basic_pipeline.py``) and run straight in simple-steps-core. A few steps
are also checked against values written out below, so a mistake both share
still fails. Exits non-zero if any step doesn't match.
"""

import sys
from pathlib import Path

from SIMPLE_STEPS.example_check import Example

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

import basic_pipeline as pipeline  # noqa: E402


def verb(expected):
    """The step ran as *expected* (map, filter, …): for steps whose verb core inferred."""
    return lambda data, metrics: metrics.get("verb") == expected or f"ran as {metrics.get('verb')}, not {expected}"


example.check("basic", "all-orchestrations", twin=pipeline.build_all_orchestrations, expect={
    "scored": {"score": [10, 20, 30, 20]},
    "kept": {"n": [2, 3, 2]},
    "per_city": {"bucket": ["SF", "NYC", "LA"], "value": [4, 2, 2]},
    "n_rows": {"value": [4]},
    "sum_n": {"value": [8]},
    "bursts": {"item": [1, 2, 2, 3, 3, 3, 2, 2]},
    "grid_search": {"model": ["a", "a", "b", "b"], "window": [7, 30, 7, 30],
                    "value": ["a:7", "a:30", "b:7", "b:30"]},
    "auto_map": verb("map"),
    "auto_filter": verb("filter"),
    "auto_collapse": verb("collapse"),
    "auto_expand": verb("expand"),
    "from_list": {"value": [1, 2, 3, 4]},
    "split": {"c0": [10, 20, 30, 20], "c1": [1, 4, 9, 4]},
    "gathered": {"n": [[1, 2, 3, 2]]},           # one list per column
    "enriched": {"region": ["west", "east", "west", "west"]},
    "all_readings": {"city": ["SF", "NYC", "SF", "LA", "BOS", "SEA"]},
    # rows 1 and 3 have n == 2, which risky refuses; try_except lets them through
    "failure": lambda data, metrics: (metrics.get("failed") == 2 and metrics.get("uncaught_failed") == 0
                                      and list(data["out"])[0::2] == [100, 300])
               or f"failed={metrics.get('failed')}, uncaught={metrics.get('uncaught_failed')}, out={list(data['out'])}",
})

example.check("basic", "table-tools", twin=pipeline.build_table_tools, expect={
    "numbers": {"n": [1, 2, 3, 4, 5, 6]},
    "doubled": {"doubled": [2, 4, 6, 8, 10, 12]},
    # sometimes_fails refuses multiples of 3; try_except(default=-1) fills them in
    "checked": {"checked": [1, 2, -1, 4, 5, -1]},
    "series": {"item": [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7]},
    "top3": lambda data, metrics: (len(data) == 3 and list(data["score"]) == sorted(data["score"], reverse=True))
            or f"not the 3 highest scores, in order: {list(data['score'])}",
    "per_city": lambda data, metrics: sum(data["count"]) == 8 or f"counts add up to {sum(data['count'])}, not 8",
    "counted": {"words": [2, 1, 3]},
    "shout": {"upper": ["ALPHA BETA", "GAMMA", "DELTA EPSILON ZETA"]},
    "backward": {"reversed": ["ateb ahpla", "ammag", "atez nolispe atled"]},
    "empty_described": {"column": ["a", "b"], "non_null": [0, 0]},
})

sys.exit(example.finish())
