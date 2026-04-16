# Operations & the Sidebar

Operations are the Python functions that power your workflow steps. The sidebar shows all available operations grouped by category.

---

## Where Operations Come From

Simple Steps discovers operations from three tiers:

### Tier 1 — System Operations (Built-in)

Always available. These are bundled with Simple Steps:

| Operation | Category | What It Does |
|---|---|---|
| `load_csv` | File IO | Load a CSV file into a step |
| `filter_rows` | Data Cleaning | Filter rows by column value |
| `drop_na` | Data Cleaning | Remove rows with missing values |
| `ss_map` | Orchestration | Map an operation over each row |
| `ss_filter` | Orchestration | Filter rows using an operation |
| `ss_expand` | Orchestration | Expand lists into rows via an operation |
| `ss_reduce` | Orchestration | Reduce/aggregate rows via an operation |

### Tier 2 — Developer Packs

Functions you or your team write. Discovered from:

- **`packs/`** directory in your workspace
- **`ops/`** directory in your workspace
- **Top-level `*.py`** files in the workspace root
- **External packs** declared in `simple_steps.toml` (git, local, or pip)

Files must end in `_ops.py` and use the `@simple_step` decorator.

### Tier 3 — Project Operations

Python files inside a specific project folder (`projects/<name>/**/*.py`). These are scoped to that project — useful for project-specific custom logic.

---

## The Operation Packs View

Click the **📦 icon** in the Activity Bar to see the Packs panel. It shows:

- Each loaded pack with its name and operation count
- Click a pack to expand and see its individual operations
- Any errors during pack loading are shown in red
- The pack's file path is shown at the bottom of each pack

---

## Creating Your Own Operation

The simplest way — drop a file in your `packs/` directory:

```python
# packs/my_ops.py

from SIMPLE_STEPS.decorators import simple_step

@simple_step(
    id="my_function",
    name="My Function",
    category="My Tools",
    operation_type="map",
)
def my_function(text: str) -> dict:
    """Process some text and return results."""
    return {"length": len(text), "upper": text.upper()}
```

Restart the backend and it appears in the sidebar automatically.

### Operation Types

| Type | Behavior |
|---|---|
| `map` | Called once per row. Receives individual values. |
| `dataframe` | Called once with the entire DataFrame. |
| `source` | Generates data (no input step needed). |

---

## Orchestration Operations

The four `ss_*` operations let you chain operations together in the formula bar:

```
=ss_map(fn="extract_metadata")        # run extract_metadata on each row
=ss_filter(fn="is_popular")           # keep rows where is_popular returns True
=ss_expand(fn="get_tags")             # expand lists into rows
=ss_reduce(fn="summarize")            # aggregate all rows into one
```

These reference other operations by their ID (the `id` parameter from `@simple_step`).
