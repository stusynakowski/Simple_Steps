import os
import sys
import pytest
from pathlib import Path

# Import PipelineRunner from the table manipulations mock project
sys.path.insert(0, str(Path(__file__).parent.parent / "mock_projects" / "mock_table_manipulations"))
from run_pipeline import PipelineRunner

WORKFLOW_DIR = Path(__file__).parent.parent / "mock_projects" / "mock_tabular_selection" / "workflows"

def test_select_table():
    runner = PipelineRunner(str(WORKFLOW_DIR / "select-table.simple-steps-workflow"))
    runner.load().run()
    # Last step result
    result = list(runner.results.values())[-1].df
    assert result.shape == (3, 3)
    assert set(result.columns) == {"name", "score", "age"}

def test_select_columns():
    runner = PipelineRunner(str(WORKFLOW_DIR / "select-columns.simple-steps-workflow"))
    runner.load().run()
    result = list(runner.results.values())[-1].df
    assert set(result.columns) == {"name", "score"}
    assert result.shape == (3, 2)

def test_select_rows():
    runner = PipelineRunner(str(WORKFLOW_DIR / "select-rows.simple-steps-workflow"))
    runner.load().run()
    result = list(runner.results.values())[-1].df
    assert result.shape[0] == 2
    assert set(result.columns) == {"name", "score", "age"}
    assert result["name"].tolist() == ["alice", "carol"]

def test_select_cell():
    runner = PipelineRunner(str(WORKFLOW_DIR / "select-cell.simple-steps-workflow"))
    runner.load().run()
    result = list(runner.results.values())[-1].df
    # Accept both scalar and single-value DataFrame
    if hasattr(result, 'item'):
        assert result.item() == 75
    else:
        assert result.iloc[0][0] == 75
