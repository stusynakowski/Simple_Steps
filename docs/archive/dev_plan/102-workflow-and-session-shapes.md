# 102 — Workflow & Session Shapes

The on-disk and in-memory shapes that drive the system. Designed so that
**the expression string is the only canonical execution artifact**;
everything else is metadata or cached output.

## Workflow file (on disk)

```jsonc
{
  "format_version": 2,
  "name": "youtube-analysis",

  // Optional, free-form. The runner ignores this entirely; it exists
  // for the UI to group / annotate / categorise. Keep it small.
  "meta": {
    "notes": "End-to-end channel sentiment pipeline.",
    "stages": [
      { "id": "ingest",  "label": "Ingest" },
      { "id": "analyze", "label": "Analyze" }
    ]
  },

  "steps": [
    {
      "name": "videos",
      "expression": "fetch_videos(channel=\"@xyz\", limit=50)",
      "meta": { "label": "Fetch Videos", "stage": "ingest" }
    },
    {
      "name": "metadata",
      "expression": "extract_metadata(url=videos[\"video_url\"])",
      "meta": { "label": "Extract Metadata", "stage": "ingest" }
    },
    {
      "name": "filtered",
      "expression": "filter_rows(data=metadata, column=\"views\", min_value=1000)",
      "meta": { "label": "Filter by Views", "stage": "analyze" }
    }
  ]
}
```

### The runnable core

Everything outside `steps[*].name` and `steps[*].expression` is metadata
the runner ignores. The minimal execution loop is literally:

```python
outputs = {}
for step in workflow["steps"]:
    outputs[step["name"]] = run_formula(step["expression"], steps=outputs)
```

That's the contract. Any tool that produces or consumes a workflow file
must keep that loop runnable.

### Rules for the core fields

- **No `=` sign** on stored expressions. The leading `=` is a formula-bar
  UI affordance only (see `104-equals-sign-convention.md`).
- **No `operation_id` / `configuration` fields.** Those are derived from
  the expression at read time via `describe(expression)`.
- **`name` is the only identifier.** It's what later expressions reference
  and what appears in the UI by default. There is no separate stable `id`
  in the file. Renaming a step is an AST rewrite of every later expression
  (see below).
- **Names must be unique** within a workflow and must be valid Python
  identifiers (since they appear bare in expressions).
- **Order matters.** A step may only reference steps that come before it.
  Validation enforces this.
- **`name` is optional in source files.** A loader that encounters a step
  with no `name` assigns the positional alias `step1`, `step2`, … in
  order. Once loaded into a session the name is fixed for the session's
  lifetime.

### The `meta` namespace

`meta` (both at the workflow level and per-step) is the **only** place new
user-facing or UI-facing fields are allowed to live. The runner never
reads it. Today's contents:

| Path                       | Meaning                                                            |
|----------------------------|--------------------------------------------------------------------|
| `meta.notes`               | Free-form text. Editor can render as a banner.                     |
| `meta.stages[]`            | Logical UI groupings. Each is `{ id, label }`.                      |
| `step.meta.label`          | Display name for the step (separate from the runtime `name`).      |
| `step.meta.stage`          | Which stage (`meta.stages[].id`) this step belongs to.             |
| `step.meta.legacy_step_id` | Old v1 `step_id` carried forward by the migrator, for grep-ability.|
| `meta.legacy_id`           | Old v1 workflow `id`, same reason.                                  |

New fields can be added under `meta.*` without bumping `format_version`.
The day we want one of them to affect execution, it leaves `meta` and
becomes a top-level field — and then we bump.

## Session (in memory)

A session is a workflow plus the cached outputs that have been computed.

```python
class Session:
    workflow: Workflow                       # the steps + expressions
    outputs: dict[str, pd.DataFrame]         # step_name → materialised output
    dirty: set[str]                          # step names that need re-running
    session_id: str                          # for parquet cache namespacing
    uids: dict[str, str]                     # step_name → uid, only for steps that opted in
```

Outputs are keyed by `name` so the interpreter's env dict literally maps
`step1 → df`. When a step is renamed, the session re-keys.

### Runtime `uid`s — opt-in, internal only

By default, **a step has no `uid`**. Identity is the `name`, period.

When the user opts a step into stable identity (a checkbox in the step
inspector, or programmatically via `session.pin(step_name)`), the session
mints a short `uid` for it — `uuid4().hex[:8]` — and tracks it for the
lifetime of the session. Use cases that *might* want a uid:

- undo history that survives a rename
- parquet cache filenames the user wants to keep across renames
- log lines the user wants to grep for after renaming

When opted in, a `uid`:

- is **not** stored in the workflow file (still derived per session),
- is **never** referenced in expressions or shown anywhere the user
  edits — it's a debug/diagnostic handle,
- survives renames within a single session,
- is re-minted on the next load.

The default — no uid — keeps the user-visible surface to a single
identifier (`name`). We add uid only when something concrete needs it.

### Renaming a step

`rename_step(workflow, old_name, new_name)`:

1. Verify `new_name` is a valid identifier, is not already in use, and
   does not collide with any registered operation id.
2. Update `step.name` for the renamed step.
3. For every step that comes after it, walk the AST of its `expression`
   and rewrite every `Name("old_name")` node to `Name("new_name")`. Emit
   the modified expression back to text.
4. In the live session, re-key `outputs[old_name]` → `outputs[new_name]`
   and update `uids` similarly. `uid`s themselves don't change.

The rewrite is **deterministic and lossless** because it operates on the
AST, not on raw text. A column reference `step1["col"]` keeps its column
exactly, and a substring like `step10` cannot be accidentally matched by
a rename of `step1`.

## Runner contract

```python
def run_step(session: Session, step_name: str) -> pd.DataFrame:
    step = session.workflow.get(step_name)

    available = {s.name for s in session.workflow.steps_before(step_name)
                 if s.name in session.outputs}

    errs = validate(step.expression, available_steps=available)
    if errs:
        raise FormulaError(...)

    steps_env = {name: session.outputs[name] for name in available}
    result = run_formula(step.expression, steps=steps_env)

    df = _normalize(result)         # StepProxy/DataFrame/scalar → DataFrame
    session.outputs[step.name] = df
    session.dirty.discard(step.name)
    return df
```

A full-workflow run is just `run_step` in order, halting at the first
failure.

## Re-run / staleness

When a step's expression changes:

1. Mark that step's name dirty.
2. Walk forward through the workflow; any step whose expression refers to
   a dirty step's name (computed from its AST) is also dirty.
3. Discard cached outputs for all dirty steps.

The forward-walk uses `describe(expression).step_refs`, which already
extracts every `stepN["col"]` and `stepN.col` reference.

## Versioning

We're early. The workflow shape above is the only shape — no
`operation_id` + `configuration` legacy fields, no migration path. If
the file format needs to change again before the first real release,
we'll bump `format_version` and rewrite the few existing workflows by
hand. The writer/reader stays single-shape.

The v1 → v2 migration that produced the current mock workflows lives in
`scripts/migrate_workflows.py`. It's a one-shot tool, idempotent (skips
files already at `format_version: 2`), and is safe to delete once we're
confident nothing else needs it. Keep it around at least until we have
a Python session loader on top of the v2 format.
