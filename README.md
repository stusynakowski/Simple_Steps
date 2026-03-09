# Simple Steps

A visual workflow tool that lets non-technical users build and run multi-step data pipelines — backed by plain Python functions.

Think of it as a spreadsheet where every cell is a Python operation, every column is a pipeline step, and every row is a piece of data flowing through it.

---

## What It Does

You define operations as ordinary Python functions. Simple Steps wraps them in a React UI where users can:

- **Build pipelines** by chaining steps in a visual canvas
- **Wire data** between steps using a formula bar (`=extract_metadata.map(url=step1.output)`)
- **Run steps** individually or as a full pipeline, seeing live row-by-row output
- **Save and reload** workflows as portable JSON files
- **Export** any workflow as a plain Python script — the formula syntax is valid Python

The formula bar is the single source of truth. The UI controls (dropdowns, parameter fields) just edit the formula — they never hold independent state.

---

## Architecture

```
┌─────────────────────────────────┐     HTTP/REST      ┌──────────────────────────────┐
│  React Frontend  (Vite + TS)    │ ◄────────────────► │  FastAPI Backend  (Python)   │
│                                 │                     │                              │
│  • Step canvas (arrow icons)    │                     │  • Operation Registry        │
│  • Formula bar                  │                     │  • Orchestration Engine      │
│  • Data grid (Glide)            │                     │  • Plugin auto-scanner       │
│  • Autocomplete                 │                     │  • Workflow file manager     │
└─────────────────────────────────┘                     └──────────────────────────────┘
```

**Frontend:** React 18, TypeScript, Vite, Glide Data Grid, Lucide icons  
**Backend:** FastAPI, Pydantic v2, pandas, uvicorn  
**Python:** 3.10+

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+

### 1. Clone

```bash
git clone https://github.com/stusynakowski/Simple_Steps.git
cd Simple_Steps
```

### 2. Backend

```bash
# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Start the server (runs on http://localhost:8000)
./start_backend.sh
```

Or manually:

```bash
python -m uvicorn SIMPLE_STEPS.main:app --reload --port 8000 --app-dir src
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev        # runs on http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## How Operations Work

An **operation** is a plain Python function registered into the backend. Once registered, it:

- Appears in the formula bar autocomplete
- Shows its parameters in the UI parameter panel
- Can be wired to the output of any previous step

### Define and register a function

```python
# src/my_ops/video_ops.py

from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="extract_metadata",
    name="Extract Video Metadata",
    category="YouTube",
    operation_type="map",        # called once per row
)
def extract_metadata(url: str) -> dict:
    """Fetch title, views, and author for a video URL."""
    return {"title": "...", "views": 9000, "author": "..."}
```

The file name ends in `_ops.py` — the backend finds and imports it automatically on startup. No config needed.

### Or register without a decorator

```python
# src/my_ops/analysis.py

from SIMPLE_STEPS.decorators import register_operation

def sentiment_score(text: str, model: str = "default") -> float:
    return 0.87

register_operation(sentiment_score, "sentiment", "Sentiment Score", "AI", "map")
```

Any file containing `register_operation` is auto-imported regardless of its name.

### Use it in the formula bar

```
=extract_metadata.map(url=step1.output)
=sentiment.map(text=step2.transcript, model="fast")
```

---

## Operation Types

| Type | Engine behaviour | Your function signature |
|---|---|---|
| `source` | No input — starts a pipeline | `def fn(param=val) -> list \| DataFrame` |
| `map` | Called once per row | `def fn(col1, col2, ...) -> dict \| scalar` |
| `filter` | Keep rows where fn returns `True` | `def fn(col1, col2, ...) -> bool` |
| `expand` | Explode list results into new rows | `def fn(col1, ...) -> list[dict]` |
| `dataframe` | Receives the full DataFrame | `def fn(df: pd.DataFrame) -> pd.DataFrame` |
| `raw_output` | Receives the full DataFrame, returns anything | `def fn(df: pd.DataFrame) -> Any` |

---

## Built-in Orchestration Operations

Four built-in `ss_*` operations let you compose other registered functions dynamically:

| Formula | What it does |
|---|---|
| `=ss_map(fn="my_op", url=step1.url)` | Apply `my_op` row-by-row |
| `=ss_filter(fn="my_filter", views=step2.views)` | Keep rows where `my_filter` is `True` |
| `=ss_expand(fn="my_expander", text=step2.body)` | Explode list results into new rows |
| `=ss_reduce(fn="my_summary")` | Pass the full DataFrame to `my_summary` |

---

## Workflow Files

Workflows are saved as plain JSON in `projects/`:

```json
{
  "id": "wf-abc123",
  "name": "YouTube Analysis",
  "steps": [
    {
      "step_id": "step-1",
      "operation_id": "yt_fetch_videos",
      "label": "Fetch Videos",
      "formula": "=yt_fetch_videos.source(channel_url=\"https://youtube.com/@mkbhd\")",
      "config": {}
    },
    {
      "step_id": "step-2",
      "operation_id": "yt_extract_metadata",
      "label": "Extract Metadata",
      "formula": "=yt_extract_metadata.map(url=step-1.output)",
      "config": {}
    }
  ]
}
```

The `formula` field is the canonical source of truth — `operation_id` and `config` are derived from it on load.

---

## Project Structure

```
Simple_Steps/
├── src/
│   ├── SIMPLE_STEPS/          # Core framework
│   │   ├── main.py            # FastAPI app + plugin auto-scanner
│   │   ├── engine.py          # Orchestration engine
│   │   ├── decorators.py      # @simple_step + register_operation
│   │   ├── orchestrators.py   # map / filter / expand / dataframe wrappers
│   │   ├── orchestration_ops.py # Built-in ss_map, ss_filter, ss_expand, ss_reduce
│   │   ├── models.py          # Pydantic models
│   │   └── file_manager.py    # Workflow JSON persistence
│   ├── youtube_operations/    # Example domain operations
│   ├── llm_operations/
│   └── webscraping_operations/
├── frontend/                  # React + TypeScript app
│   └── src/
│       ├── components/        # StepToolbar, OperationColumn, StepDetailView …
│       ├── hooks/             # useWorkflow (central state)
│       ├── services/          # api.ts (REST client)
│       └── utils/             # formulaParser.ts
├── projects/                  # Saved workflow JSON files
├── tests/                     # pytest tests
├── usage_docs/                # Developer documentation
│   └── developers/
│       └── adding-operations.md
└── pyproject.toml
```

---

## Development

### Run tests

```bash
pytest -q
```

### Type-check the frontend

```bash
cd frontend
npx tsc --noEmit
```

### Run the frontend test suite

```bash
cd frontend
npm test
```

---

## Documentation

| Doc | Description |
|---|---|
| [`usage_docs/developers/adding-operations.md`](usage_docs/developers/adding-operations.md) | Full guide: how to define and register operations |
| [`docs/introduction.md`](docs/introduction.md) | Product overview and problem statement |
| [`docs/spec/`](docs/spec/) | Feature specifications |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

---

## License

MIT
