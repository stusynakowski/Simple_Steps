# Managing Packs

This guide covers how to **import**, **create**, **share**, and **sync** operation packs across workspaces using the `simple-steps pack` CLI and the `simple_steps.toml` manifest.

---

## Overview

Simple Steps packs are collections of `@simple_step`-decorated Python functions organized by domain (e.g. YouTube, LLM analysis, web scraping). The pack management system gives you three ways to use them:

| Method | Best For | Command |
|---|---|---|
| **Git import** | Packs from GitHub / team repos | `simple-steps pack add <git-url>` |
| **Local import** | Packs on your filesystem | `simple-steps pack add <path>` |
| **pip install** | Published packs from PyPI | `simple-steps pack add <package> --pip` |
| **Scaffold new** | Creating your own pack | `simple-steps pack create <name>` |

All declared packs are tracked in a **`simple_steps.toml`** manifest at the workspace root. This file is committed to your repo — so anyone who clones it can run `simple-steps pack install` to get everything.

---

## The Manifest: `simple_steps.toml`

When you add a pack, Simple Steps creates (or updates) a `simple_steps.toml` file in your workspace root:

```toml
# Simple Steps — workspace pack manifest
# Managed by: simple-steps pack add / remove
# Run `simple-steps pack install` to sync all declared packs.

[packs]

[packs.youtube-analysis]
source = "git"
url = "https://github.com/org/ss-youtube-pack.git"
ref = "main"
path = ".packs/ss-youtube-pack"

[packs.shared-analytics]
source = "local"
path = "../team-shared/analytics"

[packs.simple-steps-nlp-pack]
source = "pip"
package = "simple-steps-nlp-pack"
```

### What happens at startup

When Simple Steps boots, it reads this manifest and adds all resolved pack directories to the discovery chain. Git and local packs are loaded as **Tier 2 developer packs**; pip packs are discovered automatically via Python entry points.

### Committing to git

**Do commit:** `simple_steps.toml` — this is your pack dependency declaration.

**Don't commit:** `.packs/` — this directory contains cloned git repos and is in `.gitignore`. It gets recreated by `simple-steps pack install`.

---

## CLI Reference

All commands are available as `simple-steps pack <action>`:

### `simple-steps pack list`

List all packs declared in the workspace manifest.

```bash
$ simple-steps pack list

  📦 Packs declared in /Users/you/my-project/simple_steps.toml:

    ✅ youtube-analysis       [git  ]  https://github.com/org/ss-youtube-pack.git (main)
    ✅ shared-analytics       [local]  ../team-shared/analytics
    ✅ nlp-pack               [pip  ]  pip: simple-steps-nlp-pack
```

### `simple-steps pack add <source>`

Add a pack to the manifest. The source type is auto-detected:

```bash
# Git repo — detected by URL pattern
simple-steps pack add https://github.com/org/ss-youtube-pack.git

# Git repo — specific branch/tag
simple-steps pack add https://github.com/org/ss-youtube-pack.git --ref v2.0

# Git repo — custom name in manifest
simple-steps pack add https://github.com/org/ss-youtube-pack.git --name youtube

# Local directory
simple-steps pack add ../shared-packs/analytics

# Pip package (explicit)
simple-steps pack add simple-steps-nlp-pack --pip

# Add to manifest without installing (useful in CI)
simple-steps pack add https://github.com/org/pack.git --no-install
```

**Auto-detection rules:**

| Source string | Detected as |
|---|---|
| Starts with `https://`, `http://`, `git@`, `ssh://`, or ends with `.git` | Git |
| Is an existing directory on disk | Local |
| Everything else | Pip package |

### `simple-steps pack remove <name>`

Remove a pack from the manifest:

```bash
# Remove from manifest only
simple-steps pack remove youtube-analysis

# Remove from manifest AND delete cloned files
simple-steps pack remove youtube-analysis --delete
```

### `simple-steps pack install`

Sync all declared packs — clone git repos, verify local paths, install pip packages:

```bash
$ simple-steps pack install

  📦 Installing 3 declared pack(s)…

  ✅ youtube-analysis: git pack ready (.packs/ss-youtube-pack)
  ✅ shared-analytics: local pack found (/Users/you/team-shared/analytics)
  ✅ nlp-pack: pip package installed (simple-steps-nlp-pack)

  ✅ All packs installed successfully.
```

This is the command your teammates run after cloning your repo:

```bash
git clone https://github.com/you/my-analysis-project.git
cd my-analysis-project
simple-steps pack install   # ← fetches all declared packs
simple-steps                # ← start working
```

### `simple-steps pack create <name>`

Scaffold a new pack:

```bash
# Simple local pack → creates packs/<name>/
simple-steps pack create my-domain

# Pip-installable pack → creates ./<name>/ with pyproject.toml + src/ layout
simple-steps pack create my-domain --pip

# Create in a specific directory
simple-steps pack create my-domain --target /path/to/output
```

---

## Creating a Local Pack

The simplest way to add custom operations:

```bash
simple-steps pack create sentiment-analysis
```

This creates:

```
packs/
└── sentiment-analysis/
    ├── sentiment_analysis_ops.py   ← your operations go here
    └── README.md
```

Edit the generated file:

```python
# packs/sentiment-analysis/sentiment_analysis_ops.py

import pandas as pd
from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="sentiment_score",
    name="Sentiment Score",
    category="Sentiment Analysis",
    operation_type="dataframe",
)
def sentiment_score(df: pd.DataFrame, text_col: str = "text") -> pd.DataFrame:
    """Score sentiment on a text column."""
    result = df.copy()
    result["sentiment"] = result[text_col].apply(lambda t: len(t) % 10 / 10.0)
    return result
```

Restart Simple Steps — your operation appears in the sidebar immediately.

---

## Creating a Pip-Installable Pack

For packs you want to **publish to PyPI** or **share as installable packages**:

```bash
simple-steps pack create youtube-tools --pip
```

This creates a full Python package structure:

```
youtube-tools/
├── pyproject.toml                           ← entry point configured
├── README.md
└── src/
    └── simple_steps_youtube_tools/
        ├── __init__.py                      ← imports operations.py
        └── operations.py                    ← @simple_step functions
```

Development workflow:

```bash
cd youtube-tools
pip install -e .           # install in dev mode
simple-steps               # operations appear automatically
```

To publish:

```bash
pip install build twine
python -m build
twine upload dist/*
```

See [`creating_pip_packs.md`](creating_pip_packs.md) for the full guide on pip-installable packs.

---

## Importing Packs from Git Repos

This is the most common workflow for **team collaboration**:

```bash
# Your colleague published a YouTube operations pack on GitHub
simple-steps pack add https://github.com/colleague/ss-youtube-ops.git
```

What happens:

1. The repo is cloned into `.packs/ss-youtube-ops/` in your workspace
2. An entry is added to `simple_steps.toml`
3. On next startup, all `@simple_step` functions in that repo are discovered

To pull the latest changes:

```bash
simple-steps pack install    # pulls latest for all git packs
```

### Expected repo structure

The git repo should contain `.py` files with `@simple_step` decorators, anywhere in the tree. Common layouts:

```
# Flat
ss-youtube-ops/
├── fetch_ops.py
└── analysis_ops.py

# Organized in subdirectories
ss-youtube-ops/
├── youtube/
│   ├── fetch_ops.py
│   └── analysis_ops.py
└── utils/
    └── helpers.py
```

The pack loader recursively scans the cloned directory for `.py` files, so any layout works.

---

## Importing Local Packs

For packs on your local filesystem (e.g. a shared network drive or a sibling repo):

```bash
simple-steps pack add ../team-shared/analytics-pack
```

The path is stored in the manifest as-is. If it's inside your workspace, it's stored as a relative path:

```toml
[packs.analytics-pack]
source = "local"
path = "../team-shared/analytics-pack"
```

> **Note:** Local packs must already exist on disk. They are not copied — the manifest just points to them. Make sure the path is valid for anyone who uses the repo.

---

## REST API

Pack management is also available via the backend API, enabling future frontend UI integration:

| Endpoint | Method | Description |
|---|---|---|
| `/api/packs` | `GET` | List all declared packs |
| `/api/packs` | `POST` | Add a pack (body: `{source, url/path/package, name?, ref?}`) |
| `/api/packs/{name}` | `DELETE` | Remove a pack from manifest |
| `/api/packs/install` | `POST` | Install/sync all declared packs |

### Example: List packs

```bash
curl http://localhost:8000/api/packs | python -m json.tool
```

```json
[
  {
    "name": "youtube-analysis",
    "source": "git",
    "url": "https://github.com/org/ss-youtube-pack.git",
    "ref": "main",
    "path": ".packs/ss-youtube-pack",
    "package": "",
    "enabled": true
  }
]
```

### Example: Add a pack

```bash
curl -X POST http://localhost:8000/api/packs \
  -H "Content-Type: application/json" \
  -d '{"source": "git", "url": "https://github.com/org/pack.git"}'
```

---

## Discovery Priority

When Simple Steps starts, operations are discovered in this order. Later tiers can override earlier ones:

| Priority | Source | Description |
|---|---|---|
| 1 | System ops | Built-in (`operations.py`, `orchestration_ops.py`) |
| 2 | `packs/` directory | Workspace-local developer packs |
| 3 | `ops/` directory | Workspace-level custom operations |
| 4 | Top-level `*.py` | Python files in workspace root |
| 5 | Bundled packs | Ships with the simple-steps package |
| 6 | Legacy sibling dirs | `youtube_operations/`, `llm_operations/`, etc. |
| 7 | `--packs` / env vars | CLI flags and `SIMPLE_STEPS_PACKS_DIR` |
| 8 | **`simple_steps.toml`** | **Manifest-declared packs (git, local)** |
| 9 | pip entry points | Pip-installed packs (auto-discovered) |
| 10 | Project ops | Per-project `ops/` folders |

---

## Typical Workflows

### Solo developer — local packs

```bash
cd my-analysis-project
simple-steps pack create scoring       # creates packs/scoring/
# edit packs/scoring/scoring_ops.py
simple-steps                            # operations appear in UI
```

### Team collaboration — git packs

```bash
# Developer A: creates and pushes a pack repo
simple-steps pack create youtube-ops --pip
cd youtube-ops
# write operations, test, push to GitHub

# Developer B: imports the pack
cd their-project
simple-steps pack add https://github.com/org/youtube-ops.git
git add simple_steps.toml
git commit -m "add youtube ops pack"
git push

# Developer C: clones the project
git clone https://github.com/org/their-project.git
cd their-project
simple-steps pack install               # clones all declared git packs
simple-steps                            # ready to go
```

### Publishing to PyPI

```bash
simple-steps pack create my-pack --pip
cd my-pack
# write operations
pip install -e .                        # test locally
python -m build && twine upload dist/*  # publish

# Users install with:
pip install simple-steps-my-pack
# Operations appear automatically — no manifest needed for pip packs
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `simple-steps pack add` fails with "not found" | For local paths, make sure the directory exists. For git URLs, check access. |
| Pack ops don't appear after `pack add` | Restart Simple Steps — pack discovery happens at startup. |
| `simple-steps pack install` fails for git pack | Check that `git` is installed and you have access to the repo. |
| Manifest shows a pack but it's not loaded | Check the startup logs — the pack loader prints `✅` or `❌` for each pack. |
| `.packs/` directory is huge | It contains full git clones. Use `--ref` to pin a tag instead of tracking `main`. |
| TOML parse error | On Python <3.11 without `tomli`, the manual writer is used. Ensure `simple_steps.toml` is valid TOML. Install `tomli` for robust parsing: `pip install tomli`. |
