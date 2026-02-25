# Simple Steps Backend Engine

This directory contains the core backend logic for the **Simple Steps** application. It serves as an orchestration engine that manages data workflows, executes registered Python operations, and handles data passing between steps.

## 🏗 Architecture Overview

The backend is built with **FastAPI** and uses **pandas** as the universal data structure for passing information between steps.

### Core Components

1.  **`main.py`**  
    The FastAPI entry point. It exposes endpoints for the frontend to:
    -   Discover available operations (`/api/operations`).
    -   Execute a workflow step (`/api/run`).
    -   Retrieve paginated data for the grid view (`/api/data/{ref_id}`).

2.  **`engine.py`**
    The "brain" of the operation. It:
    -   Manages an in-memory `DATA_STORE` (referencing DataFrames by UUID).
    -   Resolves input references (getting the DataFrame from the previous step).
    -   Executes the specific Python function associated with an Operation ID.
    -   Saves the result back to the store and returns a new Reference ID.

3.  **`decorators.py`**
    Contains the `@simple_step` decorator. This is the magic that transforms a standard Python function into a "Simple Step" operation. It:
    -   Automatically registers the function in the `OPERATION_REGISTRY`.
    -   Infers UI parameter types (text, number, boolean) from Python type hints.
    -   Wraps the function to handle DataFrame inputs/outputs automatically.

4.  **`models.py`**
    Pydantic models defining the API contract (Requests/Responses) and internal data structures.

5.  **`operations.py`** & **`youtube_ops.py`**
    Collections of actual operations. 
    -   `operations.py`: Standard tools (Load CSV, Filter Rows).
    -   `youtube_ops.py`: Domain-specific examples (Fetch YouTube Videos, Sentiment Analysis).

---

## 🚀 How It Works

### 1. Operations Registry
The system is designed to be **extensible**. You don't need to manually update a central list to add a new feature. Just write a function and decorate it:

```python
@simple_step(name="My Custom Step", category="Analysis", operation_type="map")
def my_function(input_text: str) -> int:
    return len(input_text)
```

The system automatically detects:
-   **ID**: `my_function`
-   **Params**: `input_text` (Type: string)
-   **Returns**: Integer (will be converted to a DataFrame column)

### 2. Execution Flow (The "Ref ID" System)
We do **not** pass full datasets back and forth to the frontend.
1.  **Frontend** asks to run a step: "Run `filter_rows` on data `ref_123` with config `{value: 5}`".
2.  **Backend** looks up `ref_123` in memory -> retrieves the pandas DataFrame.
3.  **Engine** runs the `filter_rows` function on that DataFrame.
4.  **Engine** saves the result as `ref_456`.
5.  **Backend** returns `ref_456` to the Frontend.
6.  **Frontend** requests a *preview* of `ref_456` (first 50 rows) to display in the grid.

### 3. Data Storage
Currently, the `DATA_STORE` in `engine.py` is a simple in-memory Python dictionary.
-   **Key**: `UUID` string.
-   **Value**: `pd.DataFrame`.

> *Note: In a production environment, this would likely be replaced by Redis, Parquet files on S3, or a database.*

---

## 🔌 API API Cheatsheet

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/operations` | Returns JSON list of all registered operations and their schema. |
| `POST` | `/api/run` | Executes a step. Requires `operation_id` and `input_ref_id`. Returns `output_ref_id`. |
| `GET` | `/api/data/{ref_id}` | Returns a slice (preview) of the data for the UI grid. |

---

## 🛠 Extending functionality

To add a new capability to the backend:

1.  Create a new file (e.g., `src/SIMPLE_STEPS/my_tool.py`) or add to existing ones.
2.  Import `simple_step`.
3.  Write your function with type hints.
4.  Decorate it.
5.  **Crucial**: Import your new file in `main.py` so the decorator runs and registers the tool!

```python
# In main.py
from . import my_tool 
```
