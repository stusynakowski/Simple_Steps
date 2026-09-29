# simple-steps-core — what changed, and what it means here

> Reviewed against submodule commit `52092ba` (2026-09-29).
> Companion to `external/simple-steps-core/docs/`, which is the authority;
> this document records only what the changes mean for **this** repo.

Core landed a substantial redesign. Most of it is design documents rather than
running code, but one prototype is real and it changes the migration plan.

---

## 1. The thing to know before anything else

**Two models now live in the package, and three names mean different things in
each.** Core's own `__init__.py` says so:

```python
from simple_steps_core import grid        # ✓ the grid model (the target)
wf = grid.Workflow()

from simple_steps_core import Workflow    # ✗ this is the ENGINE's Workflow
```

`Workflow`, `Operation` and `Step` exist in both and are not the same objects.
Always import the module, never the bare names — the convention survives the
eventual merge, when `grid.Workflow` and `Workflow` become the same thing.

---

## 2. Core has built the grammar we specified

This is the headline. The `tool[modifiers](args)` syntax we settled on is
implemented in `grid.py`. All of these were run against `52092ba` and work:

```python
score(wf["raw"])                              # verb inferred from the signature
score(wf["raw"], weight=2)                    # bound literal
score[mod.map()](wf["raw"])                   # verb stated explicitly
score[mod.map(), mod.retry(times=2)](...)     # a modifier stack
keep_odd[mod.filter()](wf["raw"])             # filter
total(wf["raw"])                              # inferred collapse (acc is not a column)
```

Square brackets carry modifiers, round brackets carry the call, `wf["Step1"]`
is the reference. Omitting the modifier infers the verb from the signature —
which is the "auto modifier" idea, and core settled it the right way: it is a
**resolver, not a modifier**. The verb is resolved once at wiring and stored
concretely, so nothing named `auto` ever reaches stored data and an inferred
verb can never silently overwrite one a user chose.

`examples/example_server/core_grid_demo.py` in this repo runs all six forms.

### One gap

```python
score[mod.map()](wf["raw"], weight=2)
# TypeError: Operation.__call__() got an unexpected keyword argument 'weight'
```

Binding a literal **through** a modifier stack fails. Binding one without a
modifier works. Small, but it is the natural form and users will hit it.

---

## 3. What is actually built

Status matters here more than usual — most of this is specification.

| Document | Lines | Status, in its own words |
|---|---|---|
| `grid-model.md` | 458 | "a working prototype, **standalone**" — `grid.py`, real, runs |
| `shape-algebra.md` | 884 | "agreed design; partly built in the prototype, **not in the engine**" |
| `writing-tools.md` | 348 | examples were run; documents the prototype |
| `react-api.md` | 419 | "a **proposed** contract for the target model" — no server implements it |
| `app-config.md` | 173 | "settled design, **not yet built**" |

`shape-algebra.md` §10 sequences the migration in seven steps. Step 2 (the
prototype) is done. **Steps 3 through 7 have not started**, and step 3 is where
the engine begins to move.

---

## 4. This invalidates our migration plan

The A2 rewire was scoped to port `src/SIMPLE_STEPS` onto core's **engine** —
`CoreEngine`, `ToolRegistry`, `SessionContext`. That mapping was accurate and
is now the wrong target: the engine is the model core is migrating away from.

**Do not port onto `CoreEngine`.** The shapes to target are the grid model's
`data` / `ledger` / `meta`.

What stays true from that analysis: roughly 41% of `src/` is replaceable, the
`operation_type` conflation still has to be untangled first, and `decorators.py`
is still ~240 lines of broadcast machinery that exists only because there is no
orchestration layer.

---

## 5. What it settles for us

Questions we were carrying, now answered by core:

| Our question | Core's answer |
|---|---|
| Reactive or manual? | **Declaring is not running.** `POST /steps` returns shape, cell count and problems having executed nothing |
| Linear or DAG? | `over` is a graph edge; the DAG is derived. **No `/dag` endpoint** |
| "Workflow" means three things | **light export** = the recipe; **full export** = recipe + payloads. Measured in our demo: 1,155 B vs 4,988 B |
| Orchestration is secondary | `GET /modifiers` splits `cls: "shape"` from `cls: "execution"` — the UI renders them in different places |
| Stages | Dissolved into the modifier stack. `StepExecutionConfig`, `StageExecutionConfig` and `WorkflowExecutionConfig` are **retired** |
| System configuration | One `AppConfig`, process-level facts only, `SSC_`-prefixed env. Explicitly designed for "a parent repo embedding this as a submodule" — us |

`app-config.md` §1 makes one call worth internalising: it holds **ceilings, not
defaults**. `max_concurrency` clamps a step and says so; it never supplies a
value a step did not ask for. That is what stops the config cascade from being
rebuilt.

---

## 6. What will surprise the frontend

**`useStagedPreview.ts` (243 lines) becomes obsolete.** The server returns
`expected`, `rows_rule` and `describe` at declare time — and it is honest in a
way our client-side guess is not: `filter` promises "at most 3", never rounds up.

**The SSE progress endpoint and `waitForStableOutput` both die.** `react-api.md`
§6: *"There is no separate progress mechanism and none is needed."* Progress is
a ledger count. That removes the 20-second polling loop that currently guesses
at step completion by watching a row count go quiet.

**Modifier order is stored backwards from how it displays.** Stored
innermost-first, displayed outermost-first: `[...operation.modifiers].reverse()`.
Get it wrong and every stack renders backwards. It is also semantic —
`[retry, map]` retries per item, `[map, retry]` retries the whole fan-out.

**An invalid step is `200`, not `422`,** carrying `problems` written to be shown
to users verbatim. Our `BackendError` handling assumes failure is exceptional;
here it is the normal mid-typing state, rendered inline on the step card.

**`Cell` nearly matches.** Core's is `{row_id, column_id, value, display_value}`
— identical to ours except `row_id: str` versus our `number`.

---

## 7. Practical notes

**The submodule tracks GitHub, not your working copy.** Core commits that are
not pushed are invisible to `external/simple-steps-core`. After pushing in core:

```bash
git -C external/simple-steps-core fetch && git -C external/simple-steps-core checkout origin/main
git add external/simple-steps-core && git commit -m "Bump core submodule"
```

**Develop against the submodule, not the frozen copy:**

```bash
.venv/bin/pip install -e external/simple-steps-core
```

Without this, `simple_steps_core` resolves to a site-packages snapshot built
from the git URL and core edits will not reach this repo.

**The wheel resolves core independently.** `pyproject.toml` still declares
`simple-steps-core @ git+https://…`, so a built wheel fetches from origin
regardless of what the submodule is pinned to. The two agree only while core is
pushed. (That direct URL also means PyPI will reject this package on upload —
it has to become a version spec before publishing.)

---

## 8. Proposals we are sending back

| | |
|---|---|
| [`core-proposals/001-index-selection.md`](core-proposals/001-index-selection.md) | `select` (rows) and `project` (columns) shape verbs, why `identity` is the default tool when no tool is chosen, and the separate case of binding one cell as a tool argument |

## 9. What to do while the engine migration lands

Work that is independent of which model wins, in the order it unblocks things:

1. **Split `operation_type`** into tool type plus default verb. Our 16 `map`
   and 1 `filter` operations are not tool *types* in either core model — they
   are orchestration applied to a tool. Pure local refactor, blocks everything else.
2. **Type the parameters.** `Literal["thirds","halves"]` currently flattens to
   a plain string field (visible in `examples/example_server/tools.py`). The
   annotations are what `input_schema` is derived from, so untyped params mean
   untyped forms and an ungrounded agent, in either model.
3. **Fix the frontend test strategy** — MSW at the network boundary instead of
   module mocks. 82 tests currently fail against the formula-parser network stubs.

None of these depend on core. All of them are required whichever model lands.
