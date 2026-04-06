# Creating Pip-Installable Packs

Simple Steps packs are **separate Python packages** (separate git repos) that contain `@simple_step` decorated functions. When a user `pip install`s your pack, the operations automatically appear in Simple Steps — zero configuration.

## How It Works

Python has a built-in plugin system called **entry points**. Your pack declares an entry point in its `pyproject.toml` that says _"I'm a Simple Steps pack — import me."_ When Simple Steps starts, it scans for all installed packages with that entry point and loads them.

```
User runs:  pip install simple-steps-youtube-pack
                           │
Simple Steps starts:       │
  1. Scans entry points    ▼
  2. Finds "simple_steps.packs" → simple_steps_youtube_pack
  3. Imports the module    → @simple_step decorators fire
  4. Operations appear in the UI ✅
```

## Quick Start: Create a New Pack

### 1. Create a new repo with this structure

```
simple-steps-my-pack/
├── pyproject.toml
├── README.md
└── src/
    └── simple_steps_my_pack/
        ├── __init__.py
        └── operations.py
```

### 2. `pyproject.toml` — the only config you need

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "simple-steps-my-pack"
version = "0.1.0"
description = "My custom operations for Simple Steps"
requires-python = ">=3.9"
dependencies = [
    "simple-steps>=0.1.0",
    # your pack's own deps:
    # "requests>=2.31",
]

# ── THIS IS THE MAGIC LINE ──────────────────────────────
[project.entry-points."simple_steps.packs"]
my_pack = "simple_steps_my_pack"
# ─────────────────────────────────────────────────────────
# Format:  <any_name> = "<python_module_to_import>"

[tool.setuptools.packages.find]
where = ["src"]
```

### 3. `src/simple_steps_my_pack/__init__.py`

```python
# Import your submodules so the decorators run at import time
from . import operations  # noqa: F401
```

### 4. `src/simple_steps_my_pack/operations.py`

```python
from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="my_fetch_data",
    name="Fetch Data",
    category="My Pack",
    operation_type="source",
)
def fetch_data(url: str) -> list:
    """Fetch data from a URL."""
    import requests
    return requests.get(url).json()

@simple_step(
    id="my_transform",
    name="Transform Data",
    category="My Pack",
    operation_type="map",
)
def transform(record: dict, field: str = "name") -> str:
    """Extract a field from a record."""
    return record.get(field, "")
```

### 5. Test locally

```bash
cd simple-steps-my-pack
pip install -e .

# Start Simple Steps — your operations appear automatically
simple-steps
```

### 6. Publish to PyPI

```bash
pip install build twine
python -m build
twine upload dist/*
```

Now anyone can install it:
```bash
pip install simple-steps-my-pack
```

## Naming Conventions

| What | Convention | Example |
|---|---|---|
| PyPI package name | `simple-steps-<domain>-pack` | `simple-steps-youtube-pack` |
| Python module | `simple_steps_<domain>_pack` | `simple_steps_youtube_pack` |
| Entry point name | `<domain>_pack` | `youtube_pack` |
| Operation category | Descriptive name | `"YouTube"` |
| Operation IDs | `snake_case` | `yt_fetch_videos` |

## Using OperationPack for Advanced Packs

For packs that need dependency validation, health checks, or env var checking:

```python
from SIMPLE_STEPS.operation_pack import OperationPack

pack = OperationPack(
    name="YouTube",
    version="1.0.0",
    description="YouTube data operations",
    required_packages=["google-api-python-client"],
    required_env_vars=["YOUTUBE_API_KEY"],
)

@pack.step(id="yt_fetch", name="Fetch Videos", operation_type="source")
def fetch_videos(channel_url: str) -> list:
    ...

@pack.step(id="yt_enrich", name="Enrich Metadata", operation_type="map")
def enrich(url: str) -> dict:
    ...

# This triggers registration + validation
pack.register()
```

## Multiple Files / Subpackages

For larger packs, split across files:

```
src/simple_steps_youtube_pack/
├── __init__.py          # imports all submodules
├── fetch_ops.py         # @simple_step functions for fetching
├── analysis_ops.py      # @simple_step functions for analysis
└── utils.py             # shared helpers (no decorators needed)
```

```python
# __init__.py
from . import fetch_ops    # noqa: F401
from . import analysis_ops # noqa: F401
```

## Template

A ready-to-copy template is available at `pack_template/` in the Simple Steps repo.

Copy it, rename the module, update `pyproject.toml`, and start writing operations.
