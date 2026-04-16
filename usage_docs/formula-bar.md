# The Formula Bar

The formula bar is where you define what each step does. It sits at the top of every step and works like a cell formula in a spreadsheet — but backed by Python.

---

## Basic Syntax

Formulas start with `=` and look like function calls:

```
=operation_name(param1="value", param2=123)
```

Parameters can reference columns from previous steps using dot notation:

```
=extract_metadata(url=step1.url)
=filter_rows(column="views", min_value=step2.threshold)
```

Here `step1` and `step2` refer to the output of step 1 and step 2 in your workflow.

---

## Step References

| Syntax | Meaning |
|---|---|
| `step1` | The entire output of step 1 (all columns) |
| `step1.url` | The `url` column from step 1 |
| `step1.score` | The `score` column from step 1 |

The step number corresponds to the step's position in the workflow (left to right, starting at 1).

---

## Eval Mode (Advanced)

When **Eval Mode** is enabled in Settings, the formula bar becomes a Python REPL. Any valid Python expression works:

```
=step1.url.str.upper()
=len(step1)
=val(str.upper, step1.name)
=col(np.cumsum, step1.score)
```

Eval mode gives you the full power of Python — pandas, numpy, and any imported module — right in the formula bar.

### What's Available in Eval Mode

| Name | What It Is |
|---|---|
| `step1`, `step2`, … | StepProxy objects wrapping each step's DataFrame |
| `pd` | pandas |
| `np` | numpy |
| `df_in` / `df` | The raw input DataFrame from the previous step |
| All registered operations | Callable by name (e.g., `extract_metadata(...)`) |
| `map_each`, `apply_to`, `filter_by`, `expand_each` | Tabular helper functions |
| `val`, `col` | Raw cell-level helper functions |

### ⚠️ Security Note

Eval mode executes arbitrary Python code. Only enable it in trusted development environments. It is off by default.

---

## How Formulas Get Executed

1. You type or select a formula
2. The frontend parses it to extract the operation name and parameters
3. The backend looks up the operation in the registry
4. If found → runs via the standard engine (parameter injection, type coercion, orchestration)
5. If not found and eval mode is on → executes as raw Python via the eval engine
6. The result (a DataFrame) becomes this step's output and is available to the next step
