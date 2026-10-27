# Cleanup map — what is certainly dead, what only looks dead

> Evidence-based inventory, 2026-09-30. Every claim was measured, not guessed.
>
> **Tier 1 is done** — removed 2026-09-30, see "What was actually removed"
> below. Tier 2 dies with a specific staged item; Tier 3 still needs your call.

## The headline

Two clean negative results worth knowing before you start hunting:

- **No orphaned frontend components.** All 24 components, both hooks and all
  three utils are referenced. Nothing to delete there.
- **No orphaned `src/` modules.** Every module has inbound references. The dead
  weight in `src/` is *dead branches inside live files*, not whole files.

So the removable code is concentrated in: docs, tests that cannot run, one
build artifact, and the packs feature you already started retiring.

---

## Tier 1 — certainly dead, remove now

| what | size | evidence |
|---|---|---|
| `build/` | **8.1 MB** | 0 tracked files, already in `.gitignore`. Pure local artifact |
| `frontend/src/utils/formulaIntegration.test.ts` + `formulaParser.test.ts` | **1,417 lines** | 82 of 91 frontend tests fail with `TypeError: fetch failed` — they call a live backend that isn't running |
| `usage_docs/developers/creating_packs.md` + `creating_pip_packs.md` | **502 lines** | Orphaned. The UI links to the *dash*-named `creating-operation-packs.md` and `managing-packs.md`; these underscore-named ones have no link from anywhere |
| `scripts/backfill_formulas.py` + `scripts/migrate_workflows.py` | **299 lines** | Their own docstrings say "One-time migration" / "One-shot migration". Referenced only by historical `dev_plan` logs |
| `main.py` discovery branches | **~50 lines** | The three **repo**-relative branches target absent dirs: bundled `../../packs`, `../youtube_operations`/`llm_operations`/`webscraping_operations`, and `../../mock_operations`. (Corrected on execution: the `packs/` and `ops/` branches are *workspace*-relative — a user's workspace may legitimately have them, so those stay) |
| `DeveloperPack` + `fetchDeveloperPacks` in `api.ts` | ~20 lines | 0 consumers since the Developer Packs panel was deleted |
| `GET /api/developer-packs` in `main.py` | ~15 lines | Its only caller was `fetchDeveloperPacks` |
| `notebook_for_data_viewing/` | 72 KB, 3 files | Zero references anywhere in the repo |
| `formatFormulaValue` + `isStepReference` in `formulaParser.ts` | ~20 lines | `formatFormulaValue` **throws unconditionally**. Both are used only by the unrunnable tests above |

**Tier 1 total: ~2,300 lines of code/docs plus 8.1 MB.**

### One caution on the frontend tests

Deleting 1,417 lines of tests leaves the formula layer with **9 passing
frontend tests** and item 4 about to rewrite it. That is a real trade. The
honest options:

1. **Delete now**, rewrite tests against the new endpoint shape as part of item
   4. Defensible: they test a request/response contract that item 4 changes
   anyway, and they have never run in CI.
2. **Keep, fix with MSW** at the network boundary — already the recommendation
   in `simple-steps-core-updates.md` §9 item 3.

I lean toward (1) *only because* item 4 changes the contract. If item 4 were
not queued, these should be fixed rather than deleted.

---

## What was actually removed (2026-09-30)

| removed | note |
|---|---|
| `build/` | 8.1 MB, untracked artifact |
| `notebook_for_data_viewing/` (3 files) | See the note below — these belong in core |
| `frontend/src/utils/formulaIntegration.test.ts`, `formulaParser.test.ts` | 1,417 lines |
| `usage_docs/developers/creating_packs.md`, `creating_pip_packs.md` | 502 lines |
| `scripts/backfill_formulas.py`, `migrate_workflows.py` | 299 lines |
| `main.py` — 3 repo-relative discovery branches | Discovery is now 4 branches, all reachable |
| `main.py` — `GET /api/developer-packs` | 45 lines; now returns 404. `OpTier` import dropped with it |
| `api.ts` — `DeveloperPack`, `fetchDeveloperPacks` | 0 consumers since the panel was deleted |
| `formulaParser.ts` — `formatFormulaValue`, `isStepReference` | The first threw unconditionally |

Verified after removal:

- Backend boots; `/api/operations` → 200 with 31 ops; `/api/workspace` → 200;
  `/api/developer-packs` → 404 as intended.
- Backend tests unchanged: 30 failed / 33 errors, same as before.
- Frontend typecheck clean; lint errors went 8 → 7 (all pre-existing).
- Bundle rebuilt.

### The coverage that was genuinely lost

Frontend tests went from **91 (82 failed, 9 passed)** to **6 (2 failed,
4 passed)**. So the deleted files held 85 tests — 80 that could never pass, but
also **5 that did**. That is real coverage gone, not just noise, and it should
come back with item 4's tests.

The 2 remaining failures are pre-existing and unrelated: `App.test.tsx` and
`MainLayout.test.tsx` use `vi.mock('../services/api')` with incomplete mocks
(missing `fetchWorkspaceInfo`, `bootstrapSession`, `API_BASE`). Confirmed
failing at `HEAD` before this cleanup. They are the same module-mock problem
that `simple-steps-core-updates.md` §9 item 3 says to replace with MSW.

### Notebooks belong in core

The three removed notebooks are in git history if you want them for the move,
but two of them (`03_safe_formula_demo`, `04_safe_formula_workflow_runner`)
**cannot move to core as written**: they demo `safe_formula`, which is local to
this repo — core has no formula parser. They also call `@simple_step`, now
renamed. The third, `02_demo_update_and_refresh`, was an **empty notebook**
(0 cells).

So "notebooks live in core" is the right rule, and core already has
`tutorial_notebook/` and `examples/simple_steps_core_walkthrough.ipynb` to hold
them. But a core notebook has to demo core's grid API, not our formula bar —
which makes this new material rather than a file move.

---

## Round 2 — examples, fixtures, docs (2026-09-30)

Driven by three decisions: no packs, **one** example, and docs that close their
ideas rather than leave them open.

### One example

`examples/` is now two files: `tools.py` (17 tools — the whole backend a
developer writes) and `README.md`. Removed `my_project/`, `youtube_operations/`,
and `core_grid_demo.py` — the last for the same reason as the notebooks: it
demos core's grid model, so it belongs in core.

### Test fixtures moved, not deleted

`mock_projects/` is gone, but **its fixtures were not thrown away** — the
harness and workflows moved to `tests/fixtures/`, where test fixtures belong
(they were never examples). `test_table_manipulations.py` and
`test_tabular_selection.py` were retargeted and still pass, preserving 32 tests.

Deleted outright: `mock_basic_variables/` and `test_basic_variables.py` — 62 of
its 63 tests could never pass for want of the 8 `var-*` fixtures. Also
`mock_youtube_analysis/` and `tests/basic_mock_youtube_operations.py` (a helper
script pytest never collected).

**The failure wall is gone.** Backend tests went from **30 failed / 33 errors**
to **1 failed / 0 errors** across 161 tests. The one remaining failure is
`test_tabular_selection.py::test_select_cell` — the real `KeyError: 0` bug in
cell selection, now the only red in the suite and no longer hidden.

### Removed, and why

| removed | reason |
|---|---|
| `projects/` | Sample workflow data. `test_formula_alignment` skips cleanly without it; op count went 31 → 29 (the 2 project ops lived here) |
| `prompts/` | Asked for. Only `AGENTIC_README.md` referenced it |
| `AGENTIC_README.md` | Its workflow depended on `prompts/`. `CLAUDE.md` and `docs/context.md` carry the phase rules and never referenced it |
| `docs/current_status/` (316 lines) | Closed build log, untouched since 2026-01-22 |
| `docs/dev_notes/` (142 lines) | Closed notes, untouched since 2026-02-16 |
| `usage_docs/developers/creating-operation-packs.md`, `managing-packs.md` | No packs. Their two Docs-panel links were removed from `Sidebar.tsx` with them |
| `docs/system_design/README.md` — Pack System row | Linked `05-pack-system.md`, which was already absent |

### Kept deliberately

`docs/dev_plan/` — its README says "active as of 2026-05-16" and it is a
curated index of how the system works *today*, not a historical log.
`docs/system_design/` is live but stale in places (`04-operation-registration.md`
still says `@simple_step`). Neither is dead; both want an accuracy pass rather
than deletion.

### The README described a system that does not exist

Worth calling out separately, because it was the least obvious rot. `README.md`
documented:

- A **`simple-steps pack` CLI** — eight subcommands, a `simple_steps.toml`
  manifest, and four troubleshooting rows. There is no `cli_pack.py` and no
  `pack` subcommand in `cli.py`. It was entirely fictional. (The `--packs`
  *flag* does exist and stayed.)
- A project tree listing ten paths that are all absent: `operation_pack.py`,
  `pack_manager.py`, `pack_template/`, `.packs/`, `simple_steps.toml`,
  `src/youtube_operations/`, `src/llm_operations/`,
  `src/webscraping_operations/`, `mock_operations/`, `packs/`.
- `simple-steps-build`, which was never registered as a console script.

All corrected against what is actually on disk.

---

## Round 3 — shell plan reconciled with the code (2026-10-14)

| removed / changed | note |
|---|---|
| Search activity‑bar panel (`ActivityBar.tsx`, `Sidebar.tsx`) | A placeholder input that always said "No results found." Re‑add with Phase E4 of `dev_plan/200` |
| Account activity‑bar panel | Static "User Profiles" text. Accounts are M1, out of scope |
| `build_frontend.source_hash` now skips `*.test.*` and `setupTests.ts` | Tests never ship, so editing one no longer marks the bundle stale |
| `App.test.tsx`, `MainLayout.test.tsx` | Were red: their `api` mocks predated `fetchResourceTypes` and others. Now partial mocks over the real module, with `fetch` stubbed |
| `dev_plan/200` | Status, endpoints, file extension and test baseline corrected; every packs item cut |
| `examples/` → `src/SIMPLE_STEPS/examples/` | Moved into the package so the wheel ships it (package-data can't reach outside the package). `simple-steps --load-examples` copies whatever it holds into the working directory; `simple-steps run app.py` serves one. Older docs that name `examples/…` describe where it was |

---

## Tier 2 — dead on arrival of a staged item, not before

Do not delete these yet. Each is live today and becomes dead when a specific
item lands.

| what | lines | dies with | why it is still live |
|---|---|---|---|
| `formula_parser.py` | 189 | **Item 4** | Its own docstring: "this module can be deleted in a single commit" once the frontend moves to `safe_formula.describe()`. Both formula endpoints still call it |
| `pack_loader.py` — pack half | ~250 of 492 | **Items 1 + 5** | `_load_installed_packs`, `load_developer_pack`, `_load_directory` are pack machinery. **But `load_project` / `_load_project_ops` is live** — it loaded `custom_scoring.py`'s 2 ops at last boot. Split it, don't delete it |
| `tests/test_pack_loader.py` | 244 | **Items 1 + 5** | 13 tests, all passing. They test the machinery above |
| `ParsedFormula.orchestration` | — | **Item 4** | Documented as "always `None` for Stage 3+ formulas". Vestigial field still threaded through the frontend |

The packs point is worth stating plainly: **you cannot delete `pack_loader.py`
outright.** Roughly half of it is the project-op loading that makes
`projects/*/`  custom functions work, and that is a feature you use. Retiring
"packs" means removing the pack tiers and keeping project loading — a split,
not a delete.

---

## Tier 3 — your call, I will not guess

### Historical docs — 4,855 lines

| directory | lines | last touched |
|---|---|---|
| `docs/dev_plan/` | 2,788 | — |
| `docs/system_design/` | 1,609 | — |
| `docs/current_status/` | 316 | **2026-01-22** (8 months) |
| `docs/dev_notes/` | 142 | **2026-02-16** (7.5 months) |

`current_status/` (000–007) and `dev_notes/` (including
`status_update_feb_13.md`, `stage_1_summary.md`) read as a build log of work
already finished. They are the strongest deletion candidates — but they are
also the only record of *why* early decisions were made, and they cost nothing
to keep. Deleting docs is cheap to regret and free to postpone.

`dev_plan/` and `system_design/` are larger and more mixed: some describe the
current system, some describe plans superseded by the core adoption. Worth a
pass, but not a bulk delete.

**`docs/context.md` names the canonical set** as `introduction.md`, `spec/`,
`testplan/`, `adr/`. By that rule everything above is non-canonical — but
`context.md` also has an unedited `Phase:` placeholder, so I would not treat it
as authoritative on its own.

### `test_basic_variables.py` — 62 tests, all broken

This single file is **the entire 63-failure wall**, confirmed per-file:

```
test_basic_variables.py     fail=29  err=33
test_tabular_selection.py   fail=1   err=0     ← a real bug, see below
everything else             fail=0   err=0
```

`core-adoption-status.md` already identified the 8 missing fixtures; what is
new here is that the damage is confined to **one test file**, so removing or
fixing it clears the entire failure wall. The cause is one coherent gap: it
needs 8 fixtures
(`var-string`, `var-int`, `var-float`, `var-bool`, `var-list`, `var-dict`,
`var-nested-dict`, `var-all-types`) and `mock_projects/mock_basic_variables/workflows/`
holds three unrelated files.

Three options, and this is a decision not a cleanup: **regenerate the
fixtures**, **delete the file** (62 tests of single-cell variable behaviour, a
feature that does work), or **mark it skipped with a reason**. Any is better
than leaving it red, because it is currently the only thing making "did I break
something?" hard to answer.

### Root-level docs, all unreferenced

`AGENTIC_README.md` (5.4 KB), `WHY_WE ARE_BUILDING_THIS.md` (6.3 KB),
`run_checks.sh` (7.9 KB) — nothing links to any of them. They are probably for
humans rather than dead, which is why they are here and not in Tier 1.

Note `WHY_WE ARE_BUILDING_THIS.md` has a space *and* an underscore in its
filename, which is why it shows as `WHY_WE` in most listings.

---

## Round 4 — preparing for the grid-only core (2026-10-26)

The owner is changing core to the plan in
[`system_design/12-core-and-app.md`](system_design/12-core-and-app.md) ("The
core update") and [`core-proposals/011-core-handover.md`](core-proposals/011-core-handover.md).
This round maps what changes **in this repo** because of it, and what becomes
dead. Measured on the working tree, not guessed. Nothing here is removed yet:
each removal is confirmed first, in the `cleanup` phase
([`how-simple-steps-works.md`](how-simple-steps-works.md) §8 has what each
legacy piece still does).

### What was measured

- **Still no orphaned module.** An import graph of `src/SIMPLE_STEPS` finds
  every module imported by something, or an entry point. Dead code is still
  in branches and routes, and in modules only legacy code imports:
  `helpers.py` is imported only by `eval_engine.py`; `orchestrators.py` only
  by `engine.py`; `orchestration_ops.py` and `pack_loader.py` only by
  `main.py`.
- **Correction to §8 L11.** It said the UI never calls the formula
  endpoints. It does: the UI parses *every* formula through
  `/api/parse_formula` (`useWorkflow.ts`, `StepToolbar.tsx`,
  `OperationColumn.tsx`, `ToolEditor.tsx`), and also calls `build_formula`,
  `format_formula` and `infer_verb`. The routes the UI really never calls are
  `/api/debug/registry`, `/api/loader` and `/api/projects/{id}/load-ops`.
- **How widely the legacy names reach** (references in src / tests / frontend):
  `OPERATION_REGISTRY` 56 / 34 / 0, `StepProxy` 86 / 2 / 0, `ref_id`
  135 / 68 / 12, `RAW_STORE` 15 / 7 / 0, `DATA_STORE` 10 / 8 / 0,
  `eval_mode` 8 / 0 / 6, `coerce_config_to_signature` 9 / 0 / 0.

### Stage A — now, without waiting for core

Decided already; needs only the owner's go-ahead per item.

| Item | Code | Notes |
|---|---|---|
| L1 eval mode | `eval_engine.py` (161 lines), `settings.eval_mode`, its branch in `engine.py`; the toggle in `Sidebar.tsx` and `api.ts` | `helpers.py` (335) is imported only by `eval_engine.py`, so it becomes unreachable too, unless L8 keeps it as public API |
| L2 engine switch | `settings.engine` (1 backend reference, 1 frontend) | the grid only |
| Unused routes | `/api/debug/registry`, `/api/loader`, `/api/projects/{id}/load-ops` | `load-ops` is also half of the code-execution hole (with `files/write`) |
| L11, corrected | — | the formula routes stay until core's parser backs them (stage C) |

### Stage B — the tangles, no behaviour change

From §8 "Tangles to cut first", plus one more:

1. Split `grid_runner.py` (961 lines) into what the kernel needs and the
   legacy per-step path (L10, `coerce_config_to_signature`).
2. Move `models.StepConfig` and `example_check.py` off `formula_parser` onto
   `operation_formula`.
3. `@simple_step_tool` stops wrapping tools in `StepProxy`.
4. New: `useWorkflow.ts:104` rebuilds a formula from legacy fields
   (`buildFormula(processType, configuration, …)`) when a saved formula
   doesn't parse. That is the frontend's last legacy-formula path; it goes
   with L4.

### Stage C — as each core change lands

| Core change | What changes here | Dead afterwards |
|---|---|---|
| **Catalog object** (12: object model; K24) | `application.App` builds a `grid.Catalog`; `core_bridge.register_with_core` and `main.py:139` stop using `REGISTRY`/`register_tool`; `agent/scope.py` reads the catalog | `OPERATION_REGISTRY` becomes the catalog (56 refs); `DEFINITIONS_LIST`; the old engine's imports |
| **`Formula.parse` in core** | `/api/parse_formula`, `format_formula` keep their response shape and call core | `operation_formula.py` (678) shrinks to the UI's `to_parts`; the canonical half of `formula_parser.py` |
| **Kernel in core, with `kernel.spec`** | `kernels.Kernel` keeps key, kernel, lock, last-used; snapshots save `kernel.spec` | `Kernel.formulas`, `operations`, `reads`, `uses`, `problems`, `loaded`, `ids`; `kernels.summary()` |
| **Outputs by data version** (K22) | `/api/data`, `/api/cell`, `/api/data-meta` read from the kernel. Recommend: **keep the `ref_id` field, and make its value the data version**, so the 12 frontend references and 68 test references keep working | `DATA_STORE`, `RAW_STORE` (with L6), the leak |
| **Sizes and pages** (K26) | `/api/data?offset&limit` calls `wf.preview(rows=…)`; responses carry row count, estimated size, or `unknown` with the reason | the app's own slicing |
| **Lineage** (K28) | `/api/cell` returns core's stored lineage | the app working lineage out |
| **Progress modifiers** (K23) | `progress.py` (90) and the SSE route `/api/progress/{step_id}` relay core's callback | the app's own progress bookkeeping |
| **`extras`** (K21) | `@simple_step_tool` = core `@tool` + `extras["simple_steps.ui"]` (`name`, `category`, widgets); `operation_type` becomes a default modifier; `description` goes to the docstring | `apply`; `SHIM(core §C18)`; the side table for UI data |
| **`spec` / `from_spec`** | `file_manager.py` saves and loads `kernel.spec` | the app's own workflow format, after a converter (K17) |
| **`ResourceSpec` renamed** | `core_bridge.py` built-in tool groups move to the catalog; `CLAUDE.md` and `context.md` name a new pin-drift symptom | the old `ResourceSpec` use |
| **Kernel and run ids** (K20) | the workflow file and the UI show `k.id` | — |
| **Stale-reference warnings** (K29) | shown with the other step problems | — |

### Stage D — the owner's calls (§8)

**The rule for this round** (owner, 2026-10-26): mitigate spaghetti code and
leaky abstractions as much as possible; *the best code is no code that still
implements what we envisioned*. So the default for each call below is
**delete**, unless a stated goal needs it, and no converters, aliases or
compatibility layers without a named user who needs them.

| Item | Modules | Lines | Recommendation under the rule |
|---|---|---|---|
| L3 tool loading at runtime | `pack_loader.py` | 522 | delete. `App(tools=[…])` at boot covers it, and it's half of a security hole |
| L4 old-syntax formulas | `orchestrators.py`, `orchestration_ops.py`, the legacy half of `formula_parser.py`, most of `engine.py`'s dispatch | 322 + 251 + ~100 + most of 999 | delete, with one clear error ("written in the old syntax") instead of a converter. No shipped example uses it |
| L7 console expressions | `safe_formula.py` | 837 | delete, and the console with it: adding a step *is* how you evaluate something, and it shows the result as data. Keep the console only if it does something a step can't |
| L8 steps as Python variables | `step_proxy.py`, `helpers.py` | 505 + 335 | delete. Core's `wf["x"] = …` is the Python way, the same in a terminal |
| L9 duplicate standard tools | in `operations.py` | per tool | delete the duplicates. Add a second spelling later, as a thin tool on core's verb, only when a user asks for it |

### Leaks to close, beyond dead code

Places where one concept is implemented twice, or where one layer's detail
shows through another:

| Leak | Where | One owner |
|---|---|---|
| two formula parsers | `formula_parser.py` and `operation_formula.py`; the UI round-trips every edit through the first | core's `Formula.parse` |
| three registries | core `REGISTRY`, `grid.TOOLS`, this repo's `OPERATION_REGISTRY` | the catalog |
| two `App`s | core's `app.py` and this repo's `application.py` | this repo's (core's goes) |
| two status models | §7 item 20 | core's step status |
| two agent paths | `/propose` and the LangGraph `/chat` | one agent, using `proposals.py`'s checks |
| the frontend keeps parsed state beside the formula | `types/models.ts:32` ("always updated alongside `formula`"), `processType`/`configuration` legacy fields | the formula text is the step; parts are derived on demand |
| stores outside the kernel | `DATA_STORE`, `RAW_STORE` | the kernel's outputs (K22) |
| the kernel duplicates core's step fields | `kernels.Kernel.formulas`, `operations`, … | core's step |

About 3,200 lines of whole modules, plus most of `engine.py` and half of
`grid_runner.py`.

**Tests that go with their code:** `test_orchestrators.py` and
`test_step_mode.py` (orchestrators, L4), `test_pack_loader.py` (L3),
`test_safe_formula.py` (L7). `test_formula_alignment.py` (910 lines),
`test_step_engine.py` and `test_engine.py` exercise `engine.py`; check each
test against what stays before removing any. A test of behaviour that stays
is never edited to pass.

**The checks after each removal:** `pytest` stays at 1 failure (0 once
`select_cell` goes), `python scripts/preflight.py`, and
`python src/SIMPLE_STEPS/examples/runme.py`.

---

## Not dead — keep, despite appearances

Checked and live, so you can stop wondering:

- **`prompts/`** — referenced by `AGENTIC_README.md` as part of the phased
  workflow.
- **`photos/`** — the README cover image.
- **All four `mock_projects/`** — every one is used by tests.
- **`eval_engine.py`** — wired behind the `eval_mode` setting, which the
  Settings panel exposes. *Removal decided 2026-10-24 (L1); see Round 4.*
- **`src/SIMPLE_STEPS/agent/`** — `main.py:145` includes its router.
- **`build_frontend.py`** — 0 inbound references, but it is the bundle build.
  Run as `python -m SIMPLE_STEPS.build_frontend`.
- **`src/SIMPLE_STEPS/frontend_dist/`** — generated, but *intentionally*
  tracked; `MANIFEST.in` ships it in the wheel.

---

## Two real bugs found while mapping

Neither is cleanup, both are small:

1. **`scripts/verify_phase.ph`** — the extension is a typo. `AGENTIC_README.md`
   calls it `verify_phase.sh` twice; `docs/context.md` calls it `.ph`. The file
   is `.ph`, so the README's instructions fail.
2. **`test_tabular_selection.py::test_select_cell`** — fails with `KeyError: 0`
   in pandas. A genuine defect in cell selection, unrelated to fixtures, and
   the only real test failure in the repo.
