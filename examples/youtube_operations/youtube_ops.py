from typing import List, Dict, Any, Optional
import pandas as pd
from SIMPLE_STEPS.decorators import simple_step

# --- 1. Fetch Videos (Source) ---
@simple_step(
    id="yt_fetch_videos",
    name="Fetch Channel Videos", 
    category="YouTube", 
    operation_type="source"
)
def fetch_videos(channel_url: str = "https://youtube.com/mock_channel") -> List[str]:
    """Get all video URLs from a YouTube channel as a DataFrame"""
    # Just return a list of strings
    # The decorator handles converting this into a DataFrame with one column 'output'
    if channel_url is None:
        channel_url = "https://youtube.com/mock_channel"
        
    print(f"[Mock] Fetching videos for channel: {channel_url}")
    
    return [
        f"{channel_url}/video/1",
        f"{channel_url}/video/2", 
        f"{channel_url}/video/3", 
        f"{channel_url}/video/4", 
        f"{channel_url}/video/5"
    ]

# --- 2. Extract Metadata (Enrichment) ---
# Updated to demonstrate resolving parameters from previous steps
@simple_step(
    id="yt_extract_metadata",
    name="Extract Video Metadata", 
    category="YouTube", 
    operation_type="map"
)
def extract_metadata(url: str) -> dict:
    """Enrich a single video URL with title, views, and author.
    
    Even though this function takes a single string `url`, 
    SimpleFlags allows you to map this over a DataFrame column.
    
    If used as: =yt_extract_metadata(url=step1_df)
    It will iterate over rows of step1_df, picking a suitable column for 'url'.
    """
    
    # Mock single-item processing
    # print(f"[Mock] Extracting metadata for {url}")
    
    return {
        "title": f"Video Title for {str(url).split('/')[-1]}",
        "views": len(str(url)) * 100,
        "author": "Mock Channel"
    }

# --- 3. Filter Popular (Row-by-Row Check) ---
@simple_step(
    id="yt_filter_popular",
    name="Filter Popular Videos",
    category="YouTube",
    operation_type="filter"
)
def is_video_popular(views: int = 0, min_views: int = 1000) -> bool:
    """Check if a video is popular based on view count"""
    return views > min_views

# --- 4. Mock Transcribe (Map Operation - Row by Row) ---
# We keep this as 'map' to show we can still do row-level stuff if needed,
# but the input will be a column value, not the whole DF.
@simple_step(
    id="yt_transcribe",
    name="Transcribe Videos", 
    category="AI Analysis", 
    operation_type="map"
)
def transcribe(url: str) -> str:
    """Generate text transcripts for videos"""
    return f"Transcript content for {url}..."

# --- 5. Analyze Sentiment (DataFrame Operation using explicit input) ---
# Here we show how we can take any dataframe as an argument 'data'
@simple_step(
    id="yt_analyze_sentiment",
    name="Analyze Sentiment Batch",
    category="AI Analysis",
    operation_type="dataframe"
)
def analyze_sentiment(data: pd.DataFrame) -> pd.DataFrame:
    """Calculate sentiment score for all rows"""
    
    # Find a text column
    text_col = None
    for col in ['transcript', 'yt_transcribe_output', 'text', 'title']:
        if col in data.columns:
            text_col = col
            break
            
    if not text_col:
        return data
        
    print(f"[Mock] Analyzing sentiment on column: {text_col}")
    
    result = data.copy()
    # Vectorized operation (mock)
    result['sentiment_score'] = result[text_col].apply(lambda x: float(len(str(x)) % 10) / 10.0)
    
    return result

# --- 6. Generate Report (Aggregation) ---
@simple_step(
    id="yt_report",
    name="Generate Report",
    category="Reporting",
    operation_type="dataframe"
)
def generate_report(metrics_df: pd.DataFrame) -> pd.DataFrame:
    """Calculate summary statistics"""
    
    sent_cols = [c for c in metrics_df.columns if "sentiment" in c.lower() or "score" in c.lower()]
    target_col = sent_cols[0] if sent_cols else None
    
    count = len(metrics_df)
    avg = metrics_df[target_col].mean() if target_col else 0.0
    
    return pd.DataFrame([{
        "total_videos_analyzed": count,
        "average_sentiment": avg,
        "status": "Report Generated"
    }])
