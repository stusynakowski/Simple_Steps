# 103 — The UI as a Formula Formulator

> "The UI should be designed to help the user formulate the expression,
> in ways that are correct and easy to update."

That sentence is the entire frontend brief. Everything in this note is
elaborating it.

## Mental shift

The old UI thought of itself as a **form** for configuring an operation:
pick an op from a dropdown, then fill in its fields. That works fine for
the `op(kw=…, kw=…)` shape but breaks the moment you want to nest calls or
pass a column reference.

The new UI thinks of itself as an **expression editor** with two equivalent
projections:

| Projection | When to use it | Source of truth |
|---|---|---|
| **Text mode** | Always available; the formula bar itself. | The expression string. |
| **Structured mode** | When the AST matches a recognisable shape (`op(kw=…, …)`). | The AST. |

The two are kept in sync by re-parsing on every edit. Either projection
can be the active editing surface at any moment.

## What "help the user formulate" actually means

For each step, the UI must provide:

1. **Autocomplete** over the live namespace at the cursor:
   - bare names → registered op ids + step names available at this step
   - after `stepN.` or `stepN[` → column names of `stepN`'s output
   - inside an op call → that op's kwarg names from its signature
2. **Live validation diagnostics**, served by `/api/validate_formula`, with
   debounce. Squiggle the offending range; tooltip the message.
3. **Structured panel** for any call whose AST matches `op(kw=…, …)` with
   no nested calls — a flat form with one field per kwarg, typed by the
   op's signature, with step-/column-pickers for step-reference args.
   The panel is a *view* on the AST: edits round-trip back to text.
4. **"Insert reference" affordances** — clicking a column header of a
   previous step splices `stepN["that_col"]` into the formula bar at the
   cursor. Same idea as Excel clicking a cell while editing a formula.
5. **Graceful degradation** — if the expression is anything the structured
   panel can't represent (nested calls, an unrecognised top-level shape),
   the panel shows a clear "edit in text mode" state instead of silently
   dropping pieces.

## Bracket form is the only thing the UI emits

Decision: **the UI always emits bracket notation** (`step1["col"]`) for
column references — autocomplete completions, the "insert reference"
button, the structured-panel round-trip, the agent's `suggested_formula`,
all of it.

The parser accepts dot form (`step1.col`) for valid identifiers because
users will type it by hand, but the UI never writes it. This keeps the
emitted-text shape uniform regardless of column names and means a single
"canonicalise on save" pass (if we ever want one) only has to rewrite in
one direction.

## The three argument categories, in UI terms

For an op call `f(a=expr_a, b=expr_b, c=expr_c)` the structured panel
renders each kwarg according to its AST shape:

| Arg AST | Renders as |
|---|---|
| `Name` matching a step ref (`step1`) | Step picker (dropdown of available steps) |
| `Subscript` / `Attribute` on a step (`step1["col"]`) | Step + column picker |
| `Constant` matching the type-hint of the kwarg | Typed input (number / string / bool / enum) |
| `List`/`Dict` literal | JSON-ish editor |
| `Call` (nested op) | Sub-panel, recursively rendered |

When the user changes a field, we rebuild that subtree of the AST and
re-emit the expression string. The bar updates; if the user is currently
typing in the bar, we don't clobber their text — text-mode wins until
they blur the field.

## What the UI does *not* do

- It does **not** decide what code runs. Only registered ops are callable;
  the backend AST interpreter enforces this regardless of what the UI
  permits.
- It does **not** maintain a separate "configuration" data structure.
  There is one source of truth per step: the expression string.
- It does **not** swallow validation errors. Every error returned by
  `validate` is surfaced to the user; nothing fails silently.

## Open UX questions (for later notes)

- How do we surface partial / streaming op results (e.g. long-running
  LLM calls) inside a structured field?
- Should the structured panel be inline under the formula bar or a side
  drawer? (Probably inline for top-level, drawer for deeply nested.)
- Keyboard-first formula editing — do we want a `Cmd+.` "pick a reference"
  palette?
