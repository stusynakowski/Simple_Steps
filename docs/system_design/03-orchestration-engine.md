# Orchestration Engine

The orchestration engine (`engine.py` + `orchestrators.py`) is responsible for executing operations at runtime. It resolves data references, selects the correct execution wrapper, runs the Python function, and stores the result.

## Core Concept: Reference Passing

The engine never transmits raw data over HTTP. Instead, it uses a **reference passing** pattern:

```
┌──────────────┐    ref_id (UUID)     ┌──────────────┐
│   Frontend    │ ◄──────────────────► │   Backend    │
│ (holds refs)  │                      │ (holds data)  │
└──────────────┘                      └──────────────┘
                                           │
                                      DATA_STORE: Dict[str, pd.DataFrame]
                                           │
                                      ref_id → DataFrame
```

**File:** `src/SIMPLE_STEPS/engine.py`

```python
DATA_STORE: Dict[str, pd.DataFrame] = {}

def save_dataframe(df: pd.DataFrame) -> str:
    ref_id = str(uuid.uuid4())
    DATA_STORE[ref_id] = df
    return ref_id

def get_dataframe(ref_id: str) -> Optional[pd.DataFrame]:
    return DATA_STORE.get(ref_id)
```

In production, `DATA_STORE` could be backed by Redis, Parquet files, or a database. The abstraction is the same — a string key maps to a DataFrame.

## Execution Flow: `run_operation()`

```
run_operation(op_id, config, input_ref_id, step_label_map)
     │
     ├── 1. Resolve input DataFrame from input_ref_id
     │
     ├── 2. Handle passthrough (noop/passthrough op_id)
     │       └── _passthrough() resolves _ref token or returns input
     │
     ├── 3. Look up operation in OPERATION_REGISTRY
     │       └── Get func + suggested_op_type
     │
     ├── 4. Determine orchestration mode
     │       ├── config["_orchestrator"] takes precedence
     │       └── Falls back to registered operation_type
     │
     ├── 5. Select wrapper from ORCHESTRATORS dict
     │
     ├── 6. Resolve step references in config values
     │       └── resolve_reference(value, step_map) for each config value
     │
     ├── 7. Execute: wrapper(func)(**resolved_config)
     │
     └── 8. Save result → DATA_STORE → return (ref_id, metrics)
```

### Step Map

The `step_map` (called `step_label_map` in the function signature) is a dictionary that maps various step identifiers to their output reference IDs in `DATA_STORE`:

```python
step_map = {
    "step-abc123":  "uuid-...",   # Step ID (primary key)
    "Step 1":       "uuid-...",   # Human label
    "step1":        "uuid-...",   # Positional alias (1-indexed)
}
```

The frontend builds this map from all steps that have been executed (i.e., have an `outputRefId`). This allows `resolve_reference()` to look up any token format the wiring UI produces.

## Reference Resolution

**File:** `src/SIMPLE_STEPS/engine.py` — `resolve_reference()`

The engine supports four reference syntaxes:

| Syntax | Example | Resolves To |
|---|---|---|
| Dot syntax | `step1.url` | `pd.Series` (column from step's output) |
| Bracket syntax | `step1[row=3, col=url]` | Scalar cell value |
| Bare step ID | `step1` | `pd.DataFrame` (full output) |
| Excel syntax | `=Step Name!columnName` | `pd.Series` (column) |

Resolution order:
1. Excel-style (`=StepName!col`) — regex match, strip `=`, split on `!`
2. Dot syntax (`stepId.col`) — regex match, split on `.`
3. Bracket syntax (`stepId[row=R, col=C]`) — regex match, extract indices
4. Bare step ID — direct lookup in `step_map`
5. If nothing matches — return the original string (treated as a literal value)

### Passthrough Parameters

The `_PASSTHROUGH_PARAMS` set (`{'fn'}`) contains parameter names that should **never** be resolved as step references. The `fn` parameter in `ss_map`, `ss_filter`, etc. is an operation ID string, not a data reference.

## Orchestration Wrappers

**File:** `src/SIMPLE_STEPS/orchestrators.py`

Each operation type has a corresponding wrapper function that adapts the user's plain Python function to work within the pipeline:

### `source_wrapper`

- **Input:** No DataFrame needed — starts a pipeline.
- **Behavior:** Calls `func(**kwargs)`, normalizes the result into a DataFrame.
- **Return types handled:** DataFrame, list of dicts, list of scalars, single dict, scalar.

```python
@simple_step(id="fetch_videos", operation_type="source")
def fetch_videos(channel_url: str) -> list:
    return [{"url": "...", "title": "..."}, ...]
# source_wrapper converts this list of dicts into a DataFrame
```

### `rowmap_wrapper` (map)

- **Input:** DataFrame from previous step.
- **Behavior:** Iterates over each row, calling `func(column_value)` per row. Appends result columns.
- **Column detection:** Inspects function signature to find which parameter maps to which column. Uses `_determine_target_col()`.
- **Result handling:** If func returns a dict → each key becomes a new column. If scalar → single new column.

```python
@simple_step(id="extract_metadata", operation_type="map")
def extract_metadata(url: str) -> dict:
    return {"title": "...", "views": 9000}
# rowmap_wrapper calls this for each row, expanding the dict into columns
```

### `filter_wrapper`

- **Input:** DataFrame from previous step.
- **Behavior:** Calls `func(column_value)` per row, keeps rows where result is truthy.
- **Returns:** Filtered DataFrame (subset of input rows).

```python
@simple_step(id="is_popular", operation_type="filter")
def is_popular(views: int, min_views: int = 500) -> bool:
    return views > min_views
```

### `expand_wrapper`

- **Input:** DataFrame from previous step.
- **Behavior:** Calls `func(column_value)` per row — expects a list. Explodes each list into new rows.
- **Returns:** DataFrame with more rows than input (one row per list item).

### `dataframe_op_wrapper`

- **Input:** Full DataFrame.
- **Behavior:** Passes the entire DataFrame to `func(df)`. No per-row iteration.
- **Use case:** Operations that need global context (sorting, aggregation, joins).

### `raw_output_wrapper`

- **Input:** Full DataFrame (or no input).
- **Behavior:** Calls `func(**kwargs)` with no orchestration — no DataFrame injection, no row mapping.
- **Use case:** Inspecting the raw return value of a function before any orchestration.

### Wrapper Registry

```python
ORCHESTRATORS = {
    "source":     source_wrapper,
    "map":        rowmap_wrapper,
    "rowmap":     rowmap_wrapper,     # alias
    "filter":     filter_wrapper,
    "expand":     expand_wrapper,
    "dataframe":  dataframe_op_wrapper,
    "raw_output": raw_output_wrapper,
}
```

## Built-in Orchestration Operations

**File:** `src/SIMPLE_STEPS/orchestration_ops.py`

Four first-class operations expose the orchestration layer through the formula bar:

| Formula | Behavior |
|---|---|
| `=ss_map(fn="my_op", url=step1.url)` | Apply `my_op` row-by-row |
| `=ss_filter(fn="my_filter", views=step2.views)` | Keep rows where `my_filter` returns True |
| `=ss_expand(fn="my_expander", text=step2.body)` | Explode list results into new rows |
| `=ss_reduce(fn="my_summary")` | Pass the full DataFrame to `my_summary` |

These use the `orchestrator` operation type, which the engine converts to `dataframe` internally (the functions manage their own iteration).

Key design: The `fn` parameter is a string (the operation ID), not a function reference. The `ss_*` ops look up the function in `OPERATION_REGISTRY` at runtime via `_resolve_fn()`.

## Error Handling

The engine catches exceptions during step execution and re-raises them as `ValueError` with context:

```python
except Exception as e:
    raise ValueError(f"Error executing step {op_id}: {str(e)}")
```

The API layer (`main.py`) catches this and returns a structured error response with the full traceback, which the frontend displays in the execution log panel.

## Data Flow Diagram

```
User clicks "Run" on Step 2
        │
        ▼
Frontend: parseFormula("=extract_metadata.map(url=step1.url)")
  → operation_id: "extract_metadata"
  → config: { _orchestrator: "map", url: "step1.url" }
        │
        ▼
POST /api/run {
  operation_id: "extract_metadata",
  config: { _orchestrator: "map", url: "step1.url" },
  input_ref_id: "abc-123",          ← Step 1's output ref
  step_map: { "step1": "abc-123", "step-xyz": "abc-123", "Fetch Videos": "abc-123" }
}
        │
        ▼
engine.py: run_operation()
  1. df_in = DATA_STORE["abc-123"]     ← 100 rows
  2. op = OPERATION_REGISTRY["extract_metadata"]
  3. orchestrator = "map" (from config._orchestrator)
  4. wrapper = ORCHESTRATORS["map"] = rowmap_wrapper
  5. resolve_reference("step1.url", step_map)
     → step_map["step1"] = "abc-123"
     → DATA_STORE["abc-123"]["url"] = pd.Series([...])
  6. rowmap_wrapper(extract_metadata)(url=<Series>, _input_df=df_in)
     → iterates 100 rows, calls extract_metadata(url=row_val) for each
     → returns DataFrame with original + new columns
  7. save_dataframe(result) → "def-456"
        │
        ▼
Response: { status: "success", output_ref_id: "def-456", metrics: { rows: 100, columns: [...] } }
        │
        ▼
Frontend: GET /api/data/def-456?offset=0&limit=50
  → Returns Cell[] for the data grid
```
