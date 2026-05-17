# 104 — Where the `=` Sign Lives (and Doesn't)

A small note because this is the kind of convention that, if left
implicit, will accumulate bugs at every boundary crossing.

## Rule

The leading `=` is a **UI affordance** that lives **only** in the formula
bar text input. Everywhere else — the workflow file, the session object,
the API request/response bodies, the operation registry, the Python
library API — the expression is stored and passed **without** the `=`.

## Why keep it in the bar at all

Two reasons, both UX:

1. It mirrors spreadsheets, which is a near-universal mental model for
   "this cell holds a formula, not a literal value."
2. It gives the user a single keystroke to switch a cell from a literal
   into formula-editing mode, without an extra UI element.

## Why not keep it anywhere else

- Files would have to re-escape it.
- The agent's `suggested_formula` field would have to either always include
  or always omit it, and downstream code would have to handle both.
- The library form

  ```python
  from simple_steps import run_formula
  run_formula("=upper(text=step1.title)", steps=...)
  ```

  is uglier than

  ```python
  run_formula("upper(text=step1.title)", steps=...)
  ```

  and the `=` carries no information at the library layer — there's no
  alternative interpretation it disambiguates.

## Implementation rule

`safe_formula.parse()` accepts strings with **or without** a leading `=`
and strips it transparently. This means:

- The formula-bar component can pass its raw text through unchanged.
- Library callers and the backend runner can pass the bare expression.
- Both paths converge at parse time.

This is the **only** place the `=` is handled. No other component in the
codebase should care.

## Storage layer (`workflow.json`, sessions, API)

- **Workflow file:** `"expression": "upper(text=step1.title)"` — no `=`.
- **Session:** `step.expression` — no `=`.
- **API:** request and response bodies — no `=`.
- **Agent output:** `suggested_formula` — no `=`. The frontend
  prepends `=` for display in the bar if it wants to.

## Tests to enforce this

When migrating the existing project files / API surface, add a test that
asserts no `expression` field anywhere in the serialised data starts with
`=`. Cheap to write, prevents drift.

## Decision summary

| Layer | Includes `=`? |
|---|---|
| Formula-bar text input (frontend) | ✅ yes |
| `formula` field shown in agent chat UI | ✅ display-only |
| Anywhere else | ❌ no |
