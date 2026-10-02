Default read entrypoint: docs/context.md — read it before non-trivial work.
Follow the same rules as docs/context.md.
Never edit outside allowed paths for the current phase.
Use REQ-* IDs in specs; map to TEST-* in tests.

Hard invariants (details and commands in docs/context.md):

- `simple_steps_core` is the backend's heart and `external/simple-steps-core/`
  is READ-ONLY. Shim gaps only in `src/SIMPLE_STEPS/core_bridge.py`, tag them
  `SHIM(core §X)`, and record them in `docs/core-proposals/003-app-adoption.md`.
- Verify claims about core by RUNNING it, never by reading its docs. Doc-based
  claims have been wrong here.
- The core pin in `pyproject.toml` and the `external/simple-steps-core`
  submodule commit must match. If they drift, installs break with
  `ImportError: cannot import name 'ResourceSpec'`.
- `src/SIMPLE_STEPS/frontend_dist/` ships in the wheel. Any change under
  `frontend/src` requires `python -m SIMPLE_STEPS.build_frontend`.
- Tools use `@simple_step_tool`; resources use `simple_step_resource`.
  `@simple_step` is a deprecated alias — no new uses.

Before pushing anything installable:
  python scripts/preflight.py --fix     # fast: pin agreement + bundle freshness
  python scripts/smoke_install.py       # slow: wheel -> clean venv -> run a workflow

Baseline: backend tests are 1 failed / 0 errors (a known `KeyError: 0` in
`test_select_cell`). More than 1 failure means something new broke.
