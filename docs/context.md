# Project Context (Agent Entry Point)

## Goal
Build this project using a phased workflow: Idea → Specs → Tests → Implementation.

## Current phase
Set this manually before using an agent:
- Phase: IDEA | SPEC | TESTS | IMPL

## Phase edit rules (hard guardrails)
- IDEA: may edit only `docs/introduction.md` and `docs/context.md`
- SPEC: may edit only `docs/spec/**`, `docs/adr/**`, and `docs/context.md`
- TESTS: may edit only `tests/**`, `docs/testplan/**`, and `docs/context.md`
- IMPL: may edit only `src/**` and `docs/context.md` (plus explicitly allowed config files if needed)

## Canonical docs
- Introduction: `docs/introduction.md`
- Specs: `docs/spec/`
- Test plans: `docs/testplan/`
- ADRs: `docs/adr/`

## Commands
- Install (dev): `python -m pip install -e ".[dev]"`
- Run tests: `pytest -q`
- Run guardrails: `PHASE=spec ./scripts/verify_phase.sh`

## Conventions
- Every requirement in specs MUST have an ID like `REQ-CORE-001`
- Every test references at least one REQ id in a comment/docstring
- Avoid adding new dependencies unless required by the spec
