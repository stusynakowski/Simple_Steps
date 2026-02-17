from typing import List, Dict, Any, Optional
import pandas as pd
from .decorators import simple_step

# --- 1. Fetch Videos ---
@simple_step(
    id="yt_fetch_videos",
    name="Fetch Channel Videos", 
    category="YouTube", 
    operation_type="source"
)
def fetch_videos(channel_url: str = "https://youtube.com/mock_channel") -> List[str]:
    """Get all video URLs from a YouTube channel"""
    print(f"[Mock] Fetching videos for channel: {channel_url}")
    # Return list of strings - automatically converted to DataFrame column "output"
    return [
       f"{channel_url}/video/1",
       f"{channel_url}/video/2", 
       f"{channel_url}/video/3", 
       f"{channel_url}/video/4", 
       f"{channel_url}/video/5"
    ]

# --- 2. Extract Metadata (Enrichment) ---
@simple_step(
    id="yt_extract_metadata",
    name="Extract Video Metadata", 
    category="YouTube", 
    operation_type="map"
)
def extract_metadata(url: str) -> dict:
    """Get title, views, and author for video URLs"""
    # Simply return a dict. The decorator will expand keys into columns.
    return {
        "title": f"Video Title for {str(url).split('/')[-1]}",
        "views": len(str(url)) * 100,
        "author": "Mock Channel"
    }

# --- 3. Transcribe (Enrichment - Slow Operation) ---
@simple_step(
    id="yt_transcribe",
    name="Transcribe Videos", 
    category="AI Analysis", 
    operation_type="map"
)
def transcribe(url: str) -> str:
    """Generate text transcripts for videos"""
    return f"This is the fake transcript content for {url}. It contains some words."

# --- 4. Segment Conversations (Explosion/One-to-Many) ---
@simple_step(
    id="yt_segment",
    name="Segment Conversations", 
    category="AI Analysis", 
    operation_type="expand"
)
def segment(transcript: str) -> List[dict]:
    """Split transcripts into individual conversation segments"""
    # This operation takes 1 row (transcript) and turns it into N rows (segments)
    return [
        {"segment_id": 1, "text": "Hello world", "sentiment_score": 0.8},
        {"segment_id": 2, "text": "This is a segment", "sentiment_score": 0.5},
        {"segment_id": 3, "text": "Goodbye", "sentiment_score": 0.2}
    ]

# --- 5. Analyze Sentiment (Row-by-Row) ---
@simple_step(
    id="yt_analyze_sentiment",
    name="Analyze Sentiment",
    category="AI Analysis",
    operation_type="map"
)
def analyze_sentiment(text: str) -> float:
    """Calculate sentiment score for text"""
    # Mock logic: length of text determines fake sentiment
    return float(len(str(text)) % 10) / 10.0

# --- 6. Generate Report (Aggregation) ---
@simple_step(
    id="yt_report",
    name="Generate Report",
    category="Reporting",
    operation_type="dataframe"
)
def generate_report(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate average sentiment stats"""
    if df is None: return pd.DataFrame()
    
    # Check for sentiment column
    # The previous step stores output in 'yt_analyze_sentiment_output' or similar
    # But user might have mapped it.
    
    # Try to find a float column? Or just look for specific columns?
    # For robust mock, let's look for known columns or just the last column?
    
    sent_cols = [c for c in df.columns if "sentiment" in c.lower() or "score" in c.lower()]
    target_col = sent_cols[0] if sent_cols else None
    
    if not target_col:
         return pd.DataFrame({"error": ["No sentiment/score column found to aggregate"]})

    avg = df[target_col].mean()
    count = len(df)
    
    return pd.DataFrame([{
        "total_segments": count,
        "average_sentiment": avg,
        "status": "Analysis Complete"
    }])
