# Operation Registration

Operations are the atomic units of work in Simple Steps. Every operation is a plain Python function that gets registered into a global registry. Once registered, it appears in the formula bar autocomplete, shows its parameters in the UI, and can be executed by the engine.

## Registration Methods

### Method 1: `@simple_step` Decorator

**File:** `src/SIMPLE_STEPS/decorators.py`

```python
from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="extract_metadata",
    name="Extract Video Metadata",
    category="YouTube",
    operation_type="map",
)
def extract_metadata(url: str) -> dict:
    """Fetch title, views, and author for a video URL."""
    return {"title": "...", "views": 9000}
```

The decorator:
1. Inspects the function's signature and type hints.
2. Infers UI parameter types (string, number, boolean, etc.).
3. Creates an `OperationDefinition` with the metadata.
4. Stores the definition and the raw function in `OPERATION_REGISTRY`.
5. Returns the **original function unmodified** — no wrapping.

This is critical: the decorator does NOT wrap the function. You can call `extract_metadata(url="...")` directly in a Python script and get the raw result. The orchestration wrapper is only applied at execution time by `engine.py`.

### Method 2: `register_operation()`

For cases where a decorator is inconvenient (third-party functions, dynamic registration):

```python
from SIMPLE_STEPS.decorators import register_operation

def sentiment_score(text: str, model: str = "default") -> float:
    return 0.87

register_operation(sentiment_score, "sentiment", "Sentiment Score", "AI", "map")
```

### Method 3: `OperationPack.step` Decorator

For bundled packs with dependency checking:

```python
from SIMPLE_STEPS.operation_pack import OperationPack

pack = OperationPack(
    name="YouTube Analysis",
    required_packages=["google-api-python-client"],
    required_env_vars=["YOUTUBE_API_KEY"],
)

@pack.step(id="yt_fetch", name="Fetch Videos", operation_type="source")
def fetch_videos(channel_url: str) -> list:
    ...

pack.register()  # validates deps + registers all queued ops
```

## The Global Registry

```python
OPERATION_REGISTRY: Dict[str, dict] = {}
```

Each entry:

```python
OPERATION_REGISTRY["extract_metadata"] = {
    "definition": OperationDefinition(
        id="extract_metadata",
        label="Extract Video Metadata",
        description="Fetch title, views, and author for a video URL.",
        type="map",
        category="YouTube",
        params=[
            OperationParam(name="url", type="string", description="...", default=None),
        ],
    ),
    "func": extract_metadata,   # The raw Python function
    "category": "YouTube",
    "type": "map",
}
```

There's also a flat list `DEFINITIONS_LIST: List[OperationDefinition]` used by `GET /api/operations` to serve the catalogue to the frontend.

## Parameter Inference

When a function is registered, `@simple_step` inspects its signature to build the `params` list:

```python
def extract_metadata(url: str, max_results: int = 10, verbose: bool = False) -> dict:
    ...
```

Produces:

| Param | Python Type | UI Type | Default |
|---|---|---|---|
| `url` | `str` | `string` | `None` |
| `max_results` | `int` | `number` | `10` |
| `verbose` | `bool` | `boolean` | `False` |

### Type Mapping

| Python Type | UI Type |
|---|---|
| `str` | `string` |
| `int`, `float` | `number` |
| `bool` | `boolean` |
| `list`, `List` | `list` |
| `dict`, `Dict` | `object` |
| `pd.DataFrame` | `dataframe` |
| Anything else | `string` (fallback) |

### Excluded Parameters

These parameter names are automatically excluded from the UI param list (they're injected by the engine):
- `df`, `data`, `_input_df` — conventional DataFrame arguments
- `*args`, `**kwargs` — variadic parameters

## Operation Types

The `operation_type` determines the default orchestration wrapper used by the engine:

| Type | Engine Behavior | Function Signature |
|---|---|---|
| `source` | No input — starts a pipeline | `def fn(param=val) → list \| DataFrame` |
| `map` | Called once per row | `def fn(col1, col2, ...) → dict \| scalar` |
| `filter` | Keep rows where fn returns True | `def fn(col1, col2, ...) → bool` |
| `expand` | Explode list results into new rows | `def fn(col1, ...) → list[dict]` |
| `dataframe` | Receives the full DataFrame | `def fn(df: pd.DataFrame) → pd.DataFrame` |
| `raw_output` | No orchestration, returns anything | `def fn(df: pd.DataFrame) → Any` |
| `orchestrator` | Internal: for ss_map, ss_filter, etc. | `def fn(df, fn="", **kwargs) → DataFrame` |

The type is a **default recommendation**. Users can override it via the formula modifier: `=op.filter(...)` forces filter mode even if the operation is registered as `map`.

## Auto-Discovery

The backend automatically finds and imports files containing `@simple_step` or `register_operation`. The three-tier system (see [Pack System](./05-pack-system.md)) scans:

1. Files named `*_ops.py` in scanned directories
2. Files containing `@simple_step` or `@pack.step` decorators
3. Files containing `register_operation` calls

The `PackLoader` (`pack_loader.py`) handles this scanning. See the Pack System document for details.

## Frontend Consumption

The frontend fetches the operation catalogue via `GET /api/operations`, which returns:

```json
[
  {
    "id": "extract_metadata",
    "label": "Extract Video Metadata",
    "description": "Fetch title, views, and author for a video URL.",
    "type": "map",
    "category": "YouTube",
    "params": [
      { "name": "url", "type": "string", "description": "...", "default": null }
    ]
  }
]
```

This drives:
- **Autocomplete** in the formula bar (StepToolbar)
- **Parameter inputs** in the Details tab (OperationColumn)
- **Category grouping** in the Sidebar (operation picker)
- **Type inference** for the orchestration mode dropdown
