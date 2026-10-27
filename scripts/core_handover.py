#!/usr/bin/env python3
"""Build build/core-handover/: one folder to copy into simple-steps-core.

Everything in it is copied or cut from this repo's current files, so rerun
this after any of them changes rather than editing the folder. What goes in,
and why, is docs/core-proposals/011-core-handover.md.

    python scripts/core_handover.py            # -> build/core-handover/
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "core-handover"

CODE_TO_PORT = [
    "src/SIMPLE_STEPS/operation_formula.py",
    "src/SIMPLE_STEPS/agent/proposals.py",
    "src/SIMPLE_STEPS/application.py",
    "src/SIMPLE_STEPS/kernels.py",
    "src/SIMPLE_STEPS/core_bridge.py",
]

CORE_RULES = """# Rules for simple-steps-core

Carried over from Simple Steps (docs/core-proposals/011-core-handover.md).

- The grid is the only model. Anything that isn't the grid model is moved
  onto it or removed.
- Verify a claim by running it, never by reading docs.
- No mutable state at module level: everything a workflow uses hangs off its
  kernel (K24).
- An empty step is a 1x1 frame with one cell "empty", never a placeholder.
- Extras live under a namespace and are never hashed (K21).
- Each behaviour change is confirmed in small pieces.
"""


def section(path: str, start: str, stop: str | None) -> str:
    """The text of *path* from the heading starting with *start* up to *stop*."""
    text = (ROOT / path).read_text()
    begin = re.search(rf"^#+ {re.escape(start)}", text, re.M)
    if begin is None:
        sys.exit(f"core_handover: heading {start!r} not found in {path}")
    rest = text[begin.start():]
    if stop is not None:
        end = re.search(rf"^#+ {re.escape(stop)}", rest[1:], re.M)
        if end is None:
            sys.exit(f"core_handover: heading {stop!r} not found in {path}")
        rest = rest[: end.start() + 1]
    return f"<!-- from {path} -->\n\n{rest.rstrip()}\n"


def write(name: str, *parts: str) -> None:
    (OUT / name).write_text("\n\n".join(parts))


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "code-to-port").mkdir(parents=True)

    readme = (ROOT / "docs/core-proposals/011-core-handover.md").read_text()
    write("README.md",
          "> Built by `scripts/core_handover.py` in Simple Steps. Files here:\n"
          "> `plan.md` (1), `requests.md` (2), `words-and-rules.md` (3),\n"
          "> `code-to-port/` (4), `probes/` (5), `CLAUDE.md` (6). Links below\n"
          "> point into the Simple Steps repo.\n",
          readme)
    write("plan.md", section("docs/system_design/12-core-and-app.md",
                             "The core update", "Open asks of core"))
    write("requests.md",
          section("docs/core-proposals/008-core-changes.md", "Priority 4", "Suggested order"))
    shutil.copy(ROOT / "docs/core-proposals/008-core-changes.md", OUT / "008-core-changes-full.md")
    write("words-and-rules.md",
          section("docs/why-we-are-building-this.md", "Words and what they mean", "How the pieces split"),
          section("docs/why-we-are-building-this.md", "What is acceptable", "Words and what they mean"),
          section("docs/how-simple-steps-works.md", "The step expression", "2. The developer"))
    for path in CODE_TO_PORT:
        shutil.copy(ROOT / path, OUT / "code-to-port" / Path(path).name)
    shutil.copytree(ROOT / "scripts/core_probes", OUT / "probes",
                    ignore=shutil.ignore_patterns("__pycache__"))
    (OUT / "CLAUDE.md").write_text(CORE_RULES)

    for f in sorted(OUT.rglob("*")):
        if f.is_file():
            print(f.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
