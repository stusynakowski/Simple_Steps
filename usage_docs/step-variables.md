# Steps as Python Variables

Simple Steps lets you treat workflow steps as **Python objects**. This means the same code works in the formula bar *and* in standalone Python scripts.

---

## The StepProxy

Every step's output is wrapped in a **StepProxy** — a lightweight object that acts like a Python variable:

```python
from simple_steps import step
import pandas as pd

# Create a step from data
step1 = step(pd.DataFrame({"name": ["alice", "bob"], "score": [85, 92]}))

# Access columns with dot notation
step1.name          # → ColumnProxy for the "name" column
step1.score         # → ColumnProxy for the "score" column

# DataFrame-like behavior
len(step1)          # → 2 (row count)
step1.columns       # → ["name", "score"]
step1.df            # → the raw pandas DataFrame
```

---

## Column Proxies

When you write `step1.name`, you get a **ColumnProxy** — a lazy reference to that column. It supports comparisons, arithmetic, and string operations:

```python
step1.score > 90         # → Boolean series
step1.score + 10         # → Arithmetic
step1.name               # → Pass to any function
```

---

## Auto-Broadcasting

The magic: when you pass a ColumnProxy to a `@simple_step` function, the engine **automatically broadcasts** the call row-by-row.

```python
# This calls extract_metadata once per row in step1.url
step2 = extract_metadata(url=step1.url)
```

Under the hood:
1. Engine sees `step1.url` is a ColumnProxy
2. For each row, it calls `extract_metadata(url="https://...")` with that row's value
3. Collects all the return dicts into a new DataFrame
4. Wraps it as step2's output

This means you write code that looks like it operates on a single value, but it runs on every row. **Same code, single value or entire column.**

---

## In the Formula Bar vs. Python Scripts

The same expression works in both contexts:

**Formula bar:**
```
=extract_metadata(url=step1.url)
```

**Python script:**
```python
from simple_steps import step, extract_metadata
import pandas as pd

step1 = step(pd.read_csv("videos.csv"))
step2 = extract_metadata(url=step1.url)
print(step2.df)
```

No changes needed. The formula *is* valid Python.
