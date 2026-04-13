# Creating Operation Packs

This guide explains how to add custom operations to Simple Steps.

---

## Overview: Three Tiers of Operations

Simple Steps discovers `@simple_step`-decorated Python functions from
three locations, each serving a different purpose:

| Tier | What | Where | Who |
|------|-------|-------|-----|
| **System** | Built-in core ops | `src/SIMPLE_STEPS/operations.py`, `orchestration_ops.py` | Platform maintainers |
| **Developer Packs** | Reusable domain libraries | `packs/` directory or `--packs` flag | Pack authors |
| **Project Ops** | Per-project custom functions | `projects/<name>/ops/` | End users |

All three tiers share the same `@simple_step` decorator and the same
global registry, so operations from any tier work identically in formulas
and the UI.

---

## Tier 1: System Operations (Built-in)

These ship with the `simple_steps` package and are always available:

- **File I/O**: `load_csv`, `export_csv`
- **Data Cleaning**: `filter_rows`, `drop_na`
- **Orchestration**: `ss_map`, `ss_filter`, `ss_expand`, `ss_reduce`

You don't need to do anything to use these — they're imported automatically.

---

## Tier 2: Developer Packs

Developer packs are **reusable across projects**. They're ideal for
domain-specific operations like YouTube mining, LLM analysis, or
web-scraping.

### Creating a Developer Pack

1. **Create a folder** in the `packs/` directory:

```
packs/
└── youtube/
    ├── fetch_ops.py
    └── analysis_ops.py
```

2. **Write your functions** using the `@simple_step` decorator:

```python
# packs/youtube/fetch_ops.py

import pandas as pd
from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="yt_fetch_channel",
    name="Fetch Channel Videos",
    category="YouTube",
    operation_type="source",
)
def fetch_channel_videos(channel_url: str) -> pd.DataFrame:
    """Fetch all video URLs from a YouTube channel."""
    # Your implementation here
    ...
```

3. **Restart Simple Steps** — your operations appear automatically.

### Using the OperationPack Class (Advanced)

For packs that need dependency checking, health validation, or
input/output contracts:

```python
# packs/youtube/youtube_pack_ops.py

from SIMPLE_STEPS.operation_pack import OperationPack

pack = OperationPack(
    name="YouTube Analysis",
    version="1.0.0",
    description="Fetch and analyze YouTube channel data.",
    required_packages=["google-api-python-client", "pandas"],
    required_env_vars=["YOUTUBE_API_KEY"],
)

@pack.step(
    id="yt_fetch",
    name="Fetch Videos",
    operation_type="source",
    output_contract={"video_url": "str"},
)
def fetch_videos(channel_url: str) -> pd.DataFrame:
    ...

@pack.step(
    id="yt_enrich",
    name="Enrich Metadata",
    operation_type="dataframe",
    input_contract={"video_url": "str"},
    output_contract={"title": "str", "views": "int"},
)
def enrich(df: pd.DataFrame) -> pd.DataFrame:
    ...

# IMPORTANT: this line triggers validation + registration
pack.register()
```

If `google-api-python-client` isn't installed or `YOUTUBE_API_KEY` isn't
set, the operations still appear in the UI but are grayed out with a
clear error message — the backend never crashes.

### Adding External Pack Directories

Use the CLI flag or environment variable to load packs from any location:

```bash
# CLI
simple-steps --packs /path/to/team-packs /path/to/other-packs

# Environment variable (semicolon-separated)
export SIMPLE_STEPS_PACKS_DIR="/path/to/team-packs;/path/to/other-packs"
simple-steps
```

### Using the Pack Manifest (Recommended)

For a more permanent and shareable approach, use the `simple_steps.toml`
manifest to declare pack dependencies for your workspace:

```bash
# Import a pack from a git repo
simple-steps pack add https://github.com/org/youtube-ops.git

# Import from a local directory
simple-steps pack add ../shared-packs/analytics

# Install a pip-published pack
simple-steps pack add simple-steps-nlp --pip
```

All declared packs are recorded in `simple_steps.toml` at the workspace
root. Commit this file — teammates can then run `simple-steps pack install`
to fetch everything.

See [`managing-packs.md`](managing-packs.md) for the full guide.

---

## Tier 3: Project Operations

Project ops are **specific to a single project**. They live inside the
project directory and are discovered when the project is loaded.

### Creating Project Operations

1. **Create an `ops/` folder** inside your project:

```
projects/
└── my-youtube-analysis/
    ├── pipeline-1.json
    └── ops/
        ├── custom_scoring.py
        └── helpers.py
```

2. **Write your functions** with `@simple_step`:

```python
# projects/my-youtube-analysis/ops/custom_scoring.py

import pandas as pd
from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="custom_engagement_score",
    name="Calculate Engagement Score",
    category="Custom Scoring",
    operation_type="dataframe",
)
def calculate_engagement_score(
    df: pd.DataFrame,
    views_col: str = "views",
    weight: float = 1.0,
) -> pd.DataFrame:
    """Custom scoring logic for this project."""
    result = df.copy()
    result["engagement_score"] = result[views_col] * weight / 1000
    return result
```

3. **Your functions are available immediately** — no restart needed if
   you call the load endpoint:

```
POST /api/projects/my-youtube-analysis/load-ops
```

Or they'll be auto-discovered when the server starts.

### Alternative: Loose .py Files

You can also just drop `.py` files directly in the project root (next
to your pipeline JSONs). The loader scans both `ops/` and the project
root:

```
projects/
└── quick-analysis/
    ├── pipeline.json
    └── my_helpers.py      ← @simple_step functions here work too
```

---

## The @simple_step Decorator

The decorator is the only thing you need to make a function available:

```python
@simple_step(
    id="my_operation",           # Unique ID used in formulas
    name="My Operation",         # Display name in the UI
    category="My Category",      # Sidebar grouping
    operation_type="dataframe",  # source | map | filter | expand | dataframe
)
def my_operation(df: pd.DataFrame, threshold: float = 0.5) -> pd.DataFrame:
    """Description shown in the UI."""
    return df[df["score"] > threshold]
```

### Parameter Inference

The decorator automatically infers UI parameters from your function's
type hints:

| Python Type | UI Type |
|-------------|---------|
| `str` | text input |
| `int`, `float` | number input |
| `bool` | checkbox |
| `list` | list input |
| `dict` | object input |
| `pd.DataFrame` | data reference (injected by engine) |

Parameters with defaults become optional in the UI. Parameters named
`df`, `data`, or `_input_df` are treated as the pipeline data input and
are injected automatically by the engine — they don't appear in the UI.

### Dependencies

Your functions can import any Python package as long as it's installed
in the active environment. Simple Steps does not manage dependencies
for you — use `pip install` in your environment.

For developer packs, the `OperationPack` class can declare
`required_packages` to provide helpful error messages when dependencies
are missing.

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/operations` | List all registered operations |
| `GET /api/packs` | List all registered OperationPacks with health status |
| `GET /api/loader` | Full pack loader status (ops by tier, load results) |
| `GET /api/debug/registry` | Raw registry state with tier/source info |
| `POST /api/projects/{id}/load-ops` | Load/reload ops for a specific project |

---

## Summary

```
┌─────────────────────────────────────────────────┐
│                  Simple Steps                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  Tier 1: System Ops (always loaded)             │
│  └── src/SIMPLE_STEPS/operations.py             │
│  └── src/SIMPLE_STEPS/orchestration_ops.py      │
│                                                 │
│  Tier 2: Developer Packs (opt-in, reusable)     │
│  └── packs/youtube/                             │
│  └── packs/webscraping/                         │
│  └── --packs /external/path                     │
│  └── simple_steps.toml manifest (git/local)     │
│  └── pip-installed packs (entry points)         │
│                                                 │
│  Tier 3: Project Ops (per-project)              │
│  └── projects/my-project/ops/                   │
│  └── projects/my-project/*.py                   │
│                                                 │
│  All share: @simple_step decorator              │
│  All share: OPERATION_REGISTRY                  │
│  All share: Formula bar + UI sidebar            │
│                                                 │
└─────────────────────────────────────────────────┘
```
