# Docs map

One home for each kind of question. If a doc doesn't fit a row, it belongs in
`archive/`. Agents start at [`context.md`](context.md) (rules and commands),
then come here.

| Question | Home | Kept current? |
|---|---|---|
| Why does this exist, and for whom? | [`why-we-are-building-this.md`](why-we-are-building-this.md) | yes |
| What are the components, and what state are they in? | [`how-simple-steps-works.md`](how-simple-steps-works.md) | yes |
| How do I use the app? (**user docs**) | [`usage_docs/user/`](usage_docs/user/) | yes; bundled into the in-app Docs panel |
| How do I build an app on it? (**developer docs**, for app authors) | [`usage_docs/developer/`](usage_docs/developer/) | yes; bundled into the in-app Docs panel |
| How does it work inside? (**design docs**, for contributors) | [`system_design/`](system_design/) 10–12 | yes |
| What must it do? (REQ-* IDs) | [`spec/`](spec/) 009–014, tests in [`testplan/`](testplan/) | yes |
| What are we changing next? (**dev plan**) | [`dev_plan/`](dev_plan/) | active plans only; see its README |
| What do we need from core? | [`core-proposals/`](core-proposals/) (008 is the live list) | yes |
| What was removed, and what is staged for removal? | [`cleanup-map.md`](cleanup-map.md) | yes |
| Why was an early decision made? | [`adr/`](adr/), [`archive/`](archive/) | no: historical |

## Rules

- **`usage_docs/` ships.** `build_frontend` bundles `usage_docs/**/*.md` into
  the UI, so a change there needs `python -m SIMPLE_STEPS.build_frontend`.
  The path is read by `src/SIMPLE_STEPS/build_frontend.py` and
  `frontend/src/utils/docs.ts`; don't rename it without changing both.
- **A plan leaves `dev_plan/` when it's done or superseded.** What it decided
  goes into `system_design/` or `spec/`; the plan itself moves to
  `archive/dev_plan/`.
- **`archive/` is not maintained.** It uses the retired syntax
  (`=tool.map(…)`, `step1.col`, `@simple_step`, packs). Read it for history,
  never as a description of the system.

## What's in `archive/`

| | What | Superseded by |
|---|---|---|
| `archive/dev_plan/100–119` | The pre-core formula language, grammar, shapes, extension model, early referencing and console plans (May–Oct 2026) | `system_design/10–12`, `dev_plan/120`, core's spec |
| `archive/system_design/01–08` | Architecture before the engine moved to core (April 2026) | `system_design/10–12` |
| `archive/spec/000–008` | The January UI and data-model specs; no REQ ID in them is cited by a test | `spec/009–014` |
| `archive/introduction.md` | The first product statement | `why-we-are-building-this.md` |
| `archive/core-adoption-status.md`, `archive/simple-steps-core-updates.md` | Core adoption notes from before core 0.2.0 | `dev_plan/core_migration.md`, `core-proposals/008` |

## Outside `docs/`

- `README.md`: install and run; links here.
- `src/SIMPLE_STEPS/README.md`: the package's modules.
- `src/SIMPLE_STEPS/examples/README.md`: the shipped examples, which check themselves.
- `frontend/README.md`: the frontend build.
- Root `usage_docs/`: **stale**, old syntax, not served by the app. Only
  `developers/desktop-mode.md` has no current equivalent. Staged for removal
  (it's outside the cleanup phase's allowed paths).
- Root `WHY_WE ARE_BUILDING_THIS.md`: the owner's original notes that
  `why-we-are-building-this.md` grew from.
