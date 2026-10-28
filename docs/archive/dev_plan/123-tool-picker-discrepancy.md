# 123 — The two tool pickers disagree

> Status: **note, not yet acted on** (2026-10-20). Recorded while doing UI
> cleanup; the fix touches the formula bar, which is near the step-referencing
> work in progress, so it is left for that work to pick up.

A step's tool can be chosen in two places, and they behave differently:

| | **Formula bar autocomplete** (`StepToolbar`) | **Formula panel → Tool** (`ToolEditor`) |
|---|---|---|
| Opens when | you type `=` and part of a name | you open the *Formula* panel (`fx`) |
| Lists | **every** operation, including the 13 shape verbs and 4 orchestrators | tools only (`type` not `verb` / `orchestrator`) |
| Shows | the id, a `.type` badge, the label underneath | the label, grouped by category |
| Matches | prefix of id or label | (a native `<select>`; no search) |
| Writes | `=<id>.<type>(` — built in the component | core syntax, built by the backend from parts (`formatFormula`) |
| Wires the input | no | yes — the previous step, `wf["…"]`, unless the tool is a source |

## Evidence

Run against a test server with the built-in tools (42 operations: 19
`dataframe`, 13 `verb`, 4 `source`, 4 `orchestrator`, 2 `map`), through
`POST /api/parse_formula`:

| formula | what writes it | result |
|---|---|---|
| `=load_csv.source(path="a.csv")` | autocomplete, source tool | valid |
| `=extract_json.map(wf["a"])` | autocomplete, map tool | **invalid** — `extract_json.map is not a tool` |
| `=flatten_json.dataframe(wf["a"])` | autocomplete, dataframe tool | **invalid** — `flatten_json.dataframe is not a tool` |
| `=select.verb(` / `=ss_map.orchestrator(` | autocomplete, verb / orchestrator | **invalid** — and these aren't tools at all |
| `=extract_json[mod.map()](wf["a"])` | the Formula panel | valid |

So the autocomplete only produces a formula that parses for **source** tools;
for the other 21 tools, and for every verb and orchestrator it offers, the
formula it starts is rejected. The dotted `tool.type(…)` form is the pre-core
syntax (docs/dev_plan/101, 120); the documented form is
`tool[mod.verb(…)](wf["step"], arg=…)`.

## Suggestions

In rough order of value for effort:

1. **One writer.** Make the autocomplete insert through the same path the
   panel uses — `formatFormula(partsForTool(id, type, previousStep))` — so a
   tool chosen anywhere yields the same, valid, core-syntax formula with the
   same default input wiring. This alone fixes every invalid case above.
2. **One list.** Extract a shared `toolCatalog(availableOperations)` (tools
   only, sorted, grouped by category, label + id) and use it in both places.
   Shape verbs and orchestrators are *modifiers*, not tools: if the
   autocomplete should offer them, offer them in their own group that inserts
   into the modifier slot (`tool[mod.<verb>()]`), not as a tool name.
3. **One look.** Show the same thing in both: label first, id second, the
   category as the group. Today the same tool appears as `extract_json .map`
   in one and *Extract JSON* in the other.
4. **Searchable panel picker.** Replace the panel's native `<select>` with a
   searchable list (`cmdk` is already a dependency, used by the command
   palette), so the two pickers also feel alike as the tool list grows.

Item 1's default input wiring (`wf["<previous step>"]`) is where this meets the
step-referencing work; whatever that work settles as "the default input of a
new step" should be the one rule both pickers follow.
