# Core adoption — status and next changes

> Working doc. Tracks the five updates against `simple_steps_core` as the
> backend's heart. Core is **read-only** from this repo: gaps are shimmed in
> `src/SIMPLE_STEPS/core_bridge.py` and recorded in
> [`core-proposals/003-app-adoption.md`](core-proposals/003-app-adoption.md).
>
> Last verified: 2026-09-30, core submodule `52092ba`.

## Where things stand

| | item | state |
|---|---|---|
| 1 | Registry holds only my tools + system tools | **not started** — design settled (namespace-only `ResourceSpec`) |
| 2 | Docstring + input/output args in the registry | **backend done**, frontend not started |
| 3 | `simple_step_tool` / `simple_step_resource` | **done** |
| 4 | Formula parser correctness + commit-on-Enter | **not started** |
| 5 | `app.py` as the explicit application surface | **not started** — partly blocked on core §C |

Nothing visual has changed yet. The rebuilt bundle is byte-identical to the
previous one (`index-CabJEJJT.js`) because the only frontend edit so far was
TypeScript types, which erase at compile time. **The backend now sends richer
data that nothing renders.** That is item 2's frontend half.

## What to expect when you run it

Verified working:

- Backend imports and serves — 31 operations (29 system + 2 project).
- The pack loader still discovers project ops through the new registration path.
- `GET /api/operations` returns `required`, `kind`, `description` and `returns`
  per tool.
- 161 of 224 tests pass, unchanged from before this work.

Should look and behave exactly as it did. If anything differs in the UI, that
is a regression, not a feature — the rendering work has not landed.

---

## The thing to fix first (not a feature)

**63 tests were already failing before any of this work: 30 failed, 33 errors.**
They are all `FileNotFoundError` on missing fixtures. The tests reference 21
distinct workflow files; 13 exist and **8 are absent — every one of them a
`var-*`**:

```
var-string   var-int    var-float   var-bool
var-list     var-dict   var-nested-dict   var-all-types
```

`mock_projects/mock_basic_variables/workflows/` holds three files, none of them
these. So it is one coherent gap — the basic-variables fixture set was never
committed or was removed — not scattered rot.

This matters more than it looks. Verifying "no regressions" currently means
counting `FAILED`/`ERROR` lines before and after a change and comparing —
which is what was done here, and it works, but it is fragile and it means a
genuine new failure can hide inside a pre-existing wall of red. Every item
below gets riskier while this stands.

Either restore the fixtures or mark those tests skipped with a reason. Either
is fine; leaving 63 red is not.

---

## Item 1 — built-in tools as namespace-only resources

Design is settled (proposal §F): four namespace-only `ResourceSpec`s rather
than "packs", following core's own `orchestration` precedent.

| spec | tools | from |
|---|---|---|
| `reshape` | 18 | `operations.py` — Data Reshaping |
| `clean` | 3 | `operations.py` — Data Cleaning |
| `sources` | 2 | `operations.py` — Data Sources |
| `file_io` | 1 | `operations.py` — File IO |
| `orchestration` | 4 | already core's, via `orchestration_ops.py` |

`simple_step_resource()` and the `resource=` path through
`register_with_core()` are both in place, so this is mechanical.

### The one real decision

**Tool ids become qualified.** A tool bound to `reshape` registers in core as
`reshape-add_column`, with bare `add_column` kept as an alias. Saved workflows
reference the bare name.

So: does the **local** `OPERATION_REGISTRY` key on the bare id or the qualified
one?

Recommendation: **keep local keys bare.** The local registry is what
`engine.py` resolves formulas against, and every saved workflow and every
formula a user has typed says `add_column`. Core holds the qualified id and the
alias; the app keeps the name the user sees. Revisit when the engine itself
becomes core's.

If we qualify local keys instead, `engine.py`'s lookup and the formula
validator both need alias resolution, and old save files need a migration. Not
worth it for a grouping change.

---

## Item 2 — the frontend half

Backend is done and flowing. Three changes in the UI:

**1. Registry sidebar rows.** [`SessionManager.tsx:224`](../frontend/src/components/SessionManager.tsx#L224)
currently puts the whole description in a `title` tooltip and shows nothing
else. It should expand to show the docstring summary, each parameter with type
and required flag, and the return type/form.

**2. Filter resource params out of forms — this is a latent bug.** Any param
with `kind === 'resource'` is injected by the engine from the resource
container. Rendered as a form field it would appear as an empty text box that
does nothing, and a user filling it in would be writing a value that gets
overwritten at run time. Nothing has `kind: 'resource'` yet, so nothing is
broken today — but item 1 introduces resources, so this filter has to land
*before* or *with* it, in the params panel as well as the sidebar.

**3. Undocumented params.** 51 of 78 params (65%) have real docstring text.
The rest come through as `""` because their docstrings have prose and examples
but no `Args:` section — `make_range` is the example. Render those as plainly
undocumented rather than blank, and treat it as a prompt to write the
docstrings rather than a bug.

---

## Item 4 — formula correctness and commit-on-Enter

Two separable halves. The validation half is nearly free; the interaction half
is where the care goes.

### Validation — the validator already exists and is already right

`safe_formula.validate()` catches all of these. `parse_formula()` — which is
what `/api/parse_formula` actually calls — reports `isValid: True` for every
one:

| formula | `parse_formula` | `validate()` |
|---|---|---|
| `=bogus_op(x=1)` | `isValid: True` | Unknown operation: 'bogus_op' |
| `={celsius}` | `isValid: True` | Disallowed syntax: Set |
| `=add_column(totally_bogus_arg=1)` | `isValid: True` | Unknown argument … Valid: ['df','expression','name'] |
| `=add_column()` | `isValid: True` | Missing required argument 'df' |

Note `={celsius}` is not merely accepted — it is silently reinterpreted as a
`literal` op, so a formula the grammar rejects becomes a step that runs.

Changes:

1. `/api/parse_formula` calls `validate()` with `available_steps` and the
   registry, and returns the diagnostics. It passes neither today, which is
   also why unknown *steps* go uncaught.
2. Response grows a `diagnostics: [{message, code, offset}]` array. Keep
   `isValid` for compatibility, defined as `diagnostics.length === 0`.
3. The endpoint needs the step names in scope — the caller must send them, so
   this is a request-shape change, not just a response one.

### Interaction — commit on Enter, formula bar canonical

Per your description: after the `=` the formula bar is the declaration of the
step, and it is the source of truth; editing params in the operation UI writes
back to it.

- **Stop parsing on every keystroke.** [`StepToolbar.tsx:112-135`](../frontend/src/components/StepToolbar.tsx#L112-L135)
  fires a parse on every change and calls `onFormulaChange`, and
  [`OperationColumn.tsx:285`](../frontend/src/components/OperationColumn.tsx#L285)
  writes `process_type` and `configuration` from the result. Combined with the
  `isValid: True` bug above, **half-typed garbage is currently written into
  step config.** Typing should change local text only.
- **On Enter:** validate, then commit. Valid → update `formula`,
  `process_type`, `configuration`. Invalid → do not touch config, and surface
  the error (below).
- **Params → formula stays.** `handleUiUpdate` already rebuilds the formula via
  `buildFormula()`; that direction is correct and keeps the formula canonical.
- **Watch the echo.** `externalFormula` pushes text back into the bar
  ([`StepToolbar.tsx:69-83`](../frontend/src/components/StepToolbar.tsx#L69-L83),
  which still carries `console.log` calls from a previous round of loop
  debugging). With commit-on-Enter the rule gets simpler: the side the user
  last edited is never rewritten under the cursor. Those logs should go.

### The invalid-formula error surface

An invalid formula should mark the step's output as an error. `StepStatus`
already has an `error` state and [`StepToolbar.tsx:332`](../frontend/src/components/StepToolbar.tsx#L332)
already maps statuses to labels, so the display exists — what is missing is a
place to put the *message*. Decide where the diagnostic text lives: a
`validation_error` field on the step, or reuse whatever the run error path
uses. Prefer reuse, so one panel shows both kinds of failure.

---

## Item 5 — `app.py`

The goal: one file where the application is declared, FastAPI-style, with the
decorated tools attached explicitly.

Today [`main.py:40-140`](../src/SIMPLE_STEPS/main.py#L40-L140) auto-scans up to
seven locations at import time — workspace `packs/`, `ops/`, top-level `*.py`,
bundled `packs/`, three legacy sibling dirs, `mock_operations/`, plus env
vars. None of the legacy dirs exist any more. That implicit discovery is what
makes the registry unpredictable, and replacing it is most of item 1's
"only my tools" in practice.

### Blocked on core §C

`AppConfig` has 5 of its 14 designed fields. Missing and needed:

- **`cors_origins`** — hard blocker. The Vite dev server on `:5173` cannot
  reach a backend without it.
- **`tool_modules`**, **`resources`** — the substance of the declaration.

Since core is read-only, these get a local `SimpleStepsAppConfig` that carries
the extra fields and hands core's `AppConfig` the subset it understands. Tag it
`SHIM(core §C)` like the others, so it deletes cleanly later.

### Shape

Recommendation: `app.py` is the **declaration** surface; `main.py` stays the
ASGI/router module it already is. `main.py` is ~1000 lines of endpoints — it
should not move, only lose its discovery block. So:

```python
# app.py — what this application is
app = SimpleStepsApp(
    title="Simple Steps",
    cors_origins=["http://localhost:5173"],
    tools=[reshape, clean, sources, file_io],   # the ResourceSpecs of item 1
    tool_modules=["my_project.tools"],
    resources=[...],
)
```

with `main.py` importing the configured app rather than scanning for it.

---

## Notes

- **Phase guardrail.** [`context.md`](context.md) still has
  `Phase: IDEA | SPEC | TESTS | IMPL` as an unedited placeholder, and none of
  the four phases lists `docs/core-proposals/**` or this file as writable.
  Items 1–5 all need IMPL. Worth setting that line.
- **`simple-steps-build` is not a real command.** `README.md:340` says to run
  it; it was never registered in `pyproject.toml`. Use
  `.venv/bin/python -m SIMPLE_STEPS.build_frontend`. One line in
  `[project.scripts]` would fix the docs instead.
