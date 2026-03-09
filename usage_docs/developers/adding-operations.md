# Adding Operations to Simple Steps

Operations are the building blocks of a Simple Steps pipeline. Each operation is a plain Python function that gets registered into the **Operation Registry** — the engine then discovers, displays, and orchestrates it automatically.

There are two registration styles. Choose whichever fits your workflow.

---

## Style 1 — The `@simple_step` Decorator

Best for: operations you write specifically for this project.

```python
# src/my_package/my_ops.py

import pandas as pd
from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="my_operation",          # unique ID used in the formula bar: =my_operation(...)
    name="My Operation",        # display name in the UI sidebar
    category="My Category",     # sidebar grouping
    operation_type="map",       # default orchestration mode (see below)
)
def my_operation(url: str, max_results: int = 10) -> dict:
    """
    Fetch data for a single URL.
    This docstring appears as the operation description in the UI.
    """
    return {"url": url, "count": max_results}
```

**Rules:**
- File must end in `_ops.py` — the scanner finds it automatically on startup.
- Parameter types are inferred from type annotations (`str` → `string`, `int/float` → `number`, `bool` → `boolean`).
- The `df` and `data` parameters are skipped — they are injected by the engine.
- `**kwargs` is skipped — it does not appear as a UI parameter.
- Return a `dict`, `list[dict]`, or `pd.DataFrame`.

---

## Style 2 — `register_operation` (Plain Functions)

Best for: existing functions, third-party libraries, notebooks, or test mocks — no decorator needed.

```python
# src/my_package/my_funcs.py
# (or anywhere — the scanner picks up any file containing register_operation)

import pandas as pd
from SIMPLE_STEPS.decorators import register_operation


# ── Pure functions — zero SimpleSteps imports required ────────────────────────

def fetch_videos(channel_url: str = "https://youtube.com/mock_channel"):
    """Get all video URLs from a YouTube channel."""
    return [f"{channel_url}/video/{i}" for i in range(1, 6)]

def extract_metadata(url: str) -> dict:
    """Return title, views, and author for a single video URL."""
    return {"title": f"Video {url.split('/')[-1]}", "views": 5000, "author": "Demo"}

def is_video_popular(views: int = 0, min_views: int = 1000) -> bool:
    """Return True if views exceed the threshold."""
    return views > min_views

def transcribe(url: str) -> str:
    """Return the transcript for a video URL."""
    return f"Transcript for {url}..."

def analyze_sentiment(data: pd.DataFrame) -> pd.DataFrame:
    """Score sentiment on the transcript column. Receives the full DataFrame."""
    result = data.copy()
    result["sentiment_score"] = result["yt_transcribe_output"].apply(
        lambda x: float(len(str(x)) % 10) / 10.0
    )
    return result

def generate_report(metrics_df: pd.DataFrame) -> pd.DataFrame:
    """Summarise sentiment analysis into a single report row."""
    avg = metrics_df["sentiment_score"].mean()
    return pd.DataFrame([{
        "total_videos_analyzed": len(metrics_df),
        "average_sentiment":     avg,
        "status":                "Report Generated",
    }])


# ── Register — one line per function ──────────────────────────────────────────
#   register_operation(func, op_id, display_name, category, operation_type)

register_operation(fetch_videos,      "yt_fetch_videos",       "Fetch Channel Videos",   "YouTube",     "source")
register_operation(extract_metadata,  "yt_extract_metadata",   "Extract Video Metadata", "YouTube",     "map")
register_operation(is_video_popular,  "yt_filter_popular",     "Filter Popular Videos",  "YouTube",     "filter")
register_operation(transcribe,        "yt_transcribe",         "Transcribe Videos",       "AI Analysis", "map")
register_operation(analyze_sentiment, "yt_analyze_sentiment",  "Analyze Sentiment",       "AI Analysis", "dataframe")
register_operation(generate_report,   "yt_generate_report",    "Generate Report",         "AI Analysis", "dataframe")
```

**Rules:**
- The file can have **any name** — the scanner detects the `register_operation` call inside it.
- The functions themselves have **no imports from SimpleSteps** — they stay fully portable.
- Parameters are inferred from type annotations, same as the decorator.
- The `register_operation` block at the bottom is the only coupling to the framework.

---

## Operation Types (Orchestration Modes)

The `operation_type` tells the engine how to call your function in a pipeline.

| Type | What it does | Your function receives | Your function returns |
|---|---|---|---|
| `source` | First step — no input DataFrame | nothing (just scalar config args) | `list` or `pd.DataFrame` |
| `map` | Call once per row, append results | one row's column values as kwargs | `dict` or scalar |
| `filter` | Keep rows where fn returns `True` | one row's column values as kwargs | `bool` |
| `expand` | Call once per row, explode lists into new rows | one row's column values as kwargs | `list` of `dict` |
| `dataframe` | Pass the whole DataFrame at once | `df: pd.DataFrame` as first arg | `pd.DataFrame` |
| `raw_output` | Pass the whole DataFrame, return anything | `df: pd.DataFrame` as first arg | anything (wrapped automatically) |

---

## File Placement & Auto-Discovery

The backend scans `src/` on startup. Two rules determine whether a file is imported:

1. **Filename ends in `_ops.py`** — always imported (Style 1).
2. **File contains `register_operation`** — imported regardless of name (Style 2).

Everything else is ignored.

```
src/
  my_youtube_package/       ← no __init__.py needed
    fetch_ops.py            ← auto-found: ends in _ops.py
    analysis_funcs.py       ← auto-found: contains register_operation
    internal_helpers.py     ← ignored: no _ops suffix, no register_operation
  another_folder/
    scraper_ops.py          ← auto-found: ends in _ops.py
```

Restart the backend after adding a file — that's the only step required.

---

## Inline Formula Syntax

Once registered, an operation appears in the formula bar autocomplete. The formula syntax is:

```
=<operation_id>.<orchestration_mode>(<param>=<value_or_step_reference>)
```

Examples:

```
=yt_fetch_videos.source(channel_url="https://youtube.com/@mkbhd")
=yt_extract_metadata.map(url=step1.output)
=yt_filter_popular.filter(views=step2.views, min_views=5000)
=yt_transcribe.map(url=step3.output)
=yt_analyze_sentiment.dataframe()
=yt_generate_report.dataframe()
```

The `.orchestration_mode` part is optional — the engine uses the `operation_type` from your registration as the default.

---

## Using Built-in Orchestration Operations

For more dynamic pipelines, use the built-in `ss_*` operations. These are first-class operations and appear in the autocomplete just like any other operation.

| Operation | Formula | What it does |
|---|---|---|
| `ss_map` | `=ss_map(fn="my_op", url=step1.url)` | Apply `my_op` row-by-row |
| `ss_filter` | `=ss_filter(fn="my_filter", views=step2.views)` | Keep rows where `my_filter` returns `True` |
| `ss_expand` | `=ss_expand(fn="my_expander", text=step2.body)` | Explode list results into new rows |
| `ss_reduce` | `=ss_reduce(fn="my_summary")` | Pass the full DataFrame to `my_summary` |

The `fn` value is the `op_id` you registered.

---

## Portable Python / Notebook Export

Because your raw functions have no framework imports, the same workflow runs as a plain Python script:

```python
# Run the same pipeline without SimpleSteps

import pandas as pd
from my_package.my_funcs import (
    fetch_videos, extract_metadata, is_video_popular,
    transcribe, analyze_sentiment, generate_report
)

df1 = pd.DataFrame(fetch_videos(), columns=["output"])
df2 = df1.copy()
df2["metadata"] = df2["output"].apply(extract_metadata)

mask = df2["metadata"].apply(lambda m: is_video_popular(m["views"], min_views=3000))
df3 = df2[mask].copy()

df4 = df3.copy()
df4["yt_transcribe_output"] = df4["output"].apply(transcribe)

df5 = analyze_sentiment(df4)
df6 = generate_report(df5)
print(df6)
```

This is the intentional design: **formula bar syntax in the UI, plain Python outside it.**
