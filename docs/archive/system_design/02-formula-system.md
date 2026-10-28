# Formula System

The formula bar is the conceptual heart of Simple Steps. It is the **single source of truth** for what a step does — every other representation (UI controls, persisted JSON, engine config) is derived from it.

## Design Philosophy

The formula syntax is intentionally identical to Python function call syntax:

```python
# What you type in the formula bar:
=extract_metadata.map(url=step1.url, max_results=1000)

# What you'd write in a Python script:
extract_metadata(url=step1_df["url"], max_results=1000)
```

This means a workflow can theoretically be exported as a plain Python script, and a Python developer looking at a formula immediately understands what it does.

## Formula Syntax

```
=<operation_id>[.<orchestration_mode>](<key>=<value>, ...)
```

### Components

| Part | Required | Example | Description |
|---|---|---|---|
| `=` prefix | Yes | `=` | Signals this is a formula (vs. a bare reference or plain text) |
| `operation_id` | Yes | `extract_metadata` | The registered operation function ID |
| `.orchestration_mode` | No | `.map` | Overrides the operation's default type. One of: `source`, `map`, `filter`, `dataframe`, `expand`, `raw_output` |
| `(args...)` | Yes | `(url=step1.url)` | Keyword arguments passed to the function |

### Value Quoting Rules

Values in formula arguments follow strict quoting rules that mirror Python syntax:

| Value Type | Format | Example | Rationale |
|---|---|---|---|
| Step reference | **Unquoted** | `url=step1.url` | Looks like Python variable attribute access |
| Literal string | **Quoted** | `channel_url="https://..."` | Standard Python string literal |
| Number | **Unquoted** | `min_views=1000` | Standard Python numeric literal |
| Boolean | **Unquoted** | `active=true` | Standard Python boolean (lowercase for JS compat) |
| Nested formula | **Unquoted** | `ref==other_formula(...)` | Passthrough (starts with `=`) |

### Step Reference Pattern

Step references match the regex: `/^step[\w-]*\.\w+$/i`

Valid examples:
- `step1.url` — positional alias (1-indexed)
- `step-02iqkl5.url` — step ID (UUID-style)
- `step10.col_name` — higher-numbered step with underscore column

Invalid (treated as literal strings):
- `https://example.com` — URL, not a step reference
- `just_a_word` — no dot-separated column
- `www.example.com` — doesn't start with "step"

## Implementation: Two Parsers, One Contract

The formula system has **dual implementations** that must produce identical output:

### TypeScript (Frontend)

**File:** `frontend/src/utils/formulaParser.ts`

```
parseFormula(input: string) → ParsedFormula
buildFormula(operationId, config, orchestration?) → string
isStepReference(value) → boolean
formatFormulaValue(value) → string
```

### Python (Backend)

**File:** `src/SIMPLE_STEPS/models.py`

```
build_formula_from_fields(operation_id, config, orchestration?) → str
_is_step_reference(value) → bool
_format_formula_value(value) → str
```

The Python parser reference implementation also exists in `tests/test_formula_alignment.py` as `parse_formula_python()` for cross-language alignment testing.

### ParsedFormula Structure

```typescript
interface ParsedFormula {
  operationId: string | null;     // "extract_metadata"
  orchestration: OrchestrationMode | null;  // "map" | "source" | ...
  args: Record<string, string>;   // { url: "step1.url", max: "1000" }
  isValid: boolean;               // true when formula has closing paren
  rawInput: string;               // the original input string
}
```

Key behavior: `parseFormula` always **strips quotes** from values. So `url="step1.url"` and `url=step1.url` both parse to `{ url: "step1.url" }`. The quoting distinction matters only for display and export — not for the parsed result.

## Bidirectional Sync

The formula bar and the UI details panel (dropdowns, text inputs) are bidirectionally synced through `OperationColumn.tsx`:

```
┌─────────────────┐                          ┌──────────────────────┐
│  Formula Bar     │  handleFormulaUpdate()   │  Details Panel (UI)  │
│  (StepToolbar)   │ ────────────────────────►│  (dropdowns/inputs)  │
│                  │                          │                      │
│                  │  handleUiUpdate()        │                      │
│                  │ ◄────────────────────────│                      │
└─────────────────┘                          └──────────────────────┘
```

### Formula → UI (`handleFormulaUpdate`)

When the user types in the formula bar:
1. `parseFormula(formula)` extracts `operationId`, `orchestration`, and `args`.
2. If valid: `process_type` ← `operationId`, `configuration` ← `{ ...internalKeys, ...args }`.
3. The details panel re-renders with the parsed values.

### UI → Formula (`handleUiUpdate`)

When the user changes a dropdown or input:
1. `buildFormula(operationId, config, orchestration)` reconstructs the formula string.
2. The formula bar updates to show the new string.
3. `step.formula` is set to the new formula (canonical write).

### Internal Keys

Keys prefixed with `_` (like `_orchestrator`, `_ref`) are **internal metadata** that:
- Are NOT included in the formula string
- ARE persisted in the `config` dict in JSON
- Are carried through during sync operations

The `_orchestrator` key stores the orchestration mode selected by the user. When reconstructing a formula, `buildFormula` reads it from config if no explicit orchestration argument is passed.

## Formula Lifecycle

### 1. User Types Formula

```
User types: =extract_metadata.map(url=step1.url)
        ↓
parseFormula() → { operationId: "extract_metadata", orchestration: "map", args: { url: "step1.url" } }
        ↓
handleFormulaUpdate() updates step state:
  - formula: "=extract_metadata.map(url=step1.url)"
  - process_type: "extract_metadata"
  - configuration: { _orchestrator: "map", url: "step1.url" }
```

### 2. User Clicks Run

```
step.formula → parseFormula() → operationId + args
        ↓
POST /api/run {
  operation_id: "extract_metadata",
  config: { _orchestrator: "map", url: "step1.url" },
  input_ref_id: "uuid-of-previous-step",
  step_map: { "step1": "uuid", "Step 0": "uuid", "step-abc": "uuid" }
}
        ↓
engine.py: resolve_reference("step1.url", step_map) → pd.Series
        ↓
orchestrators.py: map_wrapper iterates rows, calls extract_metadata(url=row_value)
```

### 3. Workflow Save

```
step.formula → written directly to pipeline JSON as the "formula" field
step.process_type → written as "operation_id" (backward compat)
step.configuration → written as "config"
```

### 4. Workflow Load

```
PipelineFile JSON → StepConfig(model_validator):
  if formula is empty → build_formula_from_fields(operation_id, config)
        ↓
Frontend hydrateStep():
  if formula is valid → derive process_type + configuration from it
  if formula is missing → rebuild from operation_id + config
```

## Special Cases

### Passthrough Steps

When a formula bar contains a bare reference (no `=` prefix), the step becomes a passthrough:

```
Formula bar: step1.url
        ↓
process_type: "passthrough"
configuration: { _ref: "step1.url" }
```

The engine's `_passthrough()` function resolves the reference and passes the data through unchanged.

### No Orchestration Modifier

```
=fetch_videos(channel_url="https://...")
```

When no `.modifier` is present, `orchestration` is `null`. The engine falls back to the operation's registered default type (from `@simple_step(operation_type="source")`).

### Legacy Files (No Formula Field)

Pipeline JSON files from before the formula field was introduced are handled by:
1. **Backend**: `StepConfig.derive_formula_if_missing` model validator automatically calls `build_formula_from_fields()`.
2. **Frontend**: `hydrateStep()` checks if the saved formula is valid; if not, it reconstructs from `operation_id` + `config`.

## Testing Strategy

Formula alignment is tested at three levels:

1. **Unit tests** (`formulaParser.test.ts`): Individual `parseFormula`/`buildFormula` behavior.
2. **Integration tests** (`formulaIntegration.test.ts`): Round-trips, bidirectional sync, save/load, step references.
3. **Cross-language alignment** (`test_formula_alignment.py`): Python reference implementation produces identical output to TypeScript for the same inputs.
