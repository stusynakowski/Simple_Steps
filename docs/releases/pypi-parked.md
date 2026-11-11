# PyPI release: parked

Parked 2026-11-11. Nothing is on PyPI yet, for either package.

The move to PyPI (`simple-steps` 0.2.0 on `simple-steps-core` 1.0.2) is
finished on the **`pypi-release`** branch and held there until known bugs
are fixed. `main` installs from GitHub, as the 0.1.x releases did:

```bash
pip install "git+https://github.com/stusynakowski/Simple_Steps.git"
```

## Why it was parked

`main` pinned `simple-steps-core==1.0.2` from PyPI before that package was
uploaded, so every install failed with *"No matching distribution found for
simple-steps-core==1.0.2"*. `main` went back to the git-commit pin
(`dbaf4c7`, the submodule's commit) and the 0.2.0 packaging moved to the
branch.

## What blocks it

- [ ] Bugs noticed before release: list them here.

## What `pypi-release` holds

Commit `4d37abe` ("Release 0.2.0") on top of `main` as it was then:

- `pyproject.toml`: version 0.2.0; core pinned `simple-steps-core==1.0.2`
  (PyPI refuses git-URL dependencies), with the commit it was built from in
  `[tool.simple-steps] core-commit`.
- `scripts/preflight.py`: checks the pin's version and `core-commit` against
  the submodule.
- README, `cli.py`'s update hint, `core_bridge.py`'s upgrade message and the
  developer docs: `pip install simple-steps`.
- `docs/releases/v0.2.0.md`: the release notes.
- `docs/context.md`: "Releasing to PyPI", the full steps.

`scripts/smoke_install.py` is on both branches.

## To release

Credentials are API tokens in `~/.pypirc` (sections `pypi` and `testpypi`);
never in the repo.

```bash
git checkout pypi-release && git rebase main     # take what main gained
# set the version in pyproject.toml and docs/releases/ if main moved past it

# 1. Core first: the app's pin needs it on the index.
python -m build external/simple-steps-core --outdir /tmp/core-dist
python -m twine check /tmp/core-dist/*
python -m twine upload -r testpypi /tmp/core-dist/*
python -m twine upload /tmp/core-dist/*

# 2. The app.
python scripts/preflight.py && python scripts/smoke_install.py
rm -rf dist && python -m build
python -m twine check dist/*
python -m twine upload -r testpypi dist/*
pip install -i https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ simple-steps==<v>
python -m twine upload dist/*

# 3. Land it.
git checkout main && git merge --ff-only pypi-release
git tag v<v> && git push origin main v<v>
```

A version number is never reused on PyPI: a broken upload means a new
version, not a re-upload. Once released, delete this file.
