# 105 — Validation Flow

How a formula moves from "characters in the bar" to "I ran it".

## Two questions, two answers

> **Where does validation actually happen — frontend or backend?**

The **backend is canonical**. `safe_formula.validate()` is the only source
of truth for whether a formula is legal, because the backend is the only
place that has the live `OPERATION_REGISTRY` and the real signatures.

The **frontend pre-validates** for UX — it knows the registered ops (from
`/api/operations`) and the current step names, so it can draw squiggles
on common mistakes without a round trip. But the frontend's verdict is
advisory; the backend always re-checks before running.

> **When does the workflow file get updated?**

**On run, you commit.** Editing the formula bar is local UI state. The
moment you trigger a run of that step, three things happen atomically
from the user's perspective:

1. The backend `validate`s the formula.
2. If it passes, the `expression` field on disk is updated.
3. The runner executes it; the output replaces the cached output.

If validation fails, nothing is written. The bar still shows your edits,
but the saved workflow is unchanged. (Compare Excel: typing into a cell
doesn't commit until you press Enter.)

## End-to-end flow

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. user types in formula bar                                     │
│    UI:    pre-parse + pre-validate against cached op signatures  │
│    UI:    render Diagnostic[] as squiggles (code → color)        │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │ user hits Enter / clicks Run
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. POST /api/run_step { step_name, expression }                  │
│    backend:                                                      │
│      diags = validate(expression, available_steps, registry)     │
│      if diags: return { ok: false, diagnostics: [...] }          │
│      session.workflow.steps[name].expression = expression  ◄ commit
│      df = run_formula(expression, steps=session.outputs)         │
│      session.outputs[name] = normalize(df)                       │
│      mark downstream dirty                                       │
│      return { ok: true, output_preview, diagnostics: [] }        │
└──────────────────────────────────────────────────────────────────┘
```

The "pre-validate" call from the UI is an optional convenience. If we
ever want to skip the round trip entirely for typo-checking, the UI can
call `POST /api/validate_formula` instead — same `validate()`, no run, no
write.

## Diagnostic codes → UI affordances

The frontend can use the `code` field on each `Diagnostic` to choose how
to render the squiggle. Suggested mapping:

| code                  | severity | squiggle  | quick-fix?           |
|-----------------------|----------|-----------|----------------------|
| `syntax_error`        | error    | red       | —                    |
| `disallowed_node`     | error    | red       | —                    |
| `unknown_op`          | error    | red       | "did you mean …?"    |
| `unknown_name`        | error    | red       | "did you mean …?"    |
| `indirect_call`       | error    | red       | —                    |
| `attr_non_step`       | error    | red       | swap for op call     |
| `subscript_non_step`  | error    | red       | —                    |
| `subscript_non_string`| error    | red       | quote it             |
| `dunder_attr`         | error    | red       | —                    |
| `starred_arg`         | error    | red       | —                    |
| `kwarg_unpack`        | error    | red       | —                    |
| `unknown_kwarg`       | error    | red       | "did you mean …?"    |
| `missing_required`    | error    | red       | insert kwarg stub    |
| `too_many_positional` | error    | red       | —                    |

Everything is "error" right now — we don't have warning-level codes yet.
When we add things like "unused step ref" or "deprecated op", those'll
ship with `severity: "warning"` and a yellow squiggle.

The "unknown" affordance the user asked about is just: **a code the UI
doesn't recognise gets a neutral gray squiggle**, so adding new codes
backend-side never breaks the frontend.

## Why not Pydantic?

`Diagnostic` is a tiny `@dataclass` with four fields. Pydantic would buy
us `.model_dump()` and stricter coercion, but the dataclass already
serialises cleanly via `asdict()` and is mutable-free in practice. If we
later need request/response validation around `/api/validate_formula`,
the API layer can wrap it in a Pydantic model — the core stays plain.

## Open questions

- **Debounce strategy on the frontend.** Pre-validate on every keystroke,
  or only on pause? Probably 150 ms pause.
- **Caching op signatures on the frontend.** `/api/operations` already
  ships params; we should send `inspect.signature` info too so the
  frontend can do `unknown_kwarg`/`missing_required` without a backend
  call.
- **AST offsets for kwarg *names*.** Right now `unknown_kwarg` underlines
  the *value* of the bad kwarg, not the name itself, because the Python
  AST doesn't expose the kwarg-name offset directly. If users find this
  confusing, we can compute it by re-tokenizing.
