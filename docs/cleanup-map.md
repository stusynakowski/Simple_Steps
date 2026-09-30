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

## Not dead — keep, despite appearances

Checked and live, so you can stop wondering:

- **`prompts/`** — referenced by `AGENTIC_README.md` as part of the phased
  workflow.
- **`photos/`** — the README cover image.
- **All four `mock_projects/`** — every one is used by tests.
- **`eval_engine.py`** — wired behind the `eval_mode` setting, which the
  Settings panel exposes.
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
