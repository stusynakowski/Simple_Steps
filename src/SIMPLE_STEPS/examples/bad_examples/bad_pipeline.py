"""
bad_pipeline.py — the corrected workflow, written in Python.

The twin of ``workspace/projects/bad_examples/corrected.simple-steps-workflow``:
one Python line per saved step, each case's correction from ``bad_cases.py``.
``runme.py`` runs both and checks every step's output is the same.

The mistakes have no twin: they're the formulas that don't make a step.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import mod, op, stack, zip_

from SIMPLE_STEPS.catalog import catalog

from SIMPLE_STEPS.operations import to_rows

from bad_tools import add_one_or_zero, describe_rows, double_n, greet, label, reciprocal

identity = op("identity")  # core's built-in tool, by name, as core's own example writes it


def build_corrected() -> Kernel:
    wf = Kernel(catalog())

    # the sources every case reads
    wf["readings"] = to_rows[mod.source()](data='{"city": ["SF", "NYC", "LA"], "n": [1, 0, 2]}')
    wf["more"] = to_rows[mod.source()](data='{"city": ["BOS"], "n": [5]}')
    wf["gappy"] = to_rows[mod.source()](data='{"n": [1, null, 3]}')
    wf["people"] = to_rows[mod.source()](data='{"first": ["Ada", "Bo"]}')
    wf["scored"] = double_n[mod.map()](wf["readings"])
    wf["doubled"] = double_n[mod.map(), mod.name("n")](wf["readings"])
    wf["people_named"] = identity[mod.rename(columns={"first": "name"})](wf["people"])

    # referring to steps
    wf["bare_name"] = double_n[mod.map()](wf["readings"])
    wf["quoted_name"] = double_n[mod.map()](wf["readings"])
    wf["missing_step"] = double_n[mod.map()](wf["readings"])
    wf["two_inputs"] = stack(wf["readings"], wf["more"])
    wf["row_selection"] = identity[mod.slice(stop=2)](wf["readings"])

    # tools and modifiers
    wf["unknown_tool"] = double_n[mod.map()](wf["readings"])
    wf["unknown_modifier"] = double_n[mod.map()](wf["readings"])
    wf["no_verb"] = double_n[mod.map(), mod.retry(times=2)](wf["readings"])
    wf["misspelt_setting"] = double_n[mod.map(), mod.name("doubled")](wf["readings"])
    wf["missing_setting"] = double_n[mod.map(), mod.retry(times=2)](wf["readings"])
    wf["setting_is_a_step"] = identity[mod.sort(by="n")](wf["readings"])
    wf["not_a_literal"] = greet[mod.map()](wf["readings"], name="ADA")

    # columns and types
    wf["missing_column"] = identity[mod.select(columns=["n"])](wf["readings"])
    wf["parameter_not_a_column"] = greet[mod.map()](wf["people_named"])
    wf["reads_a_result"] = double_n[mod.map()](wf["readings"])
    wf["zip_shares_a_column"] = zip_(wf["readings"], wf["scored"])
    wf["nullable_column"] = add_one_or_zero[mod.map()](wf["gappy"])
    wf["table_returns_text"] = describe_rows[mod.table()](wf["readings"])

    # ran, but warned
    wf["argument_hides_column"] = label[mod.map()](wf["readings"])

    # ran, but rows failed
    wf["uncaught_failure"] = reciprocal[mod.map(), mod.try_except(default=0.0)](wf["readings"])
    return wf
