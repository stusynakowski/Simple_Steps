# 120 — Literals and references

> Status: proposed, 2026-10-05. Core pinned at `d8b6979`. Every core
> behaviour quoted here was run against that commit, not read from its docs.

## The rule

> **A reference is `wf["<step id>"]`. Everything else is a literal.**

A string is a string, even when its text happens to be a step id or a column
name. A step reads another step only through `wf["…"]`, and only in one place:
the positional argument of the call.

The canonical way to write a step is core's own operation syntax:

```
=tool[mod.verb(settings), mod.retry(…), …](wf["input step"], argument=literal, …)
 └┬─┘ └──────────────┬──────────────────┘ └──────┬───────┘ └────────┬────────┘
 tool        modifier stack                 the reference      bound literals
          (shape verb + execution)            (the input)      (tool arguments)
```

A formula written this way is valid Python against core, given the tools and
`mod` in scope. Built-in names (`identity`, `count`, `gather`, `total`,
`first`, `last`) are core's `op("…")` handles, so a Python session defines
them once: `identity = op("identity")`.

---

## 1. Why this is needed

Today `readings`, `"readings"` and `wf["readings"]` can all mean "the step
`readings`", and a string literal can be silently turned into a reference.
The ambiguity is in **this app**, not in core:

| | Core | The app today |
|---|---|---|
| `wf["readings"]` | a `StepRef`, a reference | not part of the formula language |
| a bare name, `readings` | not valid Python | a reference (`step1`, `readings`) |
| a string, `"readings"` | a literal | **a reference**, if a step has that name |
| a tool argument `city="readings"` | the literal `"readings"` | **a reference**: `=format_string(cell="readings")` ran as a map over the step `readings` |
| a reference as a tool argument | refused: *"cannot bind 'weight' to a step reference: a bound literal is a constant"* | accepted, resolved to the step's value |
| a column, `readings["n"]` | not supported: *"'StepRef' object is not subscriptable"* | a column reference |

There are three causes, all in this repo:

1. **The parser turns references into text.** `=map(tool="label_city",
   over=readings)` and `over="readings"` both parse to `{"over": "readings"}`,
   so nothing downstream can tell a reference from a literal.
2. **The grid adapter guesses.** `grid_runner._step_ref` treats any string that
   matches a step name as a reference. `_bind_previous_step` treats a string
   that matches a column name (`url="url"`) as a column binding.
3. **The UI rebuilds formulas from those flattened arguments.** That's why a
   reopened demo step reads `over="readings"`.

The demo workflow (`examples/all_orchestrations`) is written in the
ambiguous forms. **None of its 38 steps uses the canonical
`tool[modifiers](source, arguments)` form:**

| Steps | Form used |
|---|---|
| 17 | verb operation with `tool=`: `=map(tool="scale", over=readings, name="score")` |
| 12 | tool-less verb operation: `=select(over=scored, columns=[…])` |
| 5 | source tool with literals: `=to_rows(data='…')`, `=literal(expr="…")` |
| 4 | inferred call with column binding: `=scale(n=readings["n"])` |

They match core's output (38/38), but they test the adapter's translation
rather than core's syntax.

---

## 2. The formula language

### 2.1 References

| Write | Meaning |
|---|---|
| `wf["readings"]` | the step `readings`, as a step's input |

That is the only reference form. Each of these is **rejected**, with the
message in §4:

| Rejected | Because |
|---|---|
| `readings` (a bare name) | it looks like a variable, and isn't one |
| `"readings"` used as an input | a string is a literal |
| `step1`, `step2`, … | positional aliases change meaning when steps are reordered |
| `=Step 1!col` (Excel-style) | a second reference syntax |
| `wf["readings"]["n"]` | core has no column references (§2.4) |
| `over=wf["readings"]` inside the brackets | the input is written once, in the call (§2.3) |

A step id is the step's name: `wf["readings"]` names the step `readings`.
Renaming a step rewrites every `wf["old"]` that refers to it (core's
`Workflow.rename` already does this for `over`).

### 2.2 Literals

Any Python literal: strings, numbers, `True`/`False`/`None`, lists, dicts and
tuples. A literal never refers to anything. In particular:

- `name="score"`, `by="bucket"` and `columns=["city", "score"]` are literals
  that **name columns**; they aren't references to them.
- A string equal to a step id is just that string:
  `=grid_cell[mod.sweep(model=["readings"], window=[7])]` produces
  `readings:7`, even with a step named `readings` in the workflow.
- A whole formula can be a literal: `=[1, 2, 3, 4]`, `={"x": 10}` and `=7` are
  source steps holding one cell, exactly as core's `wf["a_list"] = [1, 2, 3, 4]`
  is.

### 2.3 Operations

| Kind | Canonical formula | Core operation JSON (from running core) |
|---|---|---|
| tool + verb | `=scale[mod.map(name="score")](wf["readings"], weight=2)` | `{"tool_id": "scale", "arguments": {"weight": 2}, "modifiers": [{"kind": "map", "params": {"name": "score", "over": "readings"}}]}` |
| reducer | `=add_n[mod.collapse(by="bucket", initial=0)](wf["bucketed"])` | `{"tool_id": "add_n", …, "modifiers": [{"kind": "collapse", "params": {"by": "bucket", "initial": 0, "over": "bucketed"}}]}` |
| builtin reducer | `=count[mod.collapse()](wf["readings"])` | `{"tool_id": "count", …, "modifiers": [{"kind": "collapse", "params": {"over": "readings"}}]}` |
| execution modifiers | `=scale[mod.map(), mod.retry(times=2), mod.timeout(seconds=5)](wf["readings"])` | `"modifiers": [{"kind": "timeout", …}, {"kind": "retry", …}, {"kind": "map", "params": {"over": "readings"}}]` |
| tool-less verb | `=identity[mod.select(columns=["city", "score"])](wf["scored"])` | `{"tool_id": "identity", …, "modifiers": [{"kind": "select", "params": {"columns": ["city", "score"], "over": "scored"}}]}` |
| source | `=load_csv[mod.source()](path="x.csv")` | `{"tool_id": "load_csv", "arguments": {"path": "x.csv"}, "modifiers": [{"kind": "source", "params": {}}]}` |
| sweep | `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` | `{"tool_id": "grid_cell", …, "modifiers": [{"kind": "sweep", "params": {"model": ["a", "b"], "window": [7, 30]}}]}` |
| inferred verb (shorthand) | `=scale(wf["readings"], weight=2)` | `{"tool_id": "scale", "arguments": {"weight": 2}, "modifiers": [{"kind": "map", "params": {"over": "readings"}}]}` |

The parts:

- **Brackets hold the modifier stack.** The shape verb (`map`, `filter`,
  `group`, `expand`, `collapse`, `sweep`, `source`, `select`, `drop`,
  `rename`, `widen`, `slice`, `sort`, `distinct`) goes first; `retry` and
  `timeout` follow. Settings inside them are literals.
- **The call's positional argument is the input.** It must be a `wf["…"]`
  reference. It's required whenever the shape verb reads a step, which is every
  verb except `source` and `sweep`.
- **Keyword arguments in the call are tool arguments.** They're bound
  literals, the same as `tool.bind(…)` in core.
- **`source` and `sweep` take no input.** Write them without a positional
  argument; the call is optional and holds only keyword arguments.
- **Tool-less verbs name `identity`.** That's the tool core runs for them.
- **The inferred form `tool(wf["…"], …)` is allowed.** Core picks the verb
  from the tool (`-> bool` filters, `-> list` expands, `(acc, x)` collapses,
  otherwise map). The UI shows which verb was inferred.
- **`mod.` is written out,** so a formula is valid Python against core:
  `from simple_steps_core.grid import mod`.
- **Built-ins are written by name** (`identity[…]`, `count[…]`). The formula
  language resolves them to core's `op("identity")`, `op("count")`, ….

### 2.4 Columns

Core binds a tool's parameters to the input's columns **by name**; the column
name is the contract (core `docs/writing-tools.md`). There are no column
references. When a parameter and a column have different names, add a rename
step:

```
=identity[mod.rename(columns={"video_url": "url"})](wf["videos"])
=fetch_meta[mod.map()](wf["renamed"])
```

`wf["videos"]["video_url"]` is rejected. Today `grid_runner` hides a rename
inside the step instead (`p=step1["col"]`); that goes away with this change.

### 2.5 A value from another step

Not expressible until core lands P5 (core 004 §B6). Core refuses a reference
as a tool argument, and so does the formula. Steps that do this today run
through the `SHIM(core §L)` legacy path; under this syntax they're errors with
the message in §4, until P5.

---

## 3. How a reference travels

A reference keeps its type at every stage, so no stage has to guess.

| Stage | A reference | A literal |
|---|---|---|
| formula text | `wf["readings"]` | `"readings"` |
| parser output (`/api/parse_formula`) | `{"$ref": "readings"}` | `"readings"` |
| step configuration (UI state) | `{"$ref": "readings"}` | `"readings"` |
| saved file (`expression`) | the formula text | the formula text |
| core operation JSON | `"over": "readings"` (typed `reference` by `modifier_catalog()`) | `"arguments": {…: "readings"}` |

The saved file stores the formula text, which is already unambiguous. Nothing
needs to reconstruct a formula from flattened arguments, so the reopen bug in
§1 can't come back.

---

## 4. Errors

The messages to implement. None of these exist yet; today most of these
inputs are silently reinterpreted (§1).

| Input | Message |
|---|---|
| `=scale[mod.map()](readings)` | `readings is not defined. To use the step "readings", write wf["readings"].` |
| `=scale[mod.map()]("readings")` | `the input must be a step reference; "readings" is a string. Did you mean wf["readings"]?` |
| `=scale[mod.map()](wf["nowhere"])` | `no earlier step is named "nowhere"` |
| `=scale[mod.map(over=wf["a"])](wf["b"])` | `write the input once, in the call: scale[mod.map()](wf["b"])` |
| `=scale[mod.map()](wf["a"], weight=wf["b"])` | `weight is a tool argument and takes a literal; a value from another step isn't supported yet (core P5)` |
| `=scale[mod.map()](wf["a"]["n"])` | `there are no column references; the tool's parameters bind to columns by name. Rename the column first.` |
| `=scale[mod.map()]` (missing input) | `map reads a step: scale[mod.map()](wf["…"])` |
| `=step1`, `=Step 1!col` | `step1 is not defined …` / `the =Step!col form is retired; write wf["…"]` |

A "did you mean" suggestion is offered only when the text exactly matches an
existing step id. It is never applied automatically.

---

## 5. Requirements

| ID | Requirement |
|---|---|
| REQ-REF-001 | A step reference is written `wf["<step id>"]`; no other form refers to a step. |
| REQ-REF-002 | A string literal is a literal everywhere, including when it equals a step id or a column name. |
| REQ-REF-003 | A step's input is the positional argument of the call; `over=` is not written in a formula. |
| REQ-REF-004 | Keyword arguments of the call are bound literals; a reference there is an error until core P5. |
| REQ-REF-005 | Modifier settings (`name`, `by`, `columns`, `initial`, …) are literals. |
| REQ-REF-006 | There are no column references; parameters bind to columns by name. |
| REQ-REF-007 | The parser emits references as typed values (`{"$ref": …}`), never as plain strings. |
| REQ-REF-008 | `grid_runner` resolves only typed references; it never matches strings against step or column names. |
| REQ-REF-009 | A formula in canonical form compiles to the operation JSON core produces for the same Python. |
| REQ-REF-010 | Each rejected form in §2.1 fails with the message in §4, and is never silently reinterpreted. |
| REQ-REF-011 | Reopening a saved workflow shows each formula exactly as saved. |
| REQ-REF-012 | Renaming a step rewrites every `wf["old"]` that refers to it. |

## 6. Tests

Each test is one formula, the operation JSON it must compile to (REQ-REF-009),
and the result on the demo data.

| ID | Formula | Covers |
|---|---|---|
| TEST-REF-001 | `=scale[mod.map(name="score")](wf["readings"])` | REQ-REF-001, 003, 009 |
| TEST-REF-002 | `=scale[mod.map()](wf["readings"], weight=2)` | REQ-REF-004 |
| TEST-REF-003 | `=grid_cell[mod.sweep(model=["readings"], window=[7])]` with a step named `readings` gives `readings:7` | REQ-REF-002 |
| TEST-REF-004 | every shape verb in canonical form: the 14 verbs, with demo-data results equal to core's | REQ-REF-009 |
| TEST-REF-005 | `retry` and `timeout` stacked after `map` | REQ-REF-009 |
| TEST-REF-006 | `=count[mod.collapse()]`, `=gather/total/first/last[mod.collapse()]` | REQ-REF-009 |
| TEST-REF-007 | `=to_rows[mod.source()](data='…')` and `=grid_cell[mod.sweep(…)]`, no input | REQ-REF-003 |
| TEST-REF-008 | `=[1, 2, 3, 4]`, `={"x": 10}`, `=7` as one-cell sources | REQ-REF-002 |
| TEST-REF-009 | the inferred shorthand for map, filter, expand and collapse | REQ-REF-009 |
| TEST-REF-010 | each rejected form in §2.1 gives its §4 message | REQ-REF-010 |
| TEST-REF-011 | `/api/parse_formula` returns `{"$ref": …}` for `wf[…]` and a plain string for `"…"` | REQ-REF-007 |
| TEST-REF-012 | `grid_runner` with a config whose string equals a step id treats it as a literal | REQ-REF-008 |
| TEST-REF-013 | save then reopen: the formula text is unchanged | REQ-REF-011 |
| TEST-REF-014 | rename a step, and every `wf["old"]` becomes `wf["new"]` | REQ-REF-012 |

TEST-REF-004 to 009 are the demo workflow rewritten (Appendix A).
`examples/all_orchestrations/check.py` already compares every step with core,
so rewriting the workflow file in canonical form makes it the coverage for
those tests.

---

## 7. What changes where

| Where | Change |
|---|---|
| `formula_parser.py`, `safe_formula.py` | Parse `tool[modifiers](input, **arguments)`. Emit `{"$ref": id}` for `wf["id"]`. Reject bare names, `stepN`, `=Step!col` and column subscripts. |
| `grid_runner.py` | Build the operation from the parsed form (tool, modifier stack, input reference, literals). Delete `_step_ref`'s string matching, the Excel regex, `_bind_previous_step`, and the hidden column rename. |
| `models.py` (`StepConfig`) | `config` carries typed references. `meta.settings` (`_orchestrator`, `_name`, …) stops being needed: the verb and its settings are in the formula. |
| frontend: `PreviousStepDataPicker`, data-grid clicks | Insert `wf["id"]`, not `step1.col` or `step1[row=…]`. |
| frontend: `hydrateStep`, `buildFormula` | Show the saved formula text as-is; never rebuild it from arguments. |
| frontend: Orchestration dropdown | Edits the bracketed stack of the formula, rather than a separate `_orchestrator` key. |
| `examples/all_orchestrations` | The workflow rewritten in canonical form (Appendix A). `check.py` unchanged. |
| saved workflows | A one-off migration rewrites `stepN` → `wf["<that step's id>"]`, `=Step!col` and column refs → a rename step plus `wf[…]`, and `over=x` → the call input. It prints each change and fails on anything it can't rewrite unambiguously. |

## 8. Asks for core

> **Consolidated:** every open core ask now lives in [`docs/core-proposals/005-core-changes.md`](../core-proposals/005-core-changes.md), with new IDs (K1–K18) and a script that checks each one. The table below is kept for its context.

Running core turned up four places where its own call form is ambiguous or
incomplete. None block the app, which compiles formulas to operation JSON
rather than calling the Python API, but each is worth raising:

| # | Found | Ask |
|---|---|---|
| C1 | `scale[mod.map(over=wf["a"])](wf["b"])` silently uses `b`. | Raise when `over` is given in both places. |
| C2 | In Python, `mod.map(over="readings")` takes a string as a reference, while `scale[mod.map()]("readings")` treats the same string as a literal value. | Accept only a `StepRef` for `over` in the Python API, and keep string ids for `from_dict` JSON. |
| C3 | `load[mod.source()](path="x.csv")` raises *"missing 1 required positional argument: 'source'"*, and `load[mod.source()](None, path=…)` runs the tool immediately and stores inline data, not a re-runnable step. | Let `tool[mod.source()](**arguments)` and `tool[mod.sweep(…)]()` declare a step with no input. |
| C4 | `mod.select(columns=["n"])(wf["readings"])` raises *"'Modifier' object is not callable"*; it works only as `op("identity")[mod.select(…)](…)`. | Make a tool-less modifier callable on a reference, or document `identity[…]` as the spelling. |
| C5 | A step reading a tool-backed source that hasn't run is checked against an input with no known columns: `mod.select(over=wf["scored"], columns=["city", "score"])` is declared **invalid** (*"select names 'city', which the input does not have (it has score)"*), and `run_all` never re-checks it, so it returns `{'value': [None]}` after the source has run. Declaring it after running the source gives the right answer. | Treat an unrun source's columns as unknown (unchecked) rather than empty, and re-check staged steps once their input has run. Close to core's D2 (source schemas). |
| C6 | Verb inference depends on run state: `add_n(wf["readings"])` is declared as `collapse` when `readings` holds data, and as `map` when `readings` is a tool-backed source that hasn't run. | Infer from the tool's signature alone, or refuse to infer until the input is known. The same text must not mean two different operations. |

C5 and C6 don't affect the app today: `grid_runner` runs one step at a
time, with its input already computed. They will matter once the app holds a
whole `grid.Workflow` per session (dev plan 119, next step 4).

## 9. Decisions to confirm

1. **Positional aliases (`step1`, `step2`).** Retire them (recommended; they
   break when steps move), or keep them as typed aliases of `wf["…"]`.
2. **`mod.` prefix.** Write it (recommended; formulas paste into Python), or
   allow bare `[map(…)]` and add the prefix on export.
3. **Column binding under another name.** A rename step (recommended; it's
   core's contract), or app-only sugar for `wf["x"]["col"]` that compiles to
   rename + map.
4. **Tool-less verbs.** `identity[mod.select(…)](wf["x"])` (core's real
   spelling), or a shorthand `mod.select(…)(wf["x"])` once C4 lands.

---

## Appendix A — the demo workflow in canonical form

The same 38 steps, one formula each. Every input is a `wf["…"]` reference,
and every string is a literal.

**Checked against core** by evaluating each formula as Python, with the
example's tools, `mod`, and the built-ins as `op("…")` in scope:

- 19 run exactly as written; 17 need a built-in name (`identity`, `count`,
  …) bound to `op("…")`.
- The 2 sources (`readings`, `records`) need core's current spelling,
  `to_rows.bind(data=…)[mod.source()]`, until C3 lands.
- With those, 33 of the 37 that core's example also has give core's output
  exactly, and `failure` records its 2 failed rows. The other 4 (`picked`,
  `unique_city`, `renamed`, `auto_collapse`) are C5 and C6: they read a
  tool-backed source that hadn't run when they were declared. They're correct
  when the source holds data at declaration, as in core's own example.

| Step | Formula |
|---|---|
| readings | `=to_rows[mod.source()](data='{"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]}')` |
| records | `=to_rows[mod.source()](data='{"value": [{"city": "SF", "temp": 18.0}, {"city": "NYC", "temp": 31.0}]}')` |
| scored | `=scale[mod.map(name="score")](wf["readings"])` |
| kept | `=is_big[mod.filter()](wf["scored"])` |
| head2 | `=identity[mod.slice(stop=2)](wf["scored"])` |
| ranked | `=identity[mod.sort(by="score", ascending=False)](wf["scored"])` |
| unique_city | `=identity[mod.distinct(columns=["city"])](wf["scored"])` |
| picked | `=identity[mod.select(columns=["city", "score"])](wf["scored"])` |
| dropped | `=identity[mod.drop(columns=["score"])](wf["scored"])` |
| renamed | `=identity[mod.rename(columns={"n": "count"})](wf["scored"])` |
| bucketed | `=label_city[mod.group(name="bucket")](wf["scored"])` |
| per_city | `=add_n[mod.collapse(by="bucket", initial=0)](wf["bucketed"])` |
| n_rows | `=count[mod.collapse()](wf["readings"])` |
| sum_n | `=add_n[mod.collapse(initial=0)](wf["readings"])` |
| bursts | `=fan_out[mod.expand(name="item")](wf["readings"])` |
| coords | `=make_coords[mod.expand()](wf["readings"])` |
| spread | `=identity[mod.widen(columns=["axis", "val"])](wf["coords"])` |
| wide | `=identity[mod.widen(columns=["city", "temp"])](wf["records"])` |
| grid_search | `=grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]` |
| robust | `=scale[mod.map(name="score"), mod.retry(times=2), mod.timeout(seconds=5)](wf["readings"])` |
| auto_map | `=scale(wf["readings"])` |
| auto_filter | `=is_big(wf["readings"])` |
| auto_collapse | `=add_n(wf["readings"])` |
| auto_expand | `=fan_out(wf["readings"])` |
| a_list | `=[1, 2, 3, 4]` |
| a_dict | `={"x": 10, "y": 20}` |
| a_scalar | `=7` |
| from_list | `=identity[mod.expand()](wf["a_list"])` |
| from_dict | `=identity[mod.widen(columns=["x", "y"])](wf["a_dict"])` |
| pairs | `=make_pair[mod.map()](wf["readings"])` |
| split | `=identity[mod.widen()](wf["pairs"])` |
| ns | `=identity[mod.select(columns=["n"])](wf["readings"])` |
| gathered | `=gather[mod.collapse()](wf["ns"])` |
| total_n | `=total[mod.collapse()](wf["ns"])` |
| first_n | `=first[mod.collapse()](wf["ns"])` |
| last_n | `=last[mod.collapse()](wf["ns"])` |
| again | `=scale[mod.map(name="again")](wf["scored"])` |
| failure | `=risky[mod.map(name="out"), mod.retry(times=1)](wf["readings"])` |
