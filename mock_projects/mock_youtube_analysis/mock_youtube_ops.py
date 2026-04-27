"""
Mock YouTube Analysis Operations
Registered with @simple_step so they appear in /api/operations and can be
executed through the engine. These simulate a full channel-analysis pipeline:

  fetch_channel_videos → extract_metadata → transcribe_video
    → segment_conversations → analyze_sentiment → generate_report

"""

import sys
import os
import time

# Allow imports from src when loaded as a plugin
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pandas as pd

try:
    from SIMPLE_STEPS.decorators import simple_step
    from SIMPLE_STEPS.step_proxy import step
except ImportError:
    from src.SIMPLE_STEPS.decorators import simple_step
    from src.SIMPLE_STEPS.step_proxy import step



# ---------------------------------------------------------------------------
# Step 1 – Source: fetch a channel's video list
# ---------------------------------------------------------------------------

@simple_step(
    name="Fetch Channel Videos",
    category="YouTube",
    operation_type="source",
    id="fetch_channel_videos",
)
def fetch_channel_videos(channel_url: str) -> list:
    """Return a list of video URLs for a channel."""
    if not channel_url:
        raise ValueError("channel_url is required")
    video_ids = ["video_1", "video_2", "video_3", "video_4", "video_5"]
    if "with_cases" in channel_url:
        video_ids.extend(["video_error", "video_slow"])
    base = channel_url.rstrip('/')
    return [
        f"{base}/{vid}?uid={i + 1:03d}-{abs(hash(f'{base}/{vid}')) % 10_000_000:07d}"
        for i, vid in enumerate(video_ids)
    ]


# ---------------------------------------------------------------------------
# Step 2 – Map: extract metadata for a single video URL
# ---------------------------------------------------------------------------

@simple_step(
    name="Extract Video Metadata",
    category="YouTube",
    operation_type="map",
    id="extract_metadata",
    apply="map",
)
def extract_metadata(video_url: str) -> dict:
    """Return title, views and author for a single video URL."""
    if not video_url:
        raise ValueError("video_url is required")
    vid_id = video_url.split("/")[-1].split("?")[0]
    uid = video_url.split("uid=")[-1] if "uid=" in video_url else f"fallback-{abs(hash(video_url)) % 1_000_000:06d}"
    if "error" in vid_id:
        raise RuntimeError(f"Simulated metadata error for {vid_id}")

    condition = "standard"
    if "slow" in vid_id:
        condition = "slow-processing"
    elif vid_id.endswith("1"):
        condition = "short-form"
    elif vid_id.endswith("5"):
        condition = "long-form"

    return {
        "title": f"Mock Title - {vid_id}",
        "views": hash(vid_id) % 100_000 + 1_000,
        "author": "Mock Channel",
        "video_uid": uid,
        "condition": condition,
    }


# ---------------------------------------------------------------------------
# Step 3 – Map: transcribe a single video URL
# ---------------------------------------------------------------------------

@simple_step(
    name="Transcribe Video",
    category="YouTube",
    operation_type="map",
    id="transcribe_video",
    apply="map",
)
def transcribe_video(video_url: str) -> str:
    """Return a mock transcript string for a single video URL."""
    if not video_url:
        raise ValueError("video_url is required")
    vid_id = video_url.split("/")[-1].split("?")[0]
    uid = video_url.split("uid=")[-1] if "uid=" in video_url else f"fallback-{abs(hash(video_url)) % 1_000_000:06d}"
    if "error" in vid_id:
        raise RuntimeError(f"Simulated transcript error for {vid_id}")
    if "slow" in vid_id:
        time.sleep(1)

    return (
        f"Mock transcript for {vid_id} [{uid}]. "
        "The speaker discussed topics A, B and C in detail."
    )


# ---------------------------------------------------------------------------
# Step 4 – Map: split a single transcript into conversation segments
# ---------------------------------------------------------------------------

@simple_step(
    name="Segment Conversations",
    category="YouTube",
    operation_type="map",
    id="segment_conversations",
    apply="flatmap",
)
def segment_conversations(transcript: str) -> list:
    """Split a transcript string into a list of segment strings."""
    if not transcript:
        raise ValueError("transcript is required")
    return [part.strip() for part in transcript.split(". ") if part.strip()]


# ---------------------------------------------------------------------------
# Step 5 – Map: score sentiment for a single segment
# ---------------------------------------------------------------------------

@simple_step(
    name="Analyze Sentiment",
    category="YouTube",
    operation_type="map",
    id="analyze_sentiment",
    apply="map",
)
def analyze_sentiment(text: str) -> float:
    """Return a sentiment score (0.0 – 1.0) for a single text segment."""
    if not text:
        raise ValueError("text is required")
    return round((len(text) % 10) / 10.0, 2)


# ---------------------------------------------------------------------------
# Step 6 – Aggregate: generate a report from a list of segment strings
# ---------------------------------------------------------------------------

@simple_step(
    name="Generate Report",
    category="YouTube",
    operation_type="map",
    id="generate_report",
)
def generate_report(segments: list) -> str:
    """Take a list of segment strings and return a summary report string."""
    if not segments:
        raise ValueError("segments list is required")
    total = len(segments)
    scores = [round((len(s) % 10) / 10.0, 2) for s in segments]
    avg = round(sum(scores) / total, 3)
    positive = sum(1 for s in scores if s >= 0.5)
    negative = total - positive
    return (
        f"Analysed {total} segments. "
        f"Average sentiment: {avg:.2f}. "
        f"Positive: {positive}, Negative: {negative}."
    )


# ===========================================================================
# Smoke test
# ===========================================================================

if __name__ == "__main__":
    print("Running mock YouTube pipeline smoke test...")
    try:
        CHANNEL_URL = "https://youtube.com/@mock_channel"

        # ---------------------------------------------------------------
        # Mode 1: Default decorated behavior (uses apply= modifiers)
        # ---------------------------------------------------------------
        default_video_urls = fetch_channel_videos(CHANNEL_URL)
        default_metadata = extract_metadata(default_video_urls)
        default_transcripts = transcribe_video(default_video_urls)
        default_segments = segment_conversations(default_transcripts)
        default_scores = analyze_sentiment(default_segments)
        default_report = generate_report(default_segments)

        print("\n[Mode 1] Default decorated path")
        print(f"1) fetch_channel_videos:           {len(default_video_urls)} URLs")
        print(f"2) extract_metadata (apply=map):   {len(default_metadata)} dicts")
        print(f"3) transcribe_video (apply=map):   {len(default_transcripts)} transcripts")
        print(f"4) segment_conversations (flatmap):{len(default_segments)} segments")
        print(f"5) analyze_sentiment (apply=map):  {len(default_scores)} scores, sample={default_scores[:3]}")
        print(f"6) generate_report:                {repr(default_report)}")

        # ---------------------------------------------------------------
        # Mode 2: Explicit __mode overrides (raw/map/flatmap/default)
        # ---------------------------------------------------------------
        raw_video_urls = fetch_channel_videos(CHANNEL_URL, __mode="raw")
        mapped_metadata = extract_metadata(raw_video_urls, __mode="map")
        mapped_transcripts = transcribe_video(video_url=raw_video_urls, __mode="map")
        flat_segments = segment_conversations(mapped_transcripts, __mode="flatmap")
        raw_score = analyze_sentiment(flat_segments[0], __mode="raw")
        override_report = generate_report(flat_segments, __mode="default")

        print("\n[Mode 2] Explicit __mode overrides")
        print(f"1) __mode='raw':                   {len(raw_video_urls)} URLs")
        print(f"2) __mode='map' (positional list): {len(mapped_metadata)} dicts")
        print(f"3) __mode='map' (kwarg list):      {len(mapped_transcripts)} transcripts")
        print(f"4) __mode='flatmap':               {len(flat_segments)} segments")
        print(f"5) __mode='raw' scalar:            {raw_score}")
        print(f"6) __mode='default':               {repr(override_report)}")

        # ---------------------------------------------------------------
        # Mode 2b: Chaining helper syntax (same behavior, easier to read)
        # ---------------------------------------------------------------
        chained_metadata = extract_metadata.apply_across_rows(raw_video_urls)
        chained_transcripts = transcribe_video.apply_across_rows(raw_video_urls)
        chained_segments = segment_conversations.apply_and_flatten(chained_transcripts)
        chained_raw_score = analyze_sentiment.run_raw(chained_segments[0])

        print("\n[Mode 2b] Chaining helper syntax")
        print(f"1) apply_across_rows metadata:     {len(chained_metadata)} dicts")
        print(f"2) apply_across_rows transcripts:  {len(chained_transcripts)} transcripts")
        print(f"3) apply_and_flatten segments:     {len(chained_segments)} segments")
        print(f"4) run_raw sentiment score:        {chained_raw_score}")

        # ---------------------------------------------------------------
        # Mode 3: DataFrame orchestration via StepProxy + decorated ops
        # ---------------------------------------------------------------
        videos_df = pd.DataFrame({"video_url": raw_video_urls})
        videos_step = step(videos_df, label="videos")

        metadata_step = extract_metadata(videos_step.video_url)
        transcripts_step = transcribe_video(metadata_step.video_url)
        segmented_lists_step = segment_conversations(transcripts_step.transcribe_video_output)

        segments_df = segmented_lists_step.df.explode("segment_conversations_output")
        segments_df = segments_df.dropna(subset=["segment_conversations_output"]).rename(
            columns={"segment_conversations_output": "segment_text"}
        )
        segments_step = step(segments_df, label="segments")
        scores_step = analyze_sentiment(segments_step.segment_text)
        orchestration_report = generate_report(scores_step.segment_text.tolist())

        print("\n[Mode 3] DataFrame orchestration path")
        print(f"1) videos_step rows:               {len(videos_step)}")
        print(f"2) metadata_step columns:          {list(metadata_step.columns)}")
        print(f"3) transcripts_step columns:       {list(transcripts_step.columns)}")
        print(f"4) exploded segments rows:         {len(segments_step)}")
        print(f"5) scores_step columns:            {list(scores_step.columns)}")
        print(f"6) orchestration report:           {repr(orchestration_report)}")

        # ---------------------------------------------------------------
        # Mode 4: Case conditions (unique ids, expected error, 1s delay)
        # ---------------------------------------------------------------
        case_urls = fetch_channel_videos(f"{CHANNEL_URL}/with_cases")
        print("\n[Mode 4] Case conditions")
        print(f"1) case urls count:                {len(case_urls)}")
        print(f"2) sample uid url:                 {case_urls[0]}")

        # Expected error case
        try:
            _ = extract_metadata(case_urls, __mode="map")
        except Exception as case_exc:
            print(f"3) expected error case:            {case_exc}")

        # 1-second delay case (video_slow)
        slow_urls = [u for u in case_urls if "video_slow" in u]
        t0 = time.time()
        slow_transcripts = transcribe_video(slow_urls, __mode="map")
        elapsed = round(time.time() - t0, 2)
        print(f"4) slow-case transcripts:          {len(slow_transcripts)}")
        print(f"5) slow-case elapsed seconds:      {elapsed}")
        print("\nSmoke test passed.")
    except Exception as exc:
        print(f"Smoke test FAILED: {exc}")
        raise
