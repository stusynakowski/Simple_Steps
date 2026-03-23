"""
Example: YouTube Analysis Pack
================================
Demonstrates the failsafe OperationPack pattern.

This file replaces the old mock_youtube_ops.py approach with a
self-validating pack that:
  ✓ Checks for required packages at registration time
  ✓ Checks for required environment variables (API keys)
  ✓ Declares input/output contracts per operation
  ✓ Degrades gracefully — shows grayed-out ops instead of crashing

To use this in your own project, copy this file and change the
functions + pack metadata. That's it.
"""

import sys
import os

# Allow imports from src when loaded as a plugin
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pandas as pd
from src.SIMPLE_STEPS.operation_pack import OperationPack


# ─────────────────────────────────────────────────────────────────────────────
# 1. Declare the pack
# ─────────────────────────────────────────────────────────────────────────────

pack = OperationPack(
    name="YouTube Analysis (Pack)",
    version="1.0.0",
    description="Fetch, enrich, and analyze YouTube channel data.",
    required_packages=["pandas"],       # will pass
    required_env_vars=[],               # no API key needed for mocks
    # To require an API key, add: required_env_vars=["YOUTUBE_API_KEY"],
    # The pack will still register but ops will be grayed-out if the key is missing.
)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Define operations using @pack.step()
# ─────────────────────────────────────────────────────────────────────────────

@pack.step(
    id="pack_yt_fetch",
    name="Fetch Channel Videos",
    operation_type="source",
    output_contract={"video_url": "str", "video_id": "str"},
)
def fetch_channel_videos(channel_url: str) -> pd.DataFrame:
    """Fetch a list of video URLs from a YouTube channel (mock)."""
    if not channel_url:
        raise ValueError("channel_url is required")

    video_ids = ["video_1", "video_2", "video_3", "video_4", "video_5"]
    rows = [
        {
            "video_url": f"{channel_url.rstrip('/')}/{vid}",
            "video_id": vid,
        }
        for vid in video_ids
    ]
    return pd.DataFrame(rows)


@pack.step(
    id="pack_yt_metadata",
    name="Extract Video Metadata",
    operation_type="dataframe",
    input_contract={"video_url": "str"},
    output_contract={"video_url": "str", "title": "str", "views": "int", "author": "str"},
)
def extract_metadata(df: pd.DataFrame, url_column: str = "video_url") -> pd.DataFrame:
    """Fetch title, views, and author for each video URL (mock)."""
    if df is None or df.empty:
        raise ValueError("No input data")
    if url_column not in df.columns:
        raise ValueError(f"Column '{url_column}' not found. Available: {list(df.columns)}")

    def _mock_meta(url: str) -> dict:
        vid_id = url.split("/")[-1]
        return {
            "title": f"Mock Title – {vid_id}",
            "views": hash(vid_id) % 100_000 + 1_000,
            "author": "Mock Channel",
        }

    meta_df = df[url_column].apply(_mock_meta).apply(pd.Series)
    return pd.concat([df.reset_index(drop=True), meta_df.reset_index(drop=True)], axis=1)


@pack.step(
    id="pack_yt_transcribe",
    name="Transcribe Videos",
    operation_type="dataframe",
    input_contract={"video_url": "str"},
    output_contract={"video_url": "str", "transcript": "str"},
)
def transcribe_video(df: pd.DataFrame, url_column: str = "video_url") -> pd.DataFrame:
    """Generate a mock transcript for each video URL."""
    if df is None or df.empty:
        raise ValueError("No input data")
    df = df.copy()
    df["transcript"] = df[url_column].apply(
        lambda url: f"Mock transcript for {url.split('/')[-1]}. "
        "The speaker discussed topics A, B and C in detail."
    )
    return df


@pack.step(
    id="pack_yt_sentiment",
    name="Analyze Sentiment",
    operation_type="dataframe",
    input_contract={"segment_text": "str"},
    output_contract={"segment_text": "str", "sentiment_score": "float", "sentiment_label": "str"},
)
def analyze_sentiment(df: pd.DataFrame, text_column: str = "segment_text") -> pd.DataFrame:
    """Score sentiment for each conversation segment (mock 0–1 score)."""
    if df is None or df.empty:
        raise ValueError("No input data")
    if text_column not in df.columns:
        raise ValueError(f"Column '{text_column}' not found.")
    df = df.copy()
    df["sentiment_score"] = df[text_column].apply(lambda t: round((len(t) % 10) / 10.0, 2))
    df["sentiment_label"] = df["sentiment_score"].apply(lambda s: "positive" if s >= 0.5 else "negative")
    return df


@pack.step(
    id="pack_yt_report",
    name="Generate Report",
    operation_type="dataframe",
    input_contract={"sentiment_score": "float"},
)
def generate_report(df: pd.DataFrame, score_column: str = "sentiment_score") -> pd.DataFrame:
    """Aggregate sentiment scores into a summary report."""
    if df is None or df.empty:
        raise ValueError("No input data")
    total = len(df)
    avg = round(df[score_column].mean(), 3) if score_column in df.columns else 0.0
    positive = int((df.get("sentiment_label", pd.Series()) == "positive").sum())
    return pd.DataFrame([{
        "total_segments": total,
        "average_sentiment": avg,
        "positive_count": positive,
        "negative_count": total - positive,
        "status": "Report Generated",
    }])


# ─────────────────────────────────────────────────────────────────────────────
# 3. Register the pack — this is the ONE line that triggers everything
# ─────────────────────────────────────────────────────────────────────────────

pack.register()
