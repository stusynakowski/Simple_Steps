"""
library_example.py — Using PipelineRunner as a Python library.

Loads runner_example.simple-steps-workflow and exercises the runner API:
  - load() / run()
  - results dict → StepResult.df
  - summary() and show()
  - re-running a single step by building a partial runner
  - filtering / inspecting the final DataFrames directly

Run:
    python library_example.py
"""

import sys
from pathlib import Path

# Allow running from any working directory
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from run_pipeline import PipelineRunner  # noqa: E402

WORKFLOW = str(HERE / "workflows" / "runner_example.simple-steps-workflow")

# ===========================================================================
# 1. Basic load-and-run
# ===========================================================================
print("\n" + "=" * 60)
print("  1. Load and run the full pipeline")
print("=" * 60)

runner = PipelineRunner(
    WORKFLOW,
    continue_on_error=True,
    wait_for_stable=True,
    stable_checks=2,
    poll_interval=0.25,
)
runner.load()
runner.run()

# ===========================================================================
# 2. Summary table
# ===========================================================================
print("=" * 60)
print("  2. Summary")
print("=" * 60)

runner.summary()

# ===========================================================================
# 3. Access individual step DataFrames
# ===========================================================================
print("=" * 60)
print("  3. Inspect individual step outputs")
print("=" * 60)

# Step 1 — Fetch Videos: single 'output' column of video URLs
fetch_df = runner.results["step-0-fetch"].df
print(f"\n  Fetch Videos — {len(fetch_df)} rows")
print(fetch_df["output"].to_string(index=True))

# Step 4 — Analyze Sentiment (may be blocked if an upstream step failed)
sentiment_result = runner.results.get("step-4-sentiment")
if sentiment_result:
    sentiment_df = sentiment_result.df
    if sentiment_df is not None and "analyze_sentiment_output" in sentiment_df.columns:
        print(f"\n  Analyze Sentiment — scores sample:")
        print(sentiment_df[["segment_conversations_output", "analyze_sentiment_output"]].head(5).to_string(index=True))
else:
    print("\n  Analyze Sentiment — (blocked: upstream step did not produce staged output)")

# Step 5 — Generate Report (may be blocked if an upstream step failed)
report_result = runner.results.get("step-5-report")
if report_result:
    report_df = report_result.df
    if report_df is not None and "generate_report_output" in report_df.columns:
        print(f"\n  Generate Report — first report entry:")
        print(" ", report_df["generate_report_output"].iloc[0])
else:
    print("  Generate Report — (blocked: upstream step did not produce staged output)")

# ===========================================================================
# 4. Check which steps errored
# ===========================================================================
print("\n" + "=" * 60)
print("  4. Errors (expected — video_error is a mock simulation)")
print("=" * 60)

if runner.errors:
    for step_id, msg in runner.errors.items():
        label = next(
            (s.label for s in runner.pipeline.steps if s.step_id == step_id),
            step_id,
        )
        print(f"  ✗ {label}: {msg}")
else:
    print("  (no errors)")

# ===========================================================================
# 5. Run only the first 2 steps (fetch + metadata)
# ===========================================================================
print("\n" + "=" * 60)
print("  5. Partial run — first 2 steps only")
print("=" * 60)

partial = PipelineRunner(WORKFLOW, stop_after=2, continue_on_error=True)
partial.load()
partial.run()
partial.summary()

metadata_df = partial.results.get("step-1-metadata")
if metadata_df:
    df = metadata_df.df
    print("  Metadata columns:", list(df.columns))
    print(df[["title", "views", "condition"]].head(5).to_string(index=True))
else:
    print("  (metadata step failed or was skipped)")

# ===========================================================================
# 6. Strict mode — abort on first error
# ===========================================================================
print("\n" + "=" * 60)
print("  6. Strict mode — aborts on first error")
print("=" * 60)

strict = PipelineRunner(WORKFLOW, on_error="raise")
strict.load()
try:
    strict.run()
except Exception as exc:
    completed = list(strict.results.keys())
    print(f"  Caught: {exc.__class__.__name__}: {exc}")
    print(f"  Completed before failure: {completed}")

# ===========================================================================
# 7. show() helper — formatted DataFrame previews
# ===========================================================================
print("\n" + "=" * 60)
print("  7. show() — formatted preview of the sentiment step")
print("=" * 60)

runner.show(step_id="step-4-sentiment", n=4)
