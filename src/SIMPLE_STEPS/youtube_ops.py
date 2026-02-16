from typing import List, Dict, Any, Optional
import pandas as pd
from .operations import register_operation, OperationParam


# --- 1. Fetch Videos ---
@register_operation(
    id="yt_fetch_videos",
    label="Fetch Channel Videos",
    description="Get all video URLs from a YouTube channel",
    params=[
        OperationParam(name="channel_url", type="string", description="URL of the channel to scrape")
    ]
)
def op_fetch_videos(df: Optional[pd.DataFrame], config: dict) -> pd.DataFrame:
    channel_url = config.get("channel_url", "https://youtube.com/mock_channel")
    print(f"[Mock] Fetching videos for channel: {channel_url}")
    
    # Simulate fetching
    videos = [
       f"{channel_url}/video/1",
       f"{channel_url}/video/2", 
       f"{channel_url}/video/3",
       f"{channel_url}/video/4",
       f"{channel_url}/video/5"
    ]
    
    # Return as DataFrame
    return pd.DataFrame({"video_url": videos})


# --- 2. Extract Metadata (Enrichment) ---
@register_operation(
    id="yt_extract_metadata",
    label="Extract Video Metadata",
    description="Get title, views, and author for video URLs",
    params=[
        OperationParam(name="url_column", type="string", description="Column containing video URLs", default="video_url")
    ]
)
def op_extract_metadata(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: raise ValueError("No input data")
    
    url_col = config.get("url_column", "video_url")
    if url_col not in df.columns:
        raise ValueError(f"Column '{url_col}' not found")

    # Apply mock logic row by row
    def _get_meta(url):
        return {
            "title": f"Video Title for {str(url).split('/')[-1]}",
            "views": len(str(url)) * 100,
            "author": "Mock Channel"
        }

    # Apply and expand result into new columns
    meta_df = df[url_col].apply(_get_meta).apply(pd.Series)
    return pd.concat([df, meta_df], axis=1)


# --- 3. Transcribe (Enrichment - Slow Operation) ---
@register_operation(
    id="yt_transcribe",
    label="Transcribe Videos",
    description="Generate text transcripts for videos",
    params=[
        OperationParam(name="url_column", type="string", description="Column containing video URLs", default="video_url")
    ]
)
def op_transcribe(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: raise ValueError("No input data")
    
    url_col = config.get("url_column", "video_url")
    
    def _transcribe(url):
        # In real life, this is slow!
        return f"This is the fake transcript content for {url}. It contains some words."

    df["transcript"] = df[url_col].apply(_transcribe)
    return df


# --- 4. Segment Conversations (Explosion/One-to-Many) ---
@register_operation(
    id="yt_segment",
    label="Segment Conversations",
    description="Split transcripts into individual conversation segments",
    params=[
        OperationParam(name="transcript_column", type="string", description="Column to segment", default="transcript")
    ]
)
def op_segment(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: raise ValueError("No input data")
    
    # This operation takes 1 row and turns it into N rows
    # We'll use 'explode'
    
    def _generate_segments(text):
        return [
            {"segment_id": 1, "text": "Hello world", "sentiment_score": 0.8},
            {"segment_id": 2, "text": "This is a segment", "sentiment_score": 0.5},
            {"segment_id": 3, "text": "Goodbye", "sentiment_score": 0.2}
        ]

    # Create a list of lists of dicts
    segments_col = df["transcript"].apply(_generate_segments)
    
    # Assign to temp column
    df_temp = df.copy()
    df_temp["_segments"] = segments_col
    
    # Explode the list
    df_exploded = df_temp.explode("_segments")
    
    # Extract dict keys to columns
    segments_df = df_exploded["_segments"].apply(pd.Series)
    
    # Reset index to avoid duplicates
    result = pd.concat([df_exploded.drop(columns=["_segments", "transcript"]), segments_df], axis=1)
    return result.reset_index(drop=True)


# --- 4.5 Analyze Sentiment (Row-by-Row) ---
@register_operation(
    id="yt_analyze_sentiment",
    label="Analyze Sentiment",
    description="Calculate sentiment score for text",
    params=[
        OperationParam(name="text_column", type="string", description="Column containing text", default="text")
    ]
)
def op_analyze_sentiment(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: raise ValueError("No input data")
    
    col = config.get("text_column", "text")
    if col not in df.columns:
         return df # Or raise error

    def _analyze(text):
        # Mock logic: length of text determines fake sentiment
        return float(len(str(text)) % 10) / 10.0

    df["sentiment_score"] = df[col].apply(_analyze)
    return df


# --- 5. Analyze/Aggregate ---
@register_operation(
    id="yt_report",
    label="Generate Report",
    description="Calculate average sentiment stats",
    params=[]
)
def op_report(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    if df is None: raise ValueError("No input data")
    
    if "sentiment_score" not in df.columns:
         return pd.DataFrame({"error": ["No sentiment_score column found"]})

    avg = df["sentiment_score"].mean()
    count = len(df)
    
    return pd.DataFrame([{
        "total_segments": count,
        "average_sentiment": avg,
        "status": "Analysis Complete"
    }])
