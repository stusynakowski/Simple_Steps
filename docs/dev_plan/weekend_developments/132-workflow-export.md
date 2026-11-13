# 132 — Export a workflow as a Python script

> Status: **proposed**, 2026-11-12, app at `574acec`, core `dbaf4c7`. Every
> "today" below was run, not read. Owner's ask: export a workflow as the
> equivalent Python script, one line per step with the step's name in a
> comment, so it can run wherever the same environment exists (Databricks,
> a job, a notebook), with no UI and no server.

## Summary

**A saved workflow is already a Python script in all but name.** Each step's
`expression` in the `.simple-steps-workflow` file is the exact Python line
core runs: `scale[mod.map(), mod.name("score")](wf["readings"])`. To turn the
file into a script, the export only has to add what a file does not say:

1. **imports**: which module each tool and resource type comes from;
2. **the kernel and the resources**: `wf = Kernel(catalog())`, `wf.define(…)`;
3. **one line per step**: `wf["<name>"] = <expression>  # step: <label>`;
4. **`wf.run_all()`**.

The script is the same shape as the hand-written twin
[`examples/main_pipeline.py`](../../../src/SIMPLE_STEPS/examples/main_pipeline.py),
so the export *writes the twin*. `runme.py` already checks that a twin and its
workflow give the same output, and the same check proves the export (X4).

## Today (run 2026-11-12)

| | Found |
|---|---|
| Export to Python | **None.** The only twin, `main_pipeline.py`, was written by hand. `simple-steps run` serves an App, and does not run a workflow headless |
| Step text | The workflow file stores each step's formula as `expression`, which is valid Python. `meta.label` holds the name shown in the UI |
| Tool → module | Every catalog tool can be traced back to its source: `catalog._tools()` gives core `Tool`s, and `Tool.fn.__module__` is the import path (`scale` → `basic.basic_tools`, `to_rows` → `SIMPLE_STEPS.operations`). A formula uses the tool's **`id`**, which can differ from `fn.__name__`, so the import becomes `from m import fn_name as id` |
| Core's built-ins | `identity` and the other tools without a module are written `identity = op("identity")`, as the twin does. `zip_`, `mod`, `res` and `cols` come from `simple_steps_core` |
| Resources | The `resources` section: `{"source": "defined", "type": T, "settings": {…}}` → `wf.define("db", T, **settings)`; the type's class is in `RESOURCE_TYPES[T]`, and its `__module__` is the import. `"loaded"` resources come from the deployment (`LOADED`, credentials read with `env()`), and are never in the file |
| `res["workspace"]` | A ready-made `Folder` on the launch directory (`file_io.py`). A script run elsewhere needs to be told which folder that is |
| Prototype | A generator of about 40 lines (in a scratchpad, not committed) turned `all-examples` into a script. **The script ran all 10 steps.** `readings` through `summaries` came out equal to the twin's output. The comparison helper used failed on the later steps because of core's reserved `#` columns, not because the output differed. X4 uses `runme.py`'s own check |
| Prototype's flaw | It found tool names with a regex, which also picked up `mod.map`, `mod.filter`, … as tools. The real export takes them from core's parsed formula (X1) |

## Design

### X1 — `export_script(workflow) -> str`

One function, in a new `src/SIMPLE_STEPS/export.py`. It takes a workflow file,
or the session's workflow, and returns the script as text. It writes no file
and runs nothing.

- **Names come from core, not a regex.** Core parses each expression
  (`simple_steps_core.formula`, as the app already does; see the memory
  "core reads it"), and the export collects the tool ids the parsed
  operations name. No parsing rules live in `export.py`.
- **Imports**, grouped by module and sorted: core first, then `SIMPLE_STEPS`,
  then the user's tool modules. A tool whose id differs from its function's
  name is imported with `as`. A tool with no importable module (defined in
  `__main__` or a notebook cell) **fails the export with its name**, rather
  than writing a script that cannot run.
- **Resources**: `defined` → `wf.define(name, Type, **settings)`. `loaded` →
  `wf.define(name, Type, **as_loaded, **overrides)` with a comment
  `# loaded from the deployment: supply credentials here`. Secrets are never
  written, because they are never in the file.
- **Steps**, in order: `wf["<name>"] = <expression>  # step: <label>`. The
  label is left out when it is the same as the name. `meta.notes`, the
  workflow's notes, go in the module docstring.
- **Header**: the source workflow, the date, and the `simple-steps` and
  `simple-steps-core` commits (`simple-steps --version` already prints
  them), so a run elsewhere can be matched to the environment.
- **The end** of the script is `wf.run_all()`, and then a
  `if __name__ == "__main__":` that prints each step's row count. The kernel
  stays as `wf`, so a notebook can read `wf.step("score").output`.

### X2 — `res["workspace"]` in a script

The script starts with `WORKSPACE = os.environ.get("SIMPLE_STEPS_WORKSPACE",
".")` and gives it to the workspace `Folder` before any step runs. On
Databricks, that is a DBFS or Volumes path. This is only written when a step
uses `res["workspace"]`.

### X3 — Where people get it

- **CLI**: `simple-steps export <workflow> [-o script.py]`. It prints to
  stdout when no `-o` is given. This is the path for Databricks and CI.
- **UI**: an **Export as Python** item on the existing workflow toolbar
  popover, next to the notes, which downloads `<workflow-id>.py`. No new
  button on the grid (memory: "plain grid, controls only on popover"). It
  uses Material Symbols `code` as the icon.
- **API**: `GET /api/workflow/{id}/export.py`, which both of the above use.

### X4 — Proof: the export writes the twin

`runme.py` gains one more check for each shipped example: export the
workflow, run the script in a fresh process, and compare every step's output
with the workflow run in the app, using the same comparison as the twin. Once
this passes, `main_pipeline.py` can stop being hand-maintained and be the
checked-in export (decision D2).

## Out of scope

- **Running a workflow file headless without a script**, for example
  `Kernel.from_json(...)`. It is useful, but it is a second way to run a
  workflow, and the ask is a script someone can read and edit. Revisit if
  people ask for it.
- **Import in the other direction**, script → workflow. The agent's
  proposals already write formulas. A script's `wf[...] = ...` lines could be
  read back later, but nothing needs that yet.
- **Packaging the user's tools.** The script imports them, and they have to
  be installed where it runs (`pip install` of the user's package, or the
  files on `sys.path`). The usage docs say so (X5).

## X5 — Usage doc

A short page in `docs/usage_docs/user/`: export, then on Databricks
`%pip install "git+https://github.com/stusynakowski/Simple_Steps.git@<commit>"`
plus the tool package, then set `SIMPLE_STEPS_WORKSPACE`, then run the script.
It pins the commit the header records.

## Order

X1 → X4 (the proof on the shipped examples) → X3 CLI → X3 API and UI → X2 →
X5. The spec (`docs/spec/`) gets `REQ-EXPORT-*` IDs for X1–X4 before the
tests.

## Decisions for the owner

- **D1**: should a `loaded` resource be exported with its `as_loaded`
  settings (as proposed), or as a stub the user must fill in?
- **D2**: once X4 passes, should `main_pipeline.py` be replaced by the
  generated export, so there is one twin and not a hand copy?
- **D3**: should the script end with `wf.run_all()`, as proposed, or define
  `build() -> Kernel` like the twin does, so importing it runs nothing?
