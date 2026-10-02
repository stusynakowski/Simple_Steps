#!/usr/bin/env python3
"""
preflight.py — the invariants that have actually broken this repo.

Each check here exists because the thing it checks for went wrong once. Run it
before pushing anything that someone will install:

    python scripts/preflight.py
    python scripts/preflight.py --fix      # rebuild what can be rebuilt

What it checks, and the failure each one prevents:

1. **The core pin matches the submodule.** ``pyproject.toml`` pins
   ``simple-steps-core`` to a commit; ``external/simple-steps-core`` records
   one too. When they disagree, an installing user gets a different core than
   this repo is developed against. That produced
   ``ImportError: cannot import name 'ResourceSpec'`` and made the whole
   package unimportable, because ``SIMPLE_STEPS/__init__`` imports
   ``core_bridge``.

2. **The installed core matches the pin.** The same drift inside your own
   virtualenv — an environment that installed core before a pin bump keeps the
   old one silently.

3. **The bundled frontend is not stale.** ``src/SIMPLE_STEPS/frontend_dist/``
   is a build artifact that ships in the wheel. Editing ``frontend/src`` without
   rebuilding means the installed UI silently lags the source.

Exit code is 0 only if every check passes, so it works as a pre-push gate.
``--fix`` rebuilds the bundle; the pin is never changed automatically, because
which commit is correct is a decision rather than a repair.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORE_SUBMODULE = REPO / "external" / "simple-steps-core"
PYPROJECT = REPO / "pyproject.toml"
BUNDLE = REPO / "src" / "SIMPLE_STEPS" / "frontend_dist"
FRONTEND_SRC = REPO / "frontend" / "src"

PASSED: list[str] = []
FAILED: list[tuple[str, str]] = []


def ok(name: str) -> None:
    PASSED.append(name)
    print(f"  [PASS] {name}")


def bad(name: str, detail: str) -> None:
    FAILED.append((name, detail))
    print(f"  [FAIL] {name}")
    for line in detail.strip().splitlines():
        print(f"         {line}")


def _git(*args: str, cwd: Path = REPO) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


# --------------------------------------------------------------------------- #
# 1 + 2. Core pin agreement                                                   #
# --------------------------------------------------------------------------- #

def pinned_commit() -> str | None:
    """The commit `pyproject.toml` pins simple-steps-core to, if any."""
    text = PYPROJECT.read_text()
    m = re.search(
        r"simple-steps-core\s*@\s*git\+[^\"'\s]*?simple-steps-core\.git@([0-9a-fA-F]{7,40})",
        text,
    )
    return m.group(1) if m else None


def submodule_commit() -> str | None:
    return _git("rev-parse", "HEAD", cwd=CORE_SUBMODULE)


def check_core_pin() -> None:
    name = "pyproject pins core to the submodule's commit"

    if not CORE_SUBMODULE.is_dir() or not any(CORE_SUBMODULE.iterdir()):
        bad(name, "external/simple-steps-core is empty.\n"
                  "Fix: git submodule update --init external/simple-steps-core")
        return

    pin = pinned_commit()
    sub = submodule_commit()

    if pin is None:
        bad(name,
            "pyproject.toml does not pin simple-steps-core to a commit.\n"
            "An unpinned git URL resolves to core's main at install time, which\n"
            "drifts from the submodule. Pin it:\n"
            f'  "simple-steps-core @ git+https://github.com/stusynakowski/'
            f'simple-steps-core.git@{sub or "<commit>"}"')
        return

    if sub is None:
        bad(name, "could not read the submodule's HEAD commit")
        return

    n = min(len(pin), len(sub))
    if pin[:n].lower() != sub[:n].lower():
        bad(name,
            f"pyproject pins {pin[:12]}\n"
            f"submodule is at {sub[:12]}\n"
            "These must move together. Either bump the pin to the submodule, or\n"
            "check out the pinned commit in the submodule.")
        return

    ok(f"{name} ({sub[:12]})")


def check_installed_core() -> None:
    """The core in *this* interpreter should be the pinned commit."""
    name = "the installed core matches the pin"
    pin = pinned_commit()
    if pin is None:
        print(f"  [SKIP] {name} (no pin to compare)")
        return

    try:
        import importlib.metadata as md
        raw = md.distribution("simple-steps-core").read_text("direct_url.json")
    except Exception:
        print(f"  [SKIP] {name} (core not installed in this interpreter)")
        return

    if not raw:
        print(f"  [SKIP] {name} (no direct_url.json)")
        return

    info = json.loads(raw)
    vcs = info.get("vcs_info") or {}
    commit = vcs.get("commit_id")
    url = info.get("url", "")

    # An editable install from the submodule is the development setup and is
    # correct by construction — it *is* the submodule.
    if info.get("dir_info", {}).get("editable") or url.startswith("file://"):
        ok(f"{name} (editable from the submodule)")
        return

    if not commit:
        print(f"  [SKIP] {name} (installed core records no commit)")
        return

    n = min(len(pin), len(commit))
    if pin[:n].lower() != commit[:n].lower():
        bad(name,
            f"pin is       {pin[:12]}\n"
            f"installed is {commit[:12]}\n"
            "Fix: pip install --upgrade --force-reinstall --no-cache-dir \\\n"
            "       \"git+https://github.com/stusynakowski/Simple_Steps.git\"")
        return

    ok(f"{name} ({commit[:12]})")


# --------------------------------------------------------------------------- #
# 3. Bundle freshness                                                         #
# --------------------------------------------------------------------------- #

def check_bundle_fresh(fix: bool = False) -> None:
    """
    Compare the bundle's recorded source hash to the sources on disk.

    Content hashes, not timestamps: build_frontend patches api.ts for the
    production build and restores it afterwards, which leaves the source
    newer than the bundle it just produced. Timestamps report that as stale
    every single time.
    """
    name = "the bundled frontend is not stale"

    if not (BUNDLE / "index.html").is_file():
        if fix and _rebuild():
            ok(f"{name} (rebuilt)")
            return
        bad(name, "src/SIMPLE_STEPS/frontend_dist/index.html is missing.\n"
                  "Fix: python -m SIMPLE_STEPS.build_frontend")
        return

    if not FRONTEND_SRC.is_dir():
        print(f"  [SKIP] {name} (no frontend/src — installed, not a checkout)")
        return

    sys.path.insert(0, str(REPO / "src"))
    try:
        from SIMPLE_STEPS.build_frontend import SOURCE_STAMP, source_hash
    except ImportError as exc:
        print(f"  [SKIP] {name} (cannot import build_frontend: {exc})")
        return

    stamp_file = BUNDLE / SOURCE_STAMP
    current = source_hash(str(FRONTEND_SRC))

    if not stamp_file.is_file():
        if fix and _rebuild():
            ok(f"{name} (rebuilt — bundle predated source stamping)")
            return
        bad(name,
            "the bundle carries no source stamp, so it predates stamping and\n"
            "cannot be verified.\n"
            "Fix: python -m SIMPLE_STEPS.build_frontend   (or rerun with --fix)")
        return

    recorded = stamp_file.read_text().strip()
    if recorded != current:
        if fix and _rebuild():
            ok(f"{name} (rebuilt)")
            return
        bad(name,
            f"bundle was built from {recorded[:12]}\n"
            f"frontend/src is now   {current[:12]}\n"
            "The installed UI would lag the source.\n"
            "Fix: python -m SIMPLE_STEPS.build_frontend   (or rerun with --fix)")
        return

    ok(f"{name} ({current[:12]})")


def _rebuild() -> bool:
    print("         rebuilding the frontend bundle …")
    r = subprocess.run(
        [sys.executable, "-m", "SIMPLE_STEPS.build_frontend"],
        cwd=REPO, capture_output=True, text=True,
    )
    if r.returncode != 0:
        print("         rebuild failed:")
        for line in (r.stderr or r.stdout).strip().splitlines()[-6:]:
            print(f"           {line}")
        return False
    return True


# --------------------------------------------------------------------------- #

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--fix", action="store_true",
                    help="rebuild the frontend bundle if it is stale or missing")
    args = ap.parse_args()

    print("\nSimple Steps — preflight")
    print(f"  repo: {REPO}\n")

    check_core_pin()
    check_installed_core()
    check_bundle_fresh(fix=args.fix)

    total = len(PASSED) + len(FAILED)
    print(f"\n  {len(PASSED)}/{total} checks passed")
    if FAILED:
        print("\n  Not ready to push:")
        for n, _ in FAILED:
            print(f"    - {n}")
        print("\n  For the full install test (builds a wheel, installs it into a")
        print("  clean venv, drives a workflow): python scripts/smoke_install.py")
        return 1
    print("  preflight clean\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
