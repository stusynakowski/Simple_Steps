"""
tests/test_basic_variables.py
==============================
Tests that the mock_basic_variables project correctly instantiates variables
of every standard Python data type as a single-cell step output.

Formula syntax is Python literal assignment:
    = "hello world"     → str
    = 42                → int
    = 3.14              → float
    = True              → bool
    = [1, 2, 3]         → list
    = {"key": "val"}    → dict
    = {"a": {"b": 1}}   → nested dict

The key invariant under test:
    literal(expr=...) → DataFrame with shape (1, 1)
    └─ column name is "value"
    └─ cell contains the expected Python object

Workflows covered
-----------------
  Individual (1-step each):
    var-string           = "hello world"
    var-int              = 42
    var-float            = 3.14
    var-bool             = True
    var-list             = [1, 2, 3, 4, 5]
    var-dict             = {"name": "alice", "age": 30, "active": True}
    var-nested-dict      = {"user": {...}, "meta": {...}}

  Sequential (all 7 steps in one workflow):
    var-all-types        step-str → step-int → step-float → step-bool
                         → step-list → step-dict → step-nested
"""

import numbers
import sys
from pathlib import Path

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# Path bootstrap — make mock_basic_variables importable
# ---------------------------------------------------------------------------
MOCK_BV = (
    Path(__file__).resolve().parent.parent
    / "mock_projects"
    / "mock_basic_variables"
)
sys.path.insert(0, str(MOCK_BV))

from run_pipeline import PipelineRunner          # noqa: E402 — registers ops
import mock_basic_variables_ops                  # noqa: F401, E402

WORKFLOWS = MOCK_BV / "workflows"


# ---------------------------------------------------------------------------
# Shared helper
# ---------------------------------------------------------------------------

def _run(workflow_filename: str) -> PipelineRunner:
    runner = PipelineRunner(
        str(WORKFLOWS / workflow_filename),
        on_error="raise",
    )
    runner.load()
    runner.run()
    return runner


# ---------------------------------------------------------------------------
# Operation registry
# ---------------------------------------------------------------------------

def test_literal_registered():
    # REQ-CORE-001: literal op declared with @simple_step appears in the registry
    from SIMPLE_STEPS.decorators import OPERATION_REGISTRY
    assert "literal" in OPERATION_REGISTRY, "literal was not registered"


def test_define_variable_registered():
    # define_variable kept for backwards compatibility
    from SIMPLE_STEPS.decorators import OPERATION_REGISTRY
    assert "define_variable" in OPERATION_REGISTRY


# ---------------------------------------------------------------------------
# Shared shape + column assertions (parametrised)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("workflow_file", [
    "var-string.simple-steps-workflow",
    "var-int.simple-steps-workflow",
    "var-float.simple-steps-workflow",
    "var-bool.simple-steps-workflow",
    "var-list.simple-steps-workflow",
    "var-dict.simple-steps-workflow",
    "var-nested-dict.simple-steps-workflow",
])
class TestSingleCellShape:
    """Every variable workflow produces exactly 1 row × 1 column."""

    @pytest.fixture(scope="class")
    def runner(self, request):
        # request.param is set by indirect parametrization — but since we use
        # the class-level parametrize we access the param via the class fixture.
        return _run(request.param)

    def test_no_errors(self, workflow_file):
        # REQ-CORE-001: step executes without errors
        runner = _run(workflow_file)
        assert not runner.errors, f"Unexpected errors: {runner.errors}"

    def test_step_completed(self, workflow_file):
        # step-var must appear in results
        runner = _run(workflow_file)
        assert "step-var" in runner.results, "step-var missing from results"

    def test_single_cell_shape(self, workflow_file):
        # REQ-CORE-001: output is a single-cell DataFrame (1 row, 1 column)
        runner = _run(workflow_file)
        df = runner.results["step-var"].df
        assert df is not None, "DataFrame is None"
        assert df.shape == (1, 1), (
            f"{workflow_file}: expected shape (1, 1), got {df.shape}"
        )

    def test_column_named_value(self, workflow_file):
        # The single column is named "value"
        runner = _run(workflow_file)
        df = runner.results["step-var"].df
        assert list(df.columns) == ["value"], (
            f"{workflow_file}: expected columns ['value'], got {list(df.columns)}"
        )


# ---------------------------------------------------------------------------
# Per-type value assertions
# ---------------------------------------------------------------------------

class TestStringVariable:
    """var-string — cell must be a str."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-string.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_str(self, cell):
        assert isinstance(cell, str), f"Expected str, got {type(cell)}"

    def test_value(self, cell):
        assert cell == "hello world"


class TestIntVariable:
    """var-int — cell must be an integer (Python int or numpy integer)."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-int.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_int(self, cell):
        assert isinstance(cell, (int, np.integer)) and not isinstance(
            cell, (bool, np.bool_)
        ), f"Expected integer, got {type(cell)}"

    def test_value(self, cell):
        assert int(cell) == 42


class TestFloatVariable:
    """var-float — cell must be a float (Python float or numpy floating)."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-float.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_float(self, cell):
        assert isinstance(cell, (float, np.floating)), (
            f"Expected float, got {type(cell)}"
        )

    def test_value(self, cell):
        assert abs(float(cell) - 3.14) < 1e-9


class TestBoolVariable:
    """var-bool — cell must be a boolean."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-bool.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_bool(self, cell):
        assert isinstance(cell, (bool, np.bool_)), (
            f"Expected bool, got {type(cell)}"
        )

    def test_value(self, cell):
        assert bool(cell) is True


class TestListVariable:
    """var-list — cell must be a Python list stored as a single cell."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-list.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_list(self, cell):
        assert isinstance(cell, list), f"Expected list, got {type(cell)}"

    def test_value(self, cell):
        assert cell == [1, 2, 3, 4, 5]


class TestDictVariable:
    """var-dict — cell must be a Python dict stored as a single cell."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-dict.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_dict(self, cell):
        assert isinstance(cell, dict), f"Expected dict, got {type(cell)}"

    def test_has_expected_keys(self, cell):
        assert set(cell.keys()) == {"name", "age", "active"}

    def test_values(self, cell):
        assert cell["name"] == "alice"
        assert cell["age"] == 30
        assert cell["active"] is True


class TestNestedDictVariable:
    """var-nested-dict — cell must be a nested dict stored as a single cell."""

    @pytest.fixture(scope="class")
    def cell(self):
        return _run("var-nested-dict.simple-steps-workflow").results["step-var"].df.iloc[0, 0]

    def test_is_dict(self, cell):
        assert isinstance(cell, dict), f"Expected dict, got {type(cell)}"

    def test_top_level_keys(self, cell):
        assert "user" in cell and "meta" in cell

    def test_nested_user(self, cell):
        assert cell["user"]["name"] == "alice"
        assert cell["user"]["scores"] == [90, 85, 92]

    def test_nested_meta(self, cell):
        assert cell["meta"]["version"] == 1
        assert cell["meta"]["tags"] == ["a", "b"]


# ---------------------------------------------------------------------------
# Sequential workflow — all types in one pipeline
# ---------------------------------------------------------------------------

class TestAllTypesSequential:
    """
    var-all-types — one workflow, 7 steps in sequence.

    Each step uses the literal formula syntax (= <python literal>) and
    produces a 1×1 DataFrame.  This mirrors how a user would define a
    sequence of variables in a single pipeline:

        step-str    = "hello world"
        step-int    = 42
        step-float  = 3.14
        step-bool   = True
        step-list   = [10, 20, 30, 40, 50]
        step-dict   = {"name": "alice", "age": 30, "active": True}
        step-nested = {"user": {...}, "meta": {...}}
    """

    @pytest.fixture(scope="class")
    def runner(self):
        return _run("var-all-types.simple-steps-workflow")

    def test_no_errors(self, runner):
        # REQ-CORE-001: all 7 steps execute without errors
        assert not runner.errors, f"Unexpected errors: {runner.errors}"

    def test_all_steps_completed(self, runner):
        expected = {"step-str", "step-int", "step-float", "step-bool",
                    "step-list", "step-dict", "step-nested"}
        assert expected == set(runner.results.keys())

    @pytest.mark.parametrize("step_id", [
        "step-str", "step-int", "step-float", "step-bool",
        "step-list", "step-dict", "step-nested",
    ])
    def test_each_step_is_single_cell(self, runner, step_id):
        # REQ-CORE-001: every step produces exactly 1 row × 1 column
        df = runner.results[step_id].df
        assert df.shape == (1, 1), f"{step_id}: expected (1,1), got {df.shape}"
        assert list(df.columns) == ["value"], (
            f"{step_id}: expected column 'value', got {list(df.columns)}"
        )

    def test_str_step(self, runner):
        cell = runner.results["step-str"].df.iloc[0, 0]
        assert isinstance(cell, str)
        assert cell == "hello world"

    def test_int_step(self, runner):
        cell = runner.results["step-int"].df.iloc[0, 0]
        assert isinstance(cell, (int, np.integer)) and not isinstance(cell, (bool, np.bool_))
        assert int(cell) == 42

    def test_float_step(self, runner):
        cell = runner.results["step-float"].df.iloc[0, 0]
        assert isinstance(cell, (float, np.floating))
        assert abs(float(cell) - 3.14) < 1e-9

    def test_bool_step(self, runner):
        cell = runner.results["step-bool"].df.iloc[0, 0]
        assert isinstance(cell, (bool, np.bool_))
        assert bool(cell) is True

    def test_list_step(self, runner):
        cell = runner.results["step-list"].df.iloc[0, 0]
        assert isinstance(cell, list)
        assert cell == [10, 20, 30, 40, 50]

    def test_dict_step(self, runner):
        cell = runner.results["step-dict"].df.iloc[0, 0]
        assert isinstance(cell, dict)
        assert cell["name"] == "alice"
        assert cell["age"] == 30
        assert cell["active"] is True

    def test_nested_step(self, runner):
        cell = runner.results["step-nested"].df.iloc[0, 0]
        assert isinstance(cell, dict)
        assert cell["user"]["name"] == "alice"
        assert cell["user"]["scores"] == [90, 85, 92]
        assert cell["meta"]["version"] == 1
        assert cell["meta"]["tags"] == ["a", "b"]
