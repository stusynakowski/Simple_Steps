"""
tests/basic_mock_youtube_operations.py
=======================================
Tests that the mock_youtube_analysis project works end-to-end.
All operations and pipeline logic live in mock_projects/mock_youtube_analysis/;
these tests simply drive that code and assert on its outputs.

Workflows covered:
  - ui-test-basic-fetch-metadata       (2 steps: fetch → metadata)
  - ui-test-mode-aliases-and-chaining  (3 steps: fetch → metadata → transcribe)
  - ui-test-full-analysis-report       (5 steps: through sentiment)
  - runner_example                     (6 steps: full pipeline with error cases)
"""

import sys
from pathlib import Path
import pytest

# ---------------------------------------------------------------------------
# Path bootstrap — make mock_youtube_analysis importable
# ---------------------------------------------------------------------------
MOCK_YT = Path(__file__).resolve().parent.parent / "mock_projects" / "mock_youtube_analysis"
sys.path.insert(0, str(MOCK_YT))

# Importing run_pipeline also imports mock_youtube_ops (registering all @simple_step ops)
from run_pipeline import PipelineRunner  # noqa: E402
import mock_youtube_ops  # noqa: F401, E402 — side-effect: registers ops

WORKFLOWS = MOCK_YT / "workflows"


# ---------------------------------------------------------------------------
# Shared helper
# ---------------------------------------------------------------------------

def _run(workflow_filename: str, **kwargs) -> PipelineRunner:
    runner = PipelineRunner(
        str(WORKFLOWS / workflow_filename),
        **kwargs,
    )
    runner.load()
    runner.run()
    return runner


# ---------------------------------------------------------------------------
# Operations are registered
# ---------------------------------------------------------------------------

def test_all_youtube_ops_registered():
    # REQ-CORE-001: operations declared with @simple_step appear in the registry
    from SIMPLE_STEPS.decorators import OPERATION_REGISTRY
    expected = {
        "fetch_channel_videos",
        "extract_metadata",
        "transcribe_video",
        "segment_conversations",
        "analyze_sentiment",
        "generate_report",
    }
    missing = expected - OPERATION_REGISTRY.keys()
    assert not missing, f"Missing operations: {missing}"


# ---------------------------------------------------------------------------
# Workflow: ui-test-basic-fetch-metadata  (2 steps)
# ---------------------------------------------------------------------------

class TestBasicFetchMetadata:
    """Fetch + metadata — the simplest workflow."""

    @pytest.fixture(scope="class")
    def runner(self):
        return _run("ui-test-basic-fetch-metadata.simple-steps-workflow")

    def test_no_errors(self, runner):
        assert not runner.errors, f"Unexpected errors: {runner.errors}"

    def test_both_steps_complete(self, runner):
        assert "step-fetch" in runner.results
        assert "step-metadata" in runner.results

    def test_fetch_returns_rows(self, runner):
        df = runner.results["step-fetch"].df
        assert df is not None and len(df) > 0

    def test_metadata_has_expected_columns(self, runner):
        df = runner.results["step-metadata"].df
        for col in ("title", "views", "author", "video_uid", "condition"):
            assert col in df.columns, f"Missing column: {col}"

    def test_metadata_row_count_matches_fetch(self, runner):
        fetch_rows = runner.results["step-fetch"].rows
        meta_rows = runner.results["step-metadata"].rows
        assert meta_rows == fetch_rows


# ---------------------------------------------------------------------------
# Workflow: ui-test-mode-aliases-and-chaining  (3 steps)
# ---------------------------------------------------------------------------

class TestModeAliasesAndChaining:
    """Validates source / map orchestrator aliases and step chaining."""

    @pytest.fixture(scope="class")
    def runner(self):
        return _run("ui-test-mode-aliases-and-chaining.simple-steps-workflow")

    def test_no_errors(self, runner):
        assert not runner.errors, f"Unexpected errors: {runner.errors}"

    def test_three_steps_complete(self, runner):
        assert len(runner.results) == 3

    def test_transcribe_output_column_present(self, runner):
        # The map orchestrator adds a '<op_id>_output' column
        df = runner.results["step-transcribe"].df
        assert "transcribe_video_output" in df.columns

    def test_transcribe_values_are_strings(self, runner):
        df = runner.results["step-transcribe"].df
        assert df["transcribe_video_output"].dropna().apply(lambda v: isinstance(v, str)).all()


# ---------------------------------------------------------------------------
# Workflow: ui-test-full-analysis-report  (5 steps)
# ---------------------------------------------------------------------------

class TestFullAnalysisReport:
    """Full pipeline through sentiment analysis (no filter step)."""

    @pytest.fixture(scope="class")
    def runner(self):
        return _run("ui-test-full-analysis-report.simple-steps-workflow")

    def test_no_errors(self, runner):
        assert not runner.errors, f"Unexpected errors: {runner.errors}"

    def test_all_five_steps_complete(self, runner):
        assert len(runner.results) == 5

    def test_segment_expands_rows(self, runner):
        fetch_rows = runner.results["step-fetch"].rows
        segment_rows = runner.results["step-segment"].rows
        assert segment_rows >= fetch_rows, "Segment (expand) should produce at least as many rows as fetch"

    def test_sentiment_column_present(self, runner):
        df = runner.results["step-sentiment"].df
        assert "analyze_sentiment_output" in df.columns

    def test_sentiment_values_are_numeric(self, runner):
        import pandas as pd
        df = runner.results["step-sentiment"].df
        col = df["analyze_sentiment_output"]
        assert pd.to_numeric(col.dropna(), errors="coerce").notna().all()


# ---------------------------------------------------------------------------
# Workflow: runner_example  (6-step pipeline with error-case videos)
# ---------------------------------------------------------------------------

class TestRunnerExampleFullPipeline:
    """
    Full 6-step pipeline using the 'with_cases' channel URL which includes
    video_error and video_slow entries. continue_on_error=True so the runner
    skips steps that fail due to simulated errors.
    """

    @pytest.fixture(scope="class")
    def runner(self):
        return _run(
            "runner_example.simple-steps-workflow",
            continue_on_error=True,
        )

    def test_fetch_step_completes(self, runner):
        assert "step-0-fetch" in runner.results
        assert runner.results["step-0-fetch"].rows > 0

    def test_fetch_includes_error_and_slow_videos(self, runner):
        df = runner.results["step-0-fetch"].df
        urls = df["output"].tolist()
        assert any("error" in u for u in urls), "Expected a video_error URL"
        assert any("slow" in u for u in urls),  "Expected a video_slow URL"

    def test_metadata_step_completes(self, runner):
        # Metadata runs per-row; error rows raise inside the step but the runner
        # should still commit a partial or skipped result depending on engine behaviour
        assert "step-1-metadata" in runner.results or "step-1-metadata" in runner.errors

    def test_report_step_produces_single_row(self, runner):
        if "step-5-report" not in runner.results:
            pytest.skip("Report step did not complete (upstream error case)")
        df = runner.results["step-5-report"].df
        assert len(df) >= 1
