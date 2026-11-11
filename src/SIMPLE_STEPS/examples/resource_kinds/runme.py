"""
runme.py — run the resource kinds example's workflow and check every step.

    python examples/resource_kinds/runme.py

Every resource is a deterministic dummy, so each step's answer is known.
Exits non-zero if any step doesn't match.
"""

import sys
from pathlib import Path

from SIMPLE_STEPS.example_check import Example

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

from resource_tools import WeatherAPI  # noqa: E402

weather = WeatherAPI()

example.check("resource_kinds", "resource-kinds", expect={
    "regions": {"regions": ["west", "east", "west"]},
    "temps": {"temps": [weather.temperature(c) for c in ("SF", "NYC", "LA")]},
    "texts": {"texts": ["hello", "load, refresh, clear"]},
    "sizes": {"sizes": [5, 20]},
    "squares": {"squares": [1, 4, 9]},
    # which build answered depends on the session; the settings don't
    "pool_info": lambda data, metrics: (str(data["pool_info"].iloc[0]).endswith(": 2 workers")
                                        or f"got {list(data['pool_info'])}"),
    "answer": {"answer": ["[echo-1] HELLO"]},
    # the deployment's shared_fs, used as it is
    "policy": {"policy": ["read only"]},
})

sys.exit(example.finish())
