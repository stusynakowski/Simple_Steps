"""
Mock YouTube Analysis Operations
Registered with @simple_step so they appear in /api/operations and can be
executed through the engine. These simulate a full channel-analysis pipeline:

  fetch_channel_videos → extract_metadata → transcribe_video
    → segment_conversations → analyze_sentiment → generate_report
"""

import sys
import os

# Allow imports from src when loaded as a plugin
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pandas as pd

try:
    from SIMPLE_STEPS.decorators import simple_step
except ImportError:
    from src.SIMPLE_STEPS.decorators import simple_step

# ---------------------------------------------------------------------------
# Step 1 – Source: fetch a channel's video list
# ---------------------------------------------------------------------------

@simple_step(
    name="Fetch Channel Videos",
    category="YouTube",
    operation_type="source",
    id="fetch_channel_videos",
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


# ---------------------------------------------------------------------------
# Step 2 – Map: extract metadata for every video URL
# ---------------------------------------------------------------------------

@simple_step(
    name="Extract Video Metadata",
    category="YouTube",
    operation_type="dataframe",
    id="extract_metadata",
)
def extract_metadata(df: pd.DataFrame, url_column: str = "video_url") -> pd.DataFrame:
    """Fetch title, views and author for each video URL (mock).

    Operates on the full DataFrame so that the new metadata columns
    (title, views, author) are correctly aligned row-for-row with the
    original video_url / video_id columns.
    """
    if df is None or df.empty:
        raise ValueError("No input data")
    if url_column not in df.columns:
        raise ValueError(
            f"Column '{url_column}' not found. Available: {list(df.columns)}"
        )

    def _mock_meta(url: str) -> dict:
        vid_id = url.split("/")[-1]
        return {
            "title": f"Mock Title – {vid_id}",
            "views": hash(vid_id) % 100_000 + 1_000,
            "author": "Mock Channel",
        }

    # Apply row-by-row and expand the returned dict into separate columns.
    # pd.Series expansion ensures title/views/author align 1-to-1 with each URL row.
    meta_df = df[url_column].apply(_mock_meta).apply(pd.Series)
    return pd.concat([df.reset_index(drop=True), meta_df.reset_index(drop=True)], axis=1)


# ---------------------------------------------------------------------------
# Step 3 – Map: transcribe each video
# ---------------------------------------------------------------------------

@simple_step(
    name="Transcribe Videos",
    category="YouTube",
    operation_type="dataframe",
    id="transcribe_video",
)
def transcribe_video(df: pd.DataFrame, url_column: str = "video_url") -> pd.DataFrame:
    """Generate a mock transcript for each video URL.

    Marked as 'dataframe' so the engine passes the full DataFrame directly
    rather than iterating row-by-row, keeping the 'transcript' column
    correctly aligned with all other columns.
    """
    if df is None or df.empty:
        raise ValueError("No input data")

    df = df.copy()
    df["transcript"] = df[url_column].apply(
        lambda url: f"Mock transcript for {url.split('/')[-1]}. "
        "The speaker discussed topics A, B and C in detail."
    )
    return df


# ---------------------------------------------------------------------------
# Step 4 – Expand: split each transcript into conversation segments
# ---------------------------------------------------------------------------

@simple_step(
    name="Segment Conversations",
    category="YouTube",
    operation_type="expand",
    id="segment_conversations",
)
def segment_conversations(
    df: pd.DataFrame,
    transcript_column: str = "transcript",
    title_column: str = "title",
) -> pd.DataFrame:
    """Split each video transcript into individual conversation segments."""
    if df is None or df.empty:
        raise ValueError("No input data")

    segments = []
    for _, row in df.iterrows():
        transcript = str(row.get(transcript_column, ""))
        title = str(row.get(title_column, "Unknown"))
        parts = transcript.split(". ")
        for i, part in enumerate(parts):
            if part.strip():
                segments.append(
                    {
                        "source_title": title,
                        "segment_index": i,
                        "segment_text": part.strip(),
                    }
                )
    return pd.DataFrame(segments)


# ---------------------------------------------------------------------------
# Step 5 – Map: score sentiment for each segment
# ---------------------------------------------------------------------------

@simple_step(
    name="Analyze Sentiment",
    category="YouTube",
    operation_type="dataframe",
    id="analyze_sentiment",
)
def analyze_sentiment(
    df: pd.DataFrame, text_column: str = "segment_text"
) -> pd.DataFrame:
    """Score sentiment for each conversation segment (mock 0–1 score).

    Marked as 'dataframe' so the engine passes the full DataFrame directly,
    keeping sentiment_score / sentiment_label columns aligned row-for-row
    with source_title and segment_text.
    """
    if df is None or df.empty:
        raise ValueError("No input data")
    if text_column not in df.columns:
        raise ValueError(f"Column '{text_column}' not found.")

    df = df.copy()
    df["sentiment_score"] = df[text_column].apply(
        lambda t: round((len(t) % 10) / 10.0, 2)
    )
    df["sentiment_label"] = df["sentiment_score"].apply(
        lambda s: "positive" if s >= 0.5 else "negative"
    )
    return df


# ---------------------------------------------------------------------------
# Step 6 – Aggregate: produce a summary report row
# ---------------------------------------------------------------------------

@simple_step(
    name="Generate Report",
    category="YouTube",
    operation_type="dataframe",
    id="generate_report",
)
def generate_report(
    df: pd.DataFrame, score_column: str = "sentiment_score"
) -> pd.DataFrame:
    """Aggregate sentiment scores into a summary report."""
    if df is None or df.empty:
        raise ValueError("No input data")

    total = len(df)
    avg = round(df[score_column].mean(), 3) if score_column in df.columns else 0.0
    positive = int((df.get("sentiment_label", pd.Series()) == "positive").sum())
    negative = total - positive

    return pd.DataFrame(
        [
            {
                "total_segments": total,
                "avg_sentiment": avg,
                "positive_segments": positive,
                "negative_segments": negative,
                "summary": (
                    f"Analysed {total} segments across the channel. "
                    f"Average sentiment: {avg:.2f}. "
                    f"Positive: {positive}, Negative: {negative}."
                ),
            }
        ]
    )
