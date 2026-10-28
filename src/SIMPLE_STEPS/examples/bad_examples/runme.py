"""
runme.py — check every mistake goes wrong the way it should, and every fix works.

    python examples/bad_examples/runme.py

``mistakes``: each case's step must be refused, warn, or fail rows — as
``bad_cases.py`` says it does — in the words it lists. ``corrected``: each
case's fix must run cleanly (no warning, no failed row nothing caught) and
match its Python twin (``bad_pipeline.py``). Exits non-zero otherwise.
"""

import json
import sys
from pathlib import Path

from SIMPLE_STEPS.example_check import Example, fails, refused, warns

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

import bad_cases  # noqa: E402
import bad_pipeline as pipeline  # noqa: E402

# The saved files are built from bad_cases.py; a hand edit to either side
# would make them disagree silently.
for name, doc in bad_cases.workflows().items():
    saved = json.loads((bad_cases.PROJECT / f"{name}.simple-steps-workflow").read_text())
    if saved["steps"] != doc["steps"]:
        print(f"{name}.simple-steps-workflow doesn't match bad_cases.py; "
              "rewrite it with: python examples/bad_examples/bad_cases.py")
        sys.exit(1)
if (HERE / "README.md").read_text() != bad_cases.readme():
    print("README.md doesn't match bad_cases.py; rewrite it with: python examples/bad_examples/bad_cases.py")
    sys.exit(1)

EXPECT = {"refused": refused, "warns": warns, "fails": fails}

example.check("bad_examples", "mistakes", strict=True,
              expect={case.id: EXPECT[case.kind](case.says) for case in bad_cases.CASES})

example.check("bad_examples", "corrected", twin=pipeline.build_corrected, strict=True, expect={
    "two_inputs": {"city": ["SF", "NYC", "LA", "BOS"]},
    "row_selection": {"city": ["SF", "NYC"]},
    "parameter_not_a_column": {"value": ["hi Ada", "hi Bo"]},
    "nullable_column": {"value": [2, 0, 4]},
    "table_returns_text": {"column": ["city", "n"], "non_null": [3, 3]},
    "argument_hides_column": {"value": ["city of SF", "city of NYC", "city of LA"]},
    "reads_a_result": {"value": [2, 0, 4]},
    "zip_shares_a_column": {"n": [1, 0, 2], "value": [2, 0, 4]},
    # NYC's n is 0: 1/0 raises, try_except(default=0.0) fills it in, and core
    # says so (the twin checks the values)
    "uncaught_failure": warns("1 row used try_except's default"),
})

sys.exit(example.finish())
