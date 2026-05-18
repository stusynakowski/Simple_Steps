# Status Update: Migration to Decorator-Based Architecture (Feb 16, 2026)

## 1. The Goal: "Excel with Superpowers"
We are building **Simple Steps**: a platform where non-technical users define linear data workflows.
*   **The User Experience:** Users stack blocks (Steps). Step 1 gets data (e.g., "Get YouTube Videos"). Step 2 transforms it (e.g., "Analyze Sentiment").
*   **The "Magic":** The user picks a function that works on *one* item (like "Transcribe this Video"), and the system automatically applies it to *thousands* of items in a table (Vectorization).
*   **The Tech Shift:** We are moving away from manual "Adapters" (writing glue code for every function) to **Decorators** (tagging a function to make it work automatically).

## 2. Component Audit (Keep vs. Kill)

To clean up the architecture and fix the issue of operations not appearing in the UI, here is the manifest:

### Backend (`src/SIMPLE_STEPS`)

| File | Status | Action Required |
| :--- | :--- | :--- |
| `decorators.py` | **CORE (KEEP)** | This is the new engine. It holds the `OPERATION_REGISTRY` and `simple_step` logic. |
| `youtube_ops.py` | **KEEP** | This is the "Business Logic". Applied `@simple_step` to functions here. |
| `operations.py` | **KEEP** | Standard ops (CSV load, Filter). Refactored to use `@simple_step`. |
| `main.py` | **KEEP** | The API server. **Needs Update:** Must import ops files to access registry. |
| `engine.py` | **KEEP** | Orchestrates execution. **Needs Update:** Use the registry from `decorators.py`. |
| `models.py` | **KEEP** | Shared data types. |
| `generic_adapter.py` | **DELETE** | 💀 DEAD CODE. Replaced by `decorators.py`. |
| `youtube_adapter.py` | **DELETE** | 💀 DEAD CODE. Logic moved to decorated `youtube_ops.py`. |

### Frontend (`frontend/src`)
*   **Keep Everything.** The frontend view is correct. The issue is simply that the backend isn't sending the list of operations yet.

## 3. The Immediate Fix: Wiring It Up

The reason operations aren't showing is likely because **Python hasn't "read" the files with the decorators yet**, so they aren't in the registry when the server starts.

### Step A: Consolidate the Registry (Backend)
Ensure `src/SIMPLE_STEPS/decorators.py` is the single source of truth for `OPERATION_REGISTRY`.

### Step B: Populate the Registry on Startup
Modify `src/SIMPLE_STEPS/main.py`. We **must** import the files containing decorated functions, or the decorators will never run.

```python
# main.py pseudocode
from .decorators import OPERATION_REGISTRY

# IMPORTANT: Import modules so their decorators run!
from . import youtube_ops  # Registers YouTube ops
from . import operations   # Registers Standard ops
```

### Step C: Cleanup
1.  Delete `src/SIMPLE_STEPS/generic_adapter.py` and `src/SIMPLE_STEPS/youtube_adapter.py`.
2.  Update `main.py` imports.
3.  Restart backend.
