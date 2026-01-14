#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from fnmatch import fnmatch
from typing import Iterable

PHASE_ALLOWLIST = {
    "idea": [
        "docs/introduction.md",
        "docs/context.md",
    ],
    "spec": [
        "docs/spec/*",
        "docs/spec/**",
        "docs/adr/*",
        "docs/adr/**",
        "docs/context.md",
    ],
    "tests": [
        "tests/*",
        "tests/**",
        "docs/testplan/*",
        "docs/testplan/**",
        "docs/context.md",
    ],
    "impl": [
        "src/*",
        "src/**",
        "docs/context.md",
        # If you want to allow limited config edits during IMPL, uncomment:
        # "pyproject.toml",
    ],
}

def run(cmd: list[str]) -> str:
    out = subprocess.check_output(cmd, text=True)
    return out.strip()

def changed_files() -> list[str]:
    """
    Detect changes in working tree vs HEAD.
    Includes staged + unstaged.
    """
    # Use porcelain status for reliability
    status = run(["git", "status", "--porcelain"])
    files: list[str] = []
    if not status:
        return files
    for line in status.splitlines():
        # Format: XY <path> or XY <path> -> <path>
        path = line[3:]
        # Handle rename "old -> new"
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        files.append(path)
    return sorted(set(files))

def is_allowed(path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch(path, pat) for pat in patterns)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True, choices=PHASE_ALLOWLIST.keys())
    args = parser.parse_args()

    patterns = PHASE_ALLOWLIST[args.phase]
    files = changed_files()

    if not files:
        print(f"[guardrails] No changes detected. Phase '{args.phase}' OK.")
        return 0

    violations = [f for f in files if not is_allowed(f, patterns)]

    if violations:
        print(f"[guardrails] Phase '{args.phase}' violations:")
        for v in violations:
            print(f"  - {v}")
        print("\nAllowed patterns:")
        for p in patterns:
            print(f"  - {p}")
        print("\nFix: revert/move changes to allowed paths for this phase.")
        return 1

    print(f"[guardrails] Phase '{args.phase}' OK. Changed files are within allowlist.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
