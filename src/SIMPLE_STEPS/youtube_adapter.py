import pandas as pd
from typing import Optional
from .operations import OperationParam
from .generic_adapter import adapt_function
import sys
import os

# --- Import Domain Logic (Mocked) ---
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../mock_operations")))
try:
    from mock_youtube_analysis import fetch_channel_videos, extract_metadata
except ImportError:
    # Fallback
    def fetch_channel_videos(channel_url): return [f"{channel_url}/1", f"{channel_url}/2"]
    def extract_metadata(video_url): return {"title": f"Title {video_url}", "views": 100}


# --- Register Operations using Adapter ---

# 1. Fetch Videos (Source)
# Function signature: fetch_channel_videos(channel_url: str) -> List[str]
adapt_function(
    func=fetch_channel_videos,
    op_id="youtube_fetch_gen",
    label="Fetch Videos (Generic)",
    description="Retrieve video links from channel",
    params=[
        OperationParam(name="channel_url", type="string", description="Channel URL")
    ],
    output_column="video_url",
    explode_output=True # because it returns a list of items
)

# 2. Extract Metadata (Transformation)
# Function signature: extract_metadata(video_url: str) -> dict
adapt_function(
    func=extract_metadata,
    op_id="youtube_meta_gen",
    label="Extract Metadata (Generic)",
    description="Get video details",
    params=[
        # The user will type the column name (e.g. 'video_url') into this 'video_url' config param
        OperationParam(name="video_url", type="string", description="Column containing Video URLs")
    ],
    output_column="metadata" # Ignored for dict returns (expanded)
)

