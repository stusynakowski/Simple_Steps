# Helper Functions

Simple Steps provides helper functions for using **any plain Python function** — no `@simple_step` decorator needed — with step broadcasting. These work in both the formula bar (eval mode) and standalone scripts.

---

## Two Flavors

| Flavor | Helpers | Output |
|---|---|---|
| **Tabular** | `map_each`, `apply_to`, `filter_by`, `expand_each` | Dict keys become multiple columns |
| **Raw / cell-level** | `val`, `col` | Return value stored as-is in one column |

---

## Tabular Helpers

### `map_each(fn, *args, **kwargs)`

Apply a function to **each row**. If the function returns a dict, the keys become columns.

```python
def fetch(url):
    return {"title": "My Video", "views": 5000}

step2 = map_each(fetch, step1.url)
# → columns: title, views
```

### `apply_to(fn, *args, **kwargs)`

Pass the **whole column** (as a pandas Series) to the function at once. Good for vectorized operations.

```python
step2 = apply_to(np.cumsum, step1.score)
# → column: score (cumulative sum)
```

### `filter_by(fn, *args, **kwargs)`

Keep only the rows where `fn` returns `True`.

```python
# Row-wise:
step2 = filter_by(lambda x: x > 1000, step1.views)

# Vectorized (if fn returns a boolean Series):
step2 = filter_by(lambda s: s > s.mean(), step1.score)
```

### `expand_each(fn, *args, **kwargs)`

When a function returns a **list**, expand each list into multiple rows. Turns 1 row → N rows.

```python
def get_tags(title):
    return ["python", "tutorial", "data"]

step2 = expand_each(get_tags, step1.title)
# 3 input rows → 9 output rows (each with 3 tags)
```

---

## Raw / Cell-Level Helpers

These store the return value **as-is** in a single column. Dicts, lists, strings, numbers — they all go into one cell, never unpacked.

### `val(fn, *args, name=None, **kwargs)`

Apply `fn` to **each row**, store raw result in one column.

```python
step2 = val(str.upper, step1.name)
# → column: "upper" with values "ALICE", "BOB"

step2 = val(len, step1.name)
# → column: "len" with values 5, 3

step2 = val(json.loads, step1.raw_json)
# → column: "loads" with parsed dicts in each cell

step2 = val(my_func, step1.url, name="api_result")
# → custom column name
```

### `col(fn, *args, name=None, **kwargs)`

Pass the **whole column** to `fn` once. Result becomes one new column.

```python
step2 = col(np.cumsum, step1.score)
# → column: "cumsum" with running total

step2 = col(lambda s: s.rank(), step1.score)
# → column: "rank"

step2 = col(np.mean, step1.score)
# → scalar gets broadcast to every row
```

---

## When to Use Which

| I want to… | Use |
|---|---|
| Call a function per row, get multiple output columns | `map_each` |
| Run a vectorized function on the whole column, tabular output | `apply_to` |
| Filter rows | `filter_by` |
| Expand lists into rows | `expand_each` |
| Call a function per row, keep result in one cell | `val` |
| Run a vectorized/aggregate function, one output column | `col` |
