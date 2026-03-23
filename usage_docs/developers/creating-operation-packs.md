# Creating Failsafe Operation Packs

An **Operation Pack** is the recommended way to bundle a set of related functions for Simple Steps. It wraps the standard `@simple_step` registration with:

- **Dependency validation** — missing pip packages are caught at startup, not at runtime
- **Environment checks** — missing API keys are reported before any step executes
- **Input/output contracts** — column shape mismatches fail early with clear errors
- **Custom health checks** — verify DB connections, API endpoints, model availability
- **Graceful degradation** — unavailable packs show grayed-out in the UI instead of crashing

---

## Quickstart

```python
# my_ops.py  (filename must end in _ops.py for auto-discovery)

import pandas as pd
from SIMPLE_STEPS.operation_pack import OperationPack

# 1. Declare the pack
pack = OperationPack(
    name="My Analysis Pack",
    version="1.0.0",
    description="Fetch and analyze data from my API.",
    required_packages=["requests", "pandas"],
    required_env_vars=["MY_API_KEY"],
)

# 2. Define operations
@pack.step(
    id="my_fetch",
    name="Fetch Data",
    operation_type="source",
    output_contract={"url": "str", "title": "str"},
)
def fetch_data(query: str = "default") -> pd.DataFrame:
    """Fetch items from the API."""
    import requests
    resp = requests.get(f"https://api.example.com/search?q={query}")
    return pd.DataFrame(resp.json()["results"])

@pack.step(
    id="my_enrich",
    name="Enrich Metadata",
    operation_type="dataframe",
    input_contract={"url": "str"},
    output_contract={"url": "str", "score": "float"},
)
def enrich(df: pd.DataFrame) -> pd.DataFrame:
    """Add a score column based on the URL."""
    df = df.copy()
    df["score"] = df["url"].apply(lambda u: len(u) * 0.1)
    return df

# 3. Register — one line triggers validation + registration
pack.register()
```

That's it. Drop this file into any scanned folder (`src/`, `mock_operations/`, or a custom plugin path), restart the backend, and all operations appear in the UI.

---

## What Happens When Dependencies Are Missing

If `requests` isn't installed or `MY_API_KEY` isn't set:

```
📂 Scanning: /Users/you/project/src/my_package
  ⚠️  Pack 'My Analysis Pack' v1.0.0: ❌ Missing package: requests → pip install requests; Missing env var: MY_API_KEY
  ✅ Registered: my_ops (2 ops, UNAVAILABLE)
```

The operations **still appear** in the sidebar (so users know they exist), but they are **grayed-out**. If a user tries to run one, they get a clear error:

```
Operation 'my_fetch' is unavailable: Missing package: requests → pip install requests
```

The backend does **not** crash.

---

## API: `OperationPack`

### Constructor

| Parameter | Type | Description |
|---|---|---|
| `name` | `str` | Pack display name (used as default category in sidebar) |
| `version` | `str` | Semantic version |
| `description` | `str` | Shown in `/api/packs` |
| `required_packages` | `list[str]` | PyPI packages to check with `import` |
| `required_env_vars` | `list[str]` | Environment variables that must be set |
| `health_checks` | `list[Callable]` | Custom functions returning `(bool, str)` |

### `@pack.step()` Decorator

| Parameter | Type | Description |
|---|---|---|
| `id` | `str` | Unique operation ID for the formula bar |
| `name` | `str` | Human-readable label in the UI |
| `operation_type` | `str` | `source`, `map`, `filter`, `expand`, `dataframe`, `raw_output` |
| `category` | `str` | Sidebar group (defaults to `pack.name`) |
| `input_contract` | `dict` | Expected input columns: `{"col": "dtype"}` |
| `output_contract` | `dict` | Promised output columns: `{"col": "dtype"}` |

### `pack.register()`

Call once at module level (bottom of the file). Returns a `HealthStatus`:

```python
status = pack.register()
print(status.ok)       # True/False
print(status.errors)   # ["Missing package: requests → pip install requests"]
print(status.checks)   # {"pkg:requests": False, "env:MY_API_KEY": True}
```

---

## Input / Output Contracts

Contracts are optional but powerful for catching wiring mistakes early:

```python
@pack.step(
    id="enrich_videos",
    name="Enrich Videos",
    operation_type="dataframe",
    input_contract={"video_url": "str", "video_id": "str"},   # required input columns
    output_contract={"video_url": "str", "title": "str", "views": "int"},  # promised output
)
def enrich_videos(df: pd.DataFrame) -> pd.DataFrame:
    ...
```

If the previous step's output doesn't have `video_url` and `video_id`, the engine raises:

```
[enrich_videos] Input contract violation: missing columns ['video_id']. Available: ['video_url', 'text']
```

If your function forgets to add `title` to the output:

```
[enrich_videos] Output contract violation: promised columns ['title'] not in result. Got: ['video_url', 'views']
```

---

## Custom Health Checks

For more complex validation (DB ping, API token test, model availability):

```python
def check_openai_key():
    import os
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key.startswith("sk-"):
        return (False, "OPENAI_API_KEY is missing or invalid")
    return (True, "OpenAI key present")

def check_postgres():
    try:
        import psycopg2
        conn = psycopg2.connect("postgresql://localhost/mydb", connect_timeout=3)
        conn.close()
        return (True, "Postgres connection OK")
    except Exception as e:
        return (False, f"Postgres unreachable: {e}")

pack = OperationPack(
    name="AI + DB Pack",
    health_checks=[check_openai_key, check_postgres],
    ...
)
```

If Postgres is down, the pack's operations are grayed-out but the backend stays up.

---

## Inspecting Packs at Runtime

### API Endpoint

```
GET /api/packs
```

Returns:
```json
[
  {
    "name": "YouTube Analysis (Pack)",
    "version": "1.0.0",
    "available": true,
    "operation_ids": ["pack_yt_fetch", "pack_yt_metadata", ...],
    "health": {
      "ok": true,
      "checks": {"pkg:pandas": true},
      "errors": []
    }
  }
]
```

### Python

```python
from SIMPLE_STEPS.operation_pack import PACK_REGISTRY

for name, pack in PACK_REGISTRY.items():
    print(f"{name}: available={pack.is_available}, ops={pack.operation_ids}")
    health = pack.health()
    for check, ok in health.checks.items():
        print(f"  {check}: {'✅' if ok else '❌'}")
```

---

## Comparison: `@simple_step` vs `OperationPack`

| Feature | `@simple_step` / `register_operation` | `OperationPack` |
|---|---|---|
| Registration | Immediate on import | Deferred until `pack.register()` |
| Missing pip package | **Backend crashes** on import | Ops grayed-out, backend stays up |
| Missing API key | Error at runtime (step fails) | Caught at startup, ops grayed-out |
| Input validation | None | Contract checks before function runs |
| Output validation | None | Contract checks after function returns |
| Health monitoring | None | Custom checks, `/api/packs` endpoint |
| Grouping | Manual `category` per function | Automatic from `pack.name` |

**Use `@simple_step`** for quick prototyping and simple utilities.
**Use `OperationPack`** for production-grade packs that other users depend on.

---

## File Layout Example

```
src/
  youtube_package/
    yt_analysis_ops.py    ← OperationPack with 6 steps
    helpers.py            ← internal, not scanned
  llm_package/
    llm_ops.py            ← OperationPack with 4 steps
mock_operations/
  mock_youtube_ops.py     ← @simple_step (quick prototyping)
  mock_youtube_pack_ops.py ← same functions, OperationPack style
```
