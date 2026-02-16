# Mock definitions for workflow construction proposal
# These functions simulate the steps in a YouTube analysis pipeline.
# Standard Python functions without any orchestration awareness.

from typing import List, Dict

# --- Domain Functions ---

def fetch_channel_videos(channel_url: str) -> List[str]:
    """
    Gets a list of video URLs from a channel.
    Simulates fetching a page and parsing video links.
    """
    print(f"[Mock] Fetching videos for channel: {channel_url}")
    # Return mock video IDs/URLs
    return [
       f"{channel_url}/video/1",
       f"{channel_url}/video/2", 
       f"{channel_url}/video/3"
    ]

def extract_metadata(video_url: str) -> dict:
    """
    Gets metadata for a video.
    Simulates an API call to get title, views, etc.
    """
    print(f"[Mock] Extracting metadata for: {video_url}")
    return {
        "url": video_url,
        "title": f"Video Title for {video_url.split('/')[-1]}",
        "views": 1000,
        "author": "Mock Channel"
    }

def transcribe_video(video_url: str) -> str:
    """
    Transcribes a video.
    Simulates downloading audio and running ASR.
    """
    print(f"[Mock] Transcribing: {video_url}")
    return f"This is the fake transcript content for {video_url}."

def segment_conversations(transcript: str, metadata: dict) -> List[dict]:
    """
    Cuts transcript into logical segments/conversations.
    Takes transcript and metadata (context) as input.
    """
    print(f"[Mock] Segmenting transcript (length {len(transcript)})")
    # Split the "transcript" into mock segments
    return [
        {"segment_id": 1, "text": "Hello world", "source": metadata['title']},
        {"segment_id": 2, "text": "This is a segment", "source": metadata['title']},
        {"segment_id": 3, "text": "Goodbye", "source": metadata['title']}
    ]

def analyze_sentiment(conversation: dict) -> float:
    """
    Analyzes sentiment of a conversation segment.
    """
    text = conversation.get("text", "")
    print(f"[Mock] Analyzing sentiment for: '{text}'")
    # Mock logic: length of text determines fake sentiment
    return float(len(text) % 10) / 10.0

def generate_report(sentiments: List[float]) -> str:
    """
    Aggregates results into a final report.
    """
    print(f"[Mock] Generating report from {len(sentiments)} sentiment scores")
    avg_sentiment = sum(sentiments) / len(sentiments) if sentiments else 0.0
    return f"REPORT: Analyzed {len(sentiments)} segments. Average Sentiment: {avg_sentiment:.2f}"
