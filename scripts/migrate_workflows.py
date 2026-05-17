"""
migrate_workflows.py
====================
One-shot migration from the v1 workflow format (operation_id + config + formula
with orchestration modifiers and leading '=') to the v2 expression-only format
described in docs/dev_plan/102-workflow-and-session-shapes.md.

Transforms per file:
  1. Strip a leading '=' from each formula (UI affordance, not stored).
  2. Strip orchestration modifiers from call sites:
        op.source(...) / op.map(...) / op.expand(...) / op.dataframe(...) /
        op.filter(...) / op.raw_output(...)        →   op(...)
  3. Rewrite the legacy `.output` pseudo-column:
        stepN.output     →   stepN
        stepN.output.col →   stepN["col"]   (best-effort, only single dotted col)
  4. Sanitize step ids that aren't valid Python identifiers:
        step-0-fetch     →   step_0_fetch
  5. Emit the new shape:
        { format_version: 2, name, meta?, steps: [ { name, expression, meta? } ] }
     Drops:  operation_id, config, _orchestrator, step_id, created_at, updated_at, id.
     Keeps label as meta.label.

Run:  python scripts/migrate_workflows.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
MOCK_DIR = ROOT / "mock_projects"

ORCH_MODIFIERS = ("source", "map", "expand", "dataframe", "filter", "raw_output")

# Matches  word(.modifier)(   — captures the function name and the modifier.
_CALL_WITH_MOD = re.compile(
    r"\b([A-Za-z_][A-Za-z0-9_]*)\.(" + "|".join(ORCH_MODIFIERS) + r")\("
)


def strip_orch_modifiers(expr: str) -> str:
    """`op.map(` → `op(`. Idempotent."""
    return _CALL_WITH_MOD.sub(lambda m: f"{m.group(1)}(", expr)


# stepN.output.colname  → stepN["colname"]
_STEP_OUTPUT_DOTTED = re.compile(
    r"\b(step[A-Za-z0-9_]*)\.output\.([A-Za-z_][A-Za-z0-9_]*)"
)
# stepN.output (no following .col)  → stepN
_STEP_OUTPUT_BARE = re.compile(r"\b(step[A-Za-z0-9_]*)\.output\b(?!\.)")


def rewrite_step_output(expr: str) -> str:
    expr = _STEP_OUTPUT_DOTTED.sub(lambda m: f'{m.group(1)}["{m.group(2)}"]', expr)
    expr = _STEP_OUTPUT_BARE.sub(lambda m: m.group(1), expr)
    return expr


def sanitize_ident(name: str) -> str:
    """Python identifier-ify: dashes/dots → underscores, prepend `s_` if it
    would otherwise start with a digit."""
    out = re.sub(r"[^A-Za-z0-9_]", "_", name)
    if not out:
        return "step"
    if out[0].isdigit():
        out = "s_" + out
    return out


def normalize_expression(formula: str) -> str:
    """Apply all expression-body transforms. Strips a leading `=`."""
    s = (formula or "").strip()
    if s.startswith("="):
        s = s[1:].lstrip()
    s = strip_orch_modifiers(s)
    s = rewrite_step_output(s)
    return s


def migrate_step(step: Dict[str, Any]) -> Dict[str, Any]:
    raw_id = step.get("step_id") or step.get("name") or "step"
    new_name = sanitize_ident(raw_id)
    expression = normalize_expression(step.get("formula") or "")

    meta: Dict[str, Any] = {}
    if step.get("label"):
        meta["label"] = step["label"]
    # Carry forward the original opaque id so users can grep their old files
    # if they need to find a renamed step.
    if raw_id != new_name:
        meta["legacy_step_id"] = raw_id

    out: Dict[str, Any] = {
        "name": new_name,
        "expression": expression,
    }
    if meta:
        out["meta"] = meta
    return out


def migrate_workflow(doc: Dict[str, Any]) -> Dict[str, Any]:
    steps = doc.get("steps") or []
    new_steps: List[Dict[str, Any]] = [migrate_step(s) for s in steps]

    new_doc: Dict[str, Any] = {
        "format_version": 2,
        "name": doc.get("name") or doc.get("id") or "Untitled",
    }

    # Free-form workflow metadata — preserve `notes` if present, drop the rest.
    meta: Dict[str, Any] = {}
    if doc.get("notes"):
        meta["notes"] = doc["notes"]
    if doc.get("id"):
        meta["legacy_id"] = doc["id"]
    if meta:
        new_doc["meta"] = meta

    new_doc["steps"] = new_steps
    return new_doc


def main() -> int:
    files = sorted(MOCK_DIR.rglob("*.simple-steps-workflow"))
    if not files:
        print(f"No workflow files found under {MOCK_DIR}", file=sys.stderr)
        return 1

    print(f"Migrating {len(files)} workflow file(s)…\n")
    for path in files:
        try:
            with path.open() as f:
                doc = json.load(f)
        except json.JSONDecodeError as e:
            print(f"  ! {path.relative_to(ROOT)}: invalid JSON ({e}); skipped")
            continue
        if doc.get("format_version") == 2:
            print(f"  · {path.relative_to(ROOT)}: already v2; skipped")
            continue
        new_doc = migrate_workflow(doc)
        with path.open("w") as f:
            json.dump(new_doc, f, indent=2)
            f.write("\n")
        print(f"  ✓ {path.relative_to(ROOT)}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
