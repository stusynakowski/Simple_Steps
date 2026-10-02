# Project Context (Agent Entry Point)

## Goal
Build this project using a phased workflow: Idea → Specs → Tests → Implementation.

## Current phase
Set this manually before using an agent:
- Phase: IMPL

## Phase edit rules (hard guardrails)
- IDEA: may edit only `docs/introduction.md` and `docs/context.md`
- SPEC: may edit only `docs/spec/**`, `docs/adr/**`, `docs/core-proposals/**`, and `docs/context.md`
- TESTS: may edit only `tests/**`, `docs/testplan/**`, and `docs/context.md`
- IMPL: may edit only `src/**`, `frontend/**`, `examples/**`, `scripts/**`, `docs/**`, `README.md`, and `pyproject.toml`

---

## `simple-steps-core` is the heart, and it is read-only here

The backend's registry, tool contracts, resources and engine come from
`simple_steps_core`. **Never edit `external/simple-steps-core/`.** When core
cannot do something we need:

1. Shim it in `src/SIMPLE_STEPS/core_bridge.py` — nowhere else.
2. Tag the shim `SHIM(core §X)` with the section it corresponds to.
3. Record the gap in `docs/core-proposals/003-app-adoption.md`, with the
   evidence: what you ran, and what it returned.

The point of keeping every shim in one file with a tag is that each one is
deletable the day core closes its gap. A shim anywhere else is a shim nobody
will find.

**Verify claims against core by running it, not by reading its docs.** Three
claims in `003` were written from the docs and turned out to be wrong or
narrower than stated — one was retracted entirely because the probe passed an
argument that masked the behaviour being tested.

### The core pin and the submodule move together

`pyproject.toml` pins core to a commit; `external/simple-steps-core` records
one. **If they disagree, installs break** — an older core lacks `ResourceSpec`,
and because `SIMPLE_STEPS/__init__` imports `core_bridge`, the whole package
becomes unimportable.

To take a core update:

```bash
git -C external/simple-steps-core fetch && git -C external/simple-steps-core checkout origin/main
# then set the SAME commit in pyproject.toml's simple-steps-core @ git+...@<commit>
python scripts/preflight.py            # fails if the two disagree
.venv/bin/pip install -e external/simple-steps-core   # so your venv matches too
```

---

## Before pushing anything installable

```bash
python scripts/preflight.py --fix      # pin agreement + bundle freshness
python scripts/smoke_install.py        # wheel → clean venv → run a workflow
```

`preflight` is the fast gate and only checks invariants that have actually
broken this repo. `smoke_install` is the slow one that proves a user's install
works; run it when packaging or dependencies changed.

Two hooks in `.claude/settings.json` make this automatic rather than
remembered, so neither depends on anyone reading this file:

- **`git push` is blocked when preflight fails.** A `PreToolUse` hook scoped to
  `Bash(git push*)` runs preflight and denies the push with the full failure
  text. Override by fixing the failure, not by bypassing the hook.
- **Editing `frontend/src` warns that the bundle is stale.** A `PostToolUse`
  hook on `Write|Edit` says so immediately, rather than letting it surface at
  push time.

Run `/hooks` to review or disable them. Preflight deliberately needs nothing
but the standard library, so the hook gives the same verdict under any Python 3.

### The frontend bundle is a build artifact that ships

`src/SIMPLE_STEPS/frontend_dist/` is committed because the wheel ships it.
**Any change under `frontend/src` needs a rebuild**, or the installed UI
silently lags the source:

```bash
python -m SIMPLE_STEPS.build_frontend
```

`preflight` catches a stale bundle by comparing a content hash the build stamps
into `frontend_dist/.source-hash`. It is a hash rather than a timestamp because
the build patches `api.ts` and restores it afterwards, which leaves the source
newer than the bundle it just produced — timestamps report that as stale every
time.

---

## Canonical docs
- Introduction: `docs/introduction.md`
- Specs: `docs/spec/`
- Test plans: `docs/testplan/`
- ADRs: `docs/adr/`
- Core adoption status and next steps: `docs/core-adoption-status.md`
- Changes requested of core: `docs/core-proposals/`
- What was removed and what is staged for removal: `docs/cleanup-map.md`
- Architecture as built: `docs/dev_plan/` (its README marks it active)

## Commands
- Install (dev): `python -m pip install -e ".[dev]"`
- **Update a pip install elsewhere**: both packages are permanently `0.1.0`, so
  a plain `pip install git+...` is a NO-OP on a machine that already has them —
  pip reports the old copy as satisfying the requirement. Use
  `pip install --upgrade --force-reinstall --no-cache-dir "git+https://github.com/stusynakowski/Simple_Steps.git"`,
  and check the result with `simple-steps --version`, which prints each
  package's git commit rather than its (meaningless) version.
- Run backend tests: `pytest -q`
- Run frontend tests: `cd frontend && npx vitest run`
- Run the app in dev: `simple-steps-dev` (backend :8000 + Vite :5173 — use :5173)
- Rebuild the shipped bundle: `python -m SIMPLE_STEPS.build_frontend`
- Preflight: `python scripts/preflight.py [--fix]`
- Full install test: `python scripts/smoke_install.py`
- Run guardrails: `PHASE=impl ./scripts/verify_phase.sh`
- Guardrails with temporary overrides: `python ./scripts/guardrails.py --phase impl --allow "README.md,pyproject.toml"`

## Conventions
- Every requirement in specs MUST have an ID like `REQ-CORE-001`
- Every test references at least one REQ id in a comment/docstring
- Avoid adding new dependencies unless required by the spec
- Tools are declared with `@simple_step_tool`; objects tools *use* are declared
  with `simple_step_resource`. `@simple_step` is a deprecated alias that
  delegates — do not add new uses.
- A tool's contract comes from its signature and docstring. Write an `Args:`
  section: per-parameter text in the UI is parsed from it, and 35% of
  parameters currently have none.
- Built-in tool groups are namespace-only `ResourceSpec`s, following core's own
  `orchestration` precedent. The word "pack" is retired.

## Known red
- `tests/test_tabular_selection.py::test_select_cell` fails with `KeyError: 0` —
  a real cell-selection bug, and the only failing test. If the count is ever
  higher than 1, something new broke.
