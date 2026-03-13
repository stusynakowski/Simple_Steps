"""
basic_mock_youtube_operations.py
=================================
End-to-end test of the SimpleSteps orchestration engine using plain Python
functions registered via register_operation — no @simple_step decorator.

Pipeline:
  Step 1  fetch_videos        → source     → list of URLs → DataFrame
  Step 2  extract_metadata    → map        → enrich each row with title/views/author
  Step 3  is_video_popular    → filter     → keep rows where views > threshold
  Step 4  transcribe          → map        → add transcript column
  Step 5  analyze_sentiment   → dataframe  → add sentiment_score column
  Step 6  generate_report     → dataframe  → produce single summary row

Run:
    python -m tests.basic_mock_youtube_operations
  or from the repo root:
    python tests/basic_mock_youtube_operations.py
"""

import sys
import os

# Make sure src/ is importable when running this file directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pandas as pd
from SIMPLE_STEPS.decorators import register_operation, OPERATION_REGISTRY
from SIMPLE_STEPS.engine import run_operation, DATA_STORE


# ──────────────────────────────────────────────────────────────────────────────
# 1. Pure functions — zero SimpleSteps imports, fully portable
# ──────────────────────────────────────────────────────────────────────────────

def fetch_videos(channel_url: str = "https://youtube.com/mock_channel"):
    """Return a list of mock video URLs for a channel."""
    return [
        f"{channel_url}/video/1",
        f"{channel_url}/video/2",
        f"{channel_url}/video/3",
        f"{channel_url}/video/4",
        f"{channel_url}/video/5",
    ]


def extract_metadata(url: str) -> dict:
    """Return title, views, and author for a single video URL."""
    return {
        "title":  f"Video Title for {str(url).split('/')[-1]}",
        "views":  len(str(url)) * 100,
        "author": "Mock Channel",
    }


def is_video_popular(views: int = 0, min_views: int = 1000) -> bool:
    """Return True if the video exceeds the minimum view threshold."""
    return int(views) > int(min_views)


def transcribe(url: str) -> str:
    """Return a mock transcript string for a video URL."""
    return f"Transcript content for {url}..."


def analyze_sentiment(data: pd.DataFrame) -> pd.DataFrame:
    """
    Add a sentiment_score column to the DataFrame.
    Reads from the 'transcribe_output' column produced by the transcribe step.
    """
    result = data.copy()
    result["sentiment_score"] = result["transcribe_output"].apply(
        lambda x: float(len(str(x)) % 10) / 10.0
    )
    return result


def generate_report(metrics_df: pd.DataFrame) -> pd.DataFrame:
    """Summarise the full pipeline output into a single report row."""
    avg = metrics_df["sentiment_score"].mean()
    return pd.DataFrame([{
        "total_videos_analyzed": len(metrics_df),
        "average_sentiment":     round(avg, 4),
        "status":                "Report Generated",
    }])


# The engine passes the input DataFrame as '_input_df' into the resolved config.
# The dataframe_op_wrapper calls func(**resolved_config), so dataframe-mode
# functions must accept '_input_df' as their first positional parameter name,
# OR we provide thin adapter wrappers here that rename it — without touching
# the originals.

def _analyze_sentiment_adapter(_input_df: pd.DataFrame, **_) -> pd.DataFrame:
    """Engine-facing adapter: renames _input_df → data."""
    return analyze_sentiment(_input_df)


def _generate_report_adapter(_input_df: pd.DataFrame, **_) -> pd.DataFrame:
    """Engine-facing adapter: renames _input_df → metrics_df."""
    return generate_report(_input_df)


# ──────────────────────────────────────────────────────────────────────────────
# 2. Register — one line per function
# ──────────────────────────────────────────────────────────────────────────────

register_operation(fetch_videos,              "mock_fetch_videos",      "Fetch Channel Videos",   "Mock YouTube", "source")
register_operation(extract_metadata,          "mock_extract_metadata",  "Extract Video Metadata", "Mock YouTube", "map")
register_operation(is_video_popular,          "mock_filter_popular",    "Filter Popular Videos",  "Mock YouTube", "filter")
register_operation(transcribe,                "mock_transcribe",        "Transcribe Video",        "Mock YouTube", "map")
register_operation(_analyze_sentiment_adapter,"mock_analyze_sentiment", "Analyze Sentiment",       "Mock YouTube", "dataframe")
register_operation(_generate_report_adapter,  "mock_generate_report",   "Generate Report",         "Mock YouTube", "dataframe")


# ──────────────────────────────────────────────────────────────────────────────
# 3. Run the pipeline through the real engine
# ──────────────────────────────────────────────────────────────────────────────

def run_pipeline():
    step_map: dict[str, str] = {}   # step_id → DATA_STORE ref_id

    # ── Step 1: source ────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("STEP 1 — fetch_videos  [source]")
    print("="*60)
    ref1, meta1 = run_operation(
        op_id         = "mock_fetch_videos",
        config        = {"channel_url": "https://youtube.com/mock_channel"},
        input_ref_id  = None,
        step_label_map= step_map,
    )
    step_map["step1"] = ref1
    df1 = DATA_STORE[ref1]
    print(df1.to_string(index=False))
    print(f"\n→ {meta1}")

    # ── Step 2: map ───────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("STEP 2 — extract_metadata  [map]")
    print("="*60)
    ref2, meta2 = run_operation(
        op_id         = "mock_extract_metadata",
        config        = {"url": "output"},   # column name in step1's DataFrame
        input_ref_id  = ref1,
        step_label_map= step_map,
    )
    step_map["step2"] = ref2
    df2 = DATA_STORE[ref2]
    print(df2.to_string(index=False))
    print(f"\n→ {meta2}")

    # ── Step 3: filter ────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("STEP 3 — is_video_popular  [filter]  (min_views=3000)")
    print("="*60)
    ref3, meta3 = run_operation(
        op_id         = "mock_filter_popular",
        config        = {
            "views":     "views",   # column name in step2's DataFrame
            "min_views": 3000,
        },
        input_ref_id  = ref2,
        step_label_map= step_map,
    )
    step_map["step3"] = ref3
    df3 = DATA_STORE[ref3]
    print(f"Filtered {len(df2)} → {len(df3)} rows")
    print(df3.to_string(index=False))
    print(f"\n→ {meta3}")

    # ── Step 4: map ───────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("STEP 4 — transcribe  [map]")
    print("="*60)
    ref4, meta4 = run_operation(
        op_id         = "mock_transcribe",
        config        = {"url": "output"},   # column name in step3's DataFrame
        input_ref_id  = ref3,
        step_label_map= step_map,
    )
    step_map["step4"] = ref4
    df4 = DATA_STORE[ref4]
    print(df4[["output", "transcribe_output"]].to_string(index=False))
    print(f"\n→ {meta4}")

    # ── Step 5: dataframe ─────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("STEP 5 — analyze_sentiment  [dataframe]")
    print("="*60)
    ref5, meta5 = run_operation(
        op_id         = "mock_analyze_sentiment",
        config        = {},
        input_ref_id  = ref4,
        step_label_map= step_map,
    )
    step_map["step5"] = ref5
    df5 = DATA_STORE[ref5]
    print(df5[["output", "transcribe_output", "sentiment_score"]].to_string(index=False))
    print(f"\n→ {meta5}")

    # ── Step 6: dataframe ─────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("STEP 6 — generate_report  [dataframe]")
    print("="*60)
    ref6, meta6 = run_operation(
        op_id         = "mock_generate_report",
        config        = {},
        input_ref_id  = ref5,
        step_label_map= step_map,
    )
    df6 = DATA_STORE[ref6]
    print(df6.to_string(index=False))
    print(f"\n→ {meta6}")

    return df6


# ──────────────────────────────────────────────────────────────────────────────
# 4. Assertions — verify the pipeline produced expected shape and values
# ──────────────────────────────────────────────────────────────────────────────

def test_pipeline():
    result = run_pipeline()

    assert len(result) == 1,                          "Report should be a single row"
    assert "total_videos_analyzed" in result.columns, "Missing total_videos_analyzed"
    assert "average_sentiment" in result.columns,     "Missing average_sentiment"
    assert "status" in result.columns,                "Missing status"
    assert result["status"].iloc[0] == "Report Generated"
    assert result["total_videos_analyzed"].iloc[0] > 0, "Should have analysed at least one video"
    assert 0.0 <= result["average_sentiment"].iloc[0] <= 1.0, "Sentiment should be in [0, 1]"

    print("\n" + "="*60)
    print("✅  All assertions passed")
    print("="*60)


if __name__ == "__main__":
    test_pipeline()
