#!/usr/bin/env python3
"""
backfill_formulas.py
====================
One-time migration script that adds the missing `formula` field to all
pipeline JSON files in the projects/ directory.

Run from the repo root:
    python scripts/backfill_formulas.py

What it does:
  For each step in each pipeline JSON file:
    1. If the step already has a non-empty `formula`, skip it.
    2. Otherwise, reconstruct the formula from `operation_id` + `config`
       using the same buildFormula logic the frontend uses.
    3. Write the updated JSON back to disk.

This fixes the bug where loading a pipeline shows only the step name
in the formula bar instead of the full function + arguments.
"""

import json
import os
import sys


def build_formula(operation_id: str, config: dict, orchestration: str = None) -> str:
    """
    Python implementation of buildFormula from formulaParser.ts.
    Produces a formula string like: =fetch_videos.source(channel_url="https://...")
    """
    if not operation_id or operation_id in ("noop", "passthrough", ""):
        return ""

    effective_mode = orchestration if orchestration else config.get("_orchestrator")
    modifier = f".{effective_mode}" if effective_mode else ""

    args_parts = []
    for k, v in config.items():
        if k.startswith("_"):
            continue
        if isinstance(v, str) and not str(v).startswith("="):
            val_str = f'"{v}"'
        else:
            val_str = str(v) if v is not None else ""
        args_parts.append(f"{k}={val_str}")

    args = ", ".join(args_parts)
    return f"={operation_id}{modifier}({args})"


def backfill_project_dir(projects_dir: str) -> int:
    """Walk projects/ and backfill formula fields. Returns count of steps updated."""
    updated = 0

    for root, dirs, files in os.walk(projects_dir):
        for fname in files:
            if not fname.endswith(".json"):
                continue
            fpath = os.path.join(root, fname)

            try:
                with open(fpath) as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError) as e:
                print(f"  ⚠ Skipping {fpath}: {e}")
                continue

            steps = data.get("steps", [])
            file_changed = False

            for step in steps:
                op_id = step.get("operation_id", "")
                existing_formula = step.get("formula", "")

                if existing_formula:
                    continue  # already has a formula

                if not op_id or op_id in ("noop", "passthrough"):
                    continue  # nothing to build

                config = step.get("config", {})
                orchestration = config.get("_orchestrator")
                formula = build_formula(op_id, config, orchestration)

                if formula:
                    step["formula"] = formula
                    file_changed = True
                    updated += 1
                    step_id = step.get("step_id", "?")
                    print(f"  ✅ {fname} → {step_id}: {formula}")

            if file_changed:
                with open(fpath, "w") as f:
                    json.dump(data, f, indent=2)

    return updated


def main():
    # Default: projects/ in repo root
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    projects_dir = os.path.join(repo_root, "projects")

    if not os.path.isdir(projects_dir):
        print(f"No projects/ directory found at {projects_dir}")
        sys.exit(1)

    print(f"Scanning {projects_dir} for pipeline JSON files...\n")
    count = backfill_project_dir(projects_dir)

    if count == 0:
        print("\n✅ All pipeline files already have formula fields.")
    else:
        print(f"\n✅ Updated {count} step(s) with formula fields.")
        print("Re-run 'pytest tests/test_formula_alignment.py' to verify.")


if __name__ == "__main__":
    main()
