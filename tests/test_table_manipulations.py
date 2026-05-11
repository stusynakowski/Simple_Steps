"""
tests/test_table_manipulations.py
===================================
Tests for the mock_table_manipulations project.

Design principles under test
------------------------------
  - Rows   = observations/iterations  (one thing per row)
  - Columns = variables/attributes    (one attribute per column)

The key operation is ``expand_cell``, which recursively normalises a single-cell
value (typically produced by ``define_variable``) into a proper DataFrame that
reflects the structure of the source data:

  list of scalars         → N rows × 1 col  ("value")
  list of flat dicts      → N rows × M cols (dict keys become columns)
  list of nested dicts    → N rows × M cols (nested keys flattened: "a.b")
  flat dict               → 1 row  × M cols
  nested dict             → 1 row  × M cols (nested keys flattened)

Workflows covered
-----------------
  expand-list-scalars           2 steps  (define_variable → expand_cell)
  expand-list-of-dicts          2 steps
  expand-flat-dict              2 steps
  expand-nested-dict            2 steps
  expand-list-nested-dicts      2 steps
  make-table-direct             1 step   (make_table — source op)
"""

import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
MOCK_TBL = (
    Path(__file__).resolve().parent.parent
    / "mock_projects"
    / "mock_table_manipulations"
)
sys.path.insert(0, str(MOCK_TBL))

from run_pipeline import PipelineRunner   # noqa: E402 — registers ops
import mock_table_ops                     # noqa: F401, E402

WORKFLOWS = MOCK_TBL / "workflows"


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
# Registry
# ---------------------------------------------------------------------------

def test_table_ops_registered():
    # REQ-CORE-001: operations declared with @simple_step appear in the registry
    from SIMPLE_STEPS.decorators import OPERATION_REGISTRY
    assert "expand_cell" in OPERATION_REGISTRY, "expand_cell not in registry"
    assert "make_table" in OPERATION_REGISTRY,  "make_table not in registry"


# ---------------------------------------------------------------------------
# expand-list-scalars
# A list of integers must become N rows × 1 column ("value").
# Rows = individual observations; a single attribute per observation.
# ---------------------------------------------------------------------------

class TestExpandListScalars:
    """[1, 2, 3, 4, 5] → 5 rows × 1 column "value"."""

    @pytest.fixture(scope="class")
    def df(self):
        return _run("expand-list-scalars.simple-steps-workflow").results["step-expand"].df

    def test_no_errors(self):
        runner = _run("expand-list-scalars.simple-steps-workflow")
        assert not runner.errors

    def test_shape(self, df):
        # REQ-CORE-001: rows = items in the list
        assert df.shape == (5, 1), f"Expected (5, 1), got {df.shape}"

    def test_column_name(self, df):
        assert list(df.columns) == ["value"]

    def test_values(self, df):
        assert list(df["value"]) == [1, 2, 3, 4, 5]


# ---------------------------------------------------------------------------
# expand-list-of-dicts
# A list of flat dicts must become N rows with keys as columns.
# Rows = each dict (one person); columns = their attributes.
# ---------------------------------------------------------------------------

class TestExpandListOfDicts:
    """[{name, score}, ...] → 3 rows × columns "name", "score"."""

    @pytest.fixture(scope="class")
    def df(self):
        return _run("expand-list-of-dicts.simple-steps-workflow").results["step-expand"].df

    def test_no_errors(self):
        runner = _run("expand-list-of-dicts.simple-steps-workflow")
        assert not runner.errors

    def test_shape(self, df):
        assert df.shape == (3, 2), f"Expected (3, 2), got {df.shape}"

    def test_columns(self, df):
        assert set(df.columns) == {"name", "score"}

    def test_rows_are_observations(self, df):
        names = list(df["name"])
        assert "alice" in names
        assert "bob" in names
        assert "carol" in names

    def test_scores(self, df):
        by_name = df.set_index("name")["score"].to_dict()
        assert by_name["alice"] == 90
        assert by_name["bob"] == 75
        assert by_name["carol"] == 88


# ---------------------------------------------------------------------------
# expand-flat-dict
# A single flat dict must become 1 row with keys as columns.
# One observation (the object) with M attributes.
# ---------------------------------------------------------------------------

class TestExpandFlatDict:
    """{name, age, active} → 1 row × columns "name", "age", "active"."""

    @pytest.fixture(scope="class")
    def df(self):
        return _run("expand-flat-dict.simple-steps-workflow").results["step-expand"].df

    def test_no_errors(self):
        runner = _run("expand-flat-dict.simple-steps-workflow")
        assert not runner.errors

    def test_shape(self, df):
        assert df.shape == (1, 3), f"Expected (1, 3), got {df.shape}"

    def test_columns(self, df):
        assert set(df.columns) == {"name", "age", "active"}

    def test_values(self, df):
        row = df.iloc[0]
        assert row["name"] == "alice"
        assert int(row["age"]) == 30
        assert bool(row["active"]) is True


# ---------------------------------------------------------------------------
# expand-nested-dict
# A nested dict must be flattened: nested keys become "parent.child" columns.
# Structure: {user: {name, age}, meta: {version, active}}
# ---------------------------------------------------------------------------

class TestExpandNestedDict:
    """Nested dict → 1 row × dot-notation columns."""

    @pytest.fixture(scope="class")
    def df(self):
        return _run("expand-nested-dict.simple-steps-workflow").results["step-expand"].df

    def test_no_errors(self):
        runner = _run("expand-nested-dict.simple-steps-workflow")
        assert not runner.errors

    def test_shape(self, df):
        # 1 row; 4 flattened columns: user.name, user.age, meta.version, meta.active
        assert df.shape == (1, 4), f"Expected (1, 4), got {df.shape}"

    def test_dot_notation_columns(self, df):
        assert "user.name" in df.columns
        assert "user.age" in df.columns
        assert "meta.version" in df.columns
        assert "meta.active" in df.columns

    def test_nested_values_accessible(self, df):
        row = df.iloc[0]
        assert row["user.name"] == "alice"
        assert int(row["user.age"]) == 30
        assert int(row["meta.version"]) == 1
        assert bool(row["meta.active"]) is True


# ---------------------------------------------------------------------------
# expand-list-nested-dicts
# A list of objects each containing a nested sub-dict.
# Each object → 1 row; nested keys flattened to dot-notation columns.
# ---------------------------------------------------------------------------

class TestExpandListNestedDicts:
    """[{name, address: {city, zip}}, ...] → 3 rows × "name", "address.city", "address.zip"."""

    @pytest.fixture(scope="class")
    def df(self):
        return _run("expand-list-nested-dicts.simple-steps-workflow").results["step-expand"].df

    def test_no_errors(self):
        runner = _run("expand-list-nested-dicts.simple-steps-workflow")
        assert not runner.errors

    def test_shape(self, df):
        assert df.shape == (3, 3), f"Expected (3, 3), got {df.shape}"

    def test_columns(self, df):
        assert set(df.columns) == {"name", "address.city", "address.zip"}

    def test_rows_are_observations(self, df):
        names = list(df["name"])
        assert "alice" in names
        assert "bob" in names
        assert "carol" in names

    def test_flat_dot_notation_values(self, df):
        by_name = df.set_index("name")
        assert by_name.loc["alice", "address.city"] == "NYC"
        assert by_name.loc["bob",   "address.city"] == "LA"
        assert by_name.loc["carol", "address.city"] == "Chicago"

    def test_zip_codes(self, df):
        by_name = df.set_index("name")
        assert by_name.loc["alice", "address.zip"] == "10001"
        assert by_name.loc["bob",   "address.zip"] == "90001"


# ---------------------------------------------------------------------------
# make-table-direct
# make_table creates a proper table in one step (no variable step needed).
# ---------------------------------------------------------------------------

class TestMakeTableDirect:
    """make_table → 3 rows × columns "product", "qty", "price"."""

    @pytest.fixture(scope="class")
    def df(self):
        return _run("make-table-direct.simple-steps-workflow").results["step-table"].df

    def test_no_errors(self):
        runner = _run("make-table-direct.simple-steps-workflow")
        assert not runner.errors

    def test_shape(self, df):
        assert df.shape == (3, 3), f"Expected (3, 3), got {df.shape}"

    def test_columns(self, df):
        assert set(df.columns) == {"product", "qty", "price"}

    def test_rows_are_observations(self, df):
        products = list(df["product"])
        assert "apple" in products
        assert "banana" in products
        assert "cherry" in products

    def test_numeric_columns(self, df):
        by_product = df.set_index("product")
        assert int(by_product.loc["apple",  "qty"]) == 10
        assert int(by_product.loc["banana", "qty"]) == 6
        assert int(by_product.loc["cherry", "qty"]) == 100
        assert abs(float(by_product.loc["apple",  "price"]) - 1.5)  < 1e-9
        assert abs(float(by_product.loc["banana", "price"]) - 0.75) < 1e-9
