# Next Steps: Orchestrator Enhancements (Feb 27, 2026)

## Current State of Orchestration
The `orchestrators.py` file currently supports basic single-layer orchestration wrappers:
*   `source`: Generating data.
*   `map` / `rowmap`: Iterating over rows (now fixed to NOT expand dicts).
*   `filter`: Filtering rows based on a boolean return.
*   `expand`: Exploding lists into rows.
*   `dataframe`: Passing the full dataframe.

## The Problem: Composition
Users want to combine operations in a single step, e.g., "Map this function AND then filter the results."
Currently, `engine.py` selects strictly **one** wrapper based on the configuration string:
```python
wrapper = ORCHESTRATORS[config.get("orchestrator", "map")]
```

## Proposed Solution: Piped Orchestration
To support composition like `orchestrator="map|filter"`, we need to modify `engine.py` to support **Piped Orchestrators**.

### Implementation Strategy
Change the orchestrator lookup in `engine.py` to split by `|` and wrap recursively.

**Pseudo-code for Engine Update:**
```python
# In src/SIMPLE_STEPS/engine.py

# 1. Get orchestration config, e.g., "map|filter"
orch_config = config.get("orchestrator", "map")
orch_names = orch_config.split("|")

# 2. Start with the raw function
wrapped_func = raw_function

# 3. Apply wrappers in REVERSE order (innermost first)
# Example: "map|filter" -> filter_wrapper(map_wrapper(func))
# This means:
#   - map_wrapper(func) returns a DF with new results.
#   - filter_wrapper will then filter THAT resulting dataframe.
for name in reversed(orch_names):
    if name in ORCHESTRATORS:
        wrapper = ORCHESTRATORS[name]
        wrapped_func = wrapper(wrapped_func)
    else:
        print(f"Warning: Unknown orchestrator '{name}'")

# 4. Execute
result_df = wrapped_func(**params)
```

### Benefits
*   **Cleaner Formulas**: `config={orchestrator="map|filter"}`
*   **Less "Super-Step" Boilerplate**: No need to write python glue code just to filter a result immediately.
*   **Flexible Data Flow**: `map|expand` (Map a function that returns a list, then explode it).

## Immediate Action Items
1.  Verify `rowmap_wrapper` fix (single cell dicts) is working in production.
2.  Refactor `engine.py` to parse `|` separated strings.
3.  Test generic composition (e.g. does `filter` know which column to filter after `map` created it?).
    *   *Note: Resolving `target_col` in the second wrapper might require passing the 'output column name' from the first wrapper.*
