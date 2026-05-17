# Mock: Basic Variables

This mock project exercises the **`literal`** operation defined in
`mock_basic_variables_ops.py`. The goal is to confirm that — through the
Simple Steps UI — a user can build a single workflow whose steps each
instantiate a Python literal directly from the formula bar, exactly the
way a Python assignment reads.

## Goal

Using the UI, load (or build) **one workflow** consisting of seven steps.
Each step's formula bar contains a bare literal expression:

```text
= "hello world"
= 42
= 3.14
= True
= [1, 2, 3, 4, 5]
= {"name": "alice", "age": 30}
= {"user": {"name": "alice", "scores": [90, 85, 92]}}
```

Every step must produce a **1×1 DataFrame** with a single default column
named `value` holding the parsed Python literal:

```
┌──────────────────────────────────────────────────┐
│                      value                       │
├──────────────────────────────────────────────────┤
│  <python literal — string / int / float / bool / │
│   list / dict / nested dict>                     │
└──────────────────────────────────────────────────┘
```

## Step-by-step expectation

| # | Formula bar                                              | Resulting `value` cell                             | Python type |
|---|----------------------------------------------------------|----------------------------------------------------|-------------|
| 1 | `= "hello world"`                                        | `hello world`                                      | `str`       |
| 2 | `= 42`                                                   | `42`                                               | `int`       |
| 3 | `= 3.14`                                                 | `3.14`                                             | `float`     |
| 4 | `= True`                                                 | `True`                                             | `bool`      |
| 5 | `= [1, 2, 3, 4, 5]`                                      | `[1, 2, 3, 4, 5]`                                  | `list`      |
| 6 | `= {"name": "alice", "age": 30}`                         | `{'name': 'alice', 'age': 30}`                     | `dict`      |
| 7 | `= {"user": {"name": "alice", "scores": [90, 85, 92]}}`  | `{'user': {'name': 'alice', 'scores': [...]}}`    | `dict`      |

## Operation under test

`literal(expr: str) -> pd.DataFrame`

- Parses `expr` with `ast.literal_eval` (safe — no `eval`).
- Accepts any valid Python literal: strings, ints, floats, bools, lists,
  dicts, tuples, `None`, and arbitrarily nested combinations of those.
- Always wraps the parsed value in a 1×1 DataFrame with column `value`,
  so downstream steps can reference it with a stable shape.

## Success criteria

1. All seven steps load and execute in the UI without error.
2. Each step's output table is exactly 1 row × 1 column (`value`).
3. The cell contents match the "Resulting `value` cell" column above.
4. The formula bar round-trips: editing a step and re-saving preserves
   the exact `= <literal>` text.

> Workflow JSON files have been intentionally removed. The next task is
> to author this single workflow **through the UI** and save it back
> into a `workflows/` directory beside this README.
