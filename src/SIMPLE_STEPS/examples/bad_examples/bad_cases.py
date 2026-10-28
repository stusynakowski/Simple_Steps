"""
bad_cases.py — every mistake in the bad examples, with its correction.

One entry per case: the formula written wrong, what Simple Steps does with it
(refuses it, warns, or runs it and fails rows), the words it uses, why, and
the formula written right. Everything else is built from this list:

- ``workspace/projects/bad_examples/mistakes.simple-steps-workflow`` — the
  shared sources, then each case's ``bad`` formula;
- ``workspace/projects/bad_examples/corrected.simple-steps-workflow`` — the
  same sources, then each case's ``fixed`` formula, under the same step name;
- the expectations ``runme.py`` checks, and ``README.md``.

After changing a case, rewrite the workflows and the README::

    python examples/bad_examples/bad_cases.py

``runme.py`` fails if the saved files or the README and this list disagree.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE / "workspace" / "projects" / "bad_examples"


@dataclass(frozen=True)
class Case:
    id: str          # the step's name in both workflows
    category: str
    bad: str         # the formula, written wrong
    kind: str        # "refused" (can't run), "warns" (runs, with a warning), "fails" (rows fail)
    says: str        # words the refusal, warning or row error contains
    why: str
    fixed: str       # the formula, written right


#: Good steps both workflows start with; the cases read them.
SOURCES = [
    ("readings", """to_rows[mod.source()](data='{"city": ["SF", "NYC", "LA"], "n": [1, 0, 2]}')"""),
    ("more", """to_rows[mod.source()](data='{"city": ["BOS"], "n": [5]}')"""),
    ("gappy", """to_rows[mod.source()](data='{"n": [1, null, 3]}')"""),
    ("people", """to_rows[mod.source()](data='{"first": ["Ada", "Bo"]}')"""),
    ("scored", 'double_n[mod.map()](wf["readings"])'),
    ("doubled", 'double_n[mod.map(), mod.name("n")](wf["readings"])'),
]

#: Extra good steps only the corrected workflow needs, before the cases.
CORRECTED_SETUP = [
    ("people_named", 'identity[mod.rename(columns={"first": "name"})](wf["people"])'),
]

CASES = [
    # ── referring to steps ───────────────────────────────────────────────
    Case("bare_name", "Referring to steps",
         'double_n[mod.map()](readings)', "refused", 'readings is not defined. To use the step "readings", write wf["readings"]',
         "A step is only ever wf[\"name\"]; a bare name means nothing.",
         'double_n[mod.map()](wf["readings"])'),
    Case("quoted_name", "Referring to steps",
         'double_n[mod.map()]("readings")', "refused", '"readings" is a string. Did you mean wf["readings"]?',
         "A quoted string is text, never a step.",
         'double_n[mod.map()](wf["readings"])'),
    Case("missing_step", "Referring to steps",
         'double_n[mod.map()](wf["reading"])', "refused", "input 'reading', which is not an earlier step",
         "There's no step called that (a typo), or it hasn't run yet.",
         'double_n[mod.map()](wf["readings"])'),
    Case("two_inputs", "Referring to steps",
         'double_n[mod.map()](wf["readings"], wf["more"])', "refused", 'a step reads one input; to combine steps use join',
         "A step reads one input. Reading several is a combine.",
         'stack(wf["readings"], wf["more"])'),
    Case("row_selection", "Referring to steps",
         'double_n[mod.map()](wf["readings"][0:2])', "refused", "a selection can't be a tool's input",
         "A tool's input is a whole step; make the part its own step (or pass it as an argument, n=wf[\"readings\"][cols[\"n\"]]).",
         'wf["readings"][0:2]'),

    # ── tools and modifiers ──────────────────────────────────────────────
    Case("unknown_tool", "Tools and modifiers",
         'dubble_n[mod.map()](wf["readings"])', "refused", "'dubble_n' is not in this workflow's catalog",
         "The tool name is misspelt.",
         'double_n[mod.map()](wf["readings"])'),
    Case("unknown_modifier", "Tools and modifiers",
         'double_n[mod.mapp()](wf["readings"])', "refused", 'unknown modifier mod.mapp',
         "The modifier name is misspelt.",
         'double_n[mod.map()](wf["readings"])'),
    Case("no_verb", "Tools and modifiers",
         'double_n[mod.retry(times=2)](wf["readings"])', "refused", 'the brackets need a shape verb',
         "retry only wraps a verb; the brackets still need one.",
         'double_n[mod.map(), mod.retry(times=2)](wf["readings"])'),
    Case("misspelt_setting", "Tools and modifiers",
         'double_n[mod.map(nme="doubled")](wf["readings"])', "refused", "map takes no parameter 'nme'; it accepts axis, name, replace, retries",
         "map has no setting nme.",
         'double_n[mod.map(), mod.name("doubled")](wf["readings"])'),
    Case("missing_setting", "Tools and modifiers",
         'double_n[mod.map(), mod.retry()](wf["readings"])', "refused", 'retry needs times= — it has no default',
         "retry has no default number of tries.",
         'double_n[mod.map(), mod.retry(times=2)](wf["readings"])'),
    Case("setting_is_a_step", "Tools and modifiers",
         'identity[mod.sort(by=wf["readings"])](wf["readings"])', "refused", 'mod.sort(by=…) is a setting, and settings are literals',
         "A modifier's settings are literals: sort by a column name.",
         'identity[mod.sort(by="n")](wf["readings"])'),
    Case("not_a_literal", "Tools and modifiers",
         'greet[mod.map()](wf["readings"], name=str.upper("ada"))', "refused", "name: an operation can't be an argument",
         "An argument is a literal or a step — the formula bar runs no code.",
         'greet[mod.map()](wf["readings"], name="ADA")'),

    # ── columns and types ────────────────────────────────────────────────
    Case("missing_column", "Columns and types",
         'identity[mod.select(columns=["score"])](wf["readings"])', "refused", "select names 'score', which the input does not have (it has city, n)",
         "readings has no score column.",
         'identity[mod.select(columns=["n"])](wf["readings"])'),
    Case("parameter_not_a_column", "Columns and types",
         'greet[mod.map()](wf["people"])', "refused", "greet() needs 'name', which 'people' does not have (it has first)",
         "greet reads a name column by name; people calls it first. "
         "Rename it first (people_named).",
         'greet[mod.map()](wf["people_named"])'),
    Case("reads_a_result", "Columns and types",
         'double_n[mod.map()](wf["scored"])', "refused", "double_n() needs 'n', which 'scored' does not have (it has value)",
         "A map step is only its result: scored holds value, not the readings' n. "
         "Read n from readings, or zip_ the two to have both.",
         'double_n[mod.map()](wf["readings"])'),
    Case("zip_shares_a_column", "Columns and types",
         'zip_(wf["readings"], wf["doubled"])', "refused", "zip_: 'n' is in both 'readings' and 'doubled'; rename one",
         "doubled names its result n, like the readings' own n; side by side, one "
         "would have to win. Give the result its own name.",
         'zip_(wf["readings"], wf["scored"])'),
    Case("nullable_column", "Columns and types",
         'add_one[mod.map()](wf["gappy"])', "refused", 'gappy.n can be None, but add_one() takes n: int; accept int | None, or filter the Nones first',
         "gappy.n has a gap, but add_one takes n: int. Use a tool that "
         "accepts int | None.",
         'add_one_or_zero[mod.map()](wf["gappy"])'),
    Case("table_returns_text", "Columns and types",
         'describe_text[mod.table()](wf["readings"])', "fails", 'table expects a DataFrame back, got str',
         "mod.table() makes the tool's DataFrame the step's grid; this tool "
         "returns a sentence.",
         'describe_rows[mod.table()](wf["readings"])'),

    # ── runs, but warns ──────────────────────────────────────────────────
    Case("argument_hides_column", "Runs, but warns",
         'label[mod.map()](wf["readings"], city="Paris")', "warns", "city='Paris' overrides the 'city' column of 'readings' for every row",
         "city=\"Paris\" is used for every row, so the city column is ignored.",
         'label[mod.map()](wf["readings"])'),

    # ── runs, but rows fail ──────────────────────────────────────────────
    Case("uncaught_failure", "Runs, but rows fail",
         'reciprocal[mod.map()](wf["readings"])', "fails", 'ZeroDivisionError: division by zero',
         "NYC's n is 0. A failure nothing catches stops Run All.",
         'reciprocal[mod.map(), mod.try_except(default=0.0)](wf["readings"])'),
]


def _workflow(id_: str, name: str, about: str, steps: list) -> dict:
    return {
        "format_version": 2, "id": id_, "name": name,
        "meta": {"about": about, "built_from": "examples/bad_examples/bad_cases.py"},
        "steps": [{"name": n, "expression": e, "meta": {"label": n}} for n, e in steps],
    }


def workflows() -> dict:
    """The two saved workflows, as this list describes them."""
    return {
        "mistakes": _workflow(
            "mistakes", "Mistakes",
            "Each step after the sources is a mistake Simple Steps refuses, warns about, "
            "or runs with failed rows. Run the steps one at a time: Run All stops at the "
            "first refused step.",
            SOURCES + [(c.id, c.bad) for c in CASES]),
        "corrected": _workflow(
            "corrected", "Corrected",
            "The same steps as mistakes, each written right.",
            SOURCES + CORRECTED_SETUP + [(c.id, c.fixed) for c in CASES]),
    }


README_HEAD = """\
# Bad examples — mistakes, and how to fix them

Each case is a step written wrong, next to the same step written right. What
Simple Steps does with the wrong one is part of the case, in its own words:

- **refused** — the step can't run, and the formula bar says why before
  anything runs;
- **warns** — it runs, but core warns it probably isn't what was meant;
- **rows fail** — it runs, some rows fail, and nothing catches them, so
  **Run All** stops there.

```bash
simple-steps run examples/bad_examples/app.py   # open `mistakes` and run its steps one by one,
                                                # then open `corrected` and press Run All
python examples/bad_examples/runme.py           # check every case
```

`runme.py` checks both directions: each mistake must go wrong the way listed
below, in those words, and each fix must run cleanly — no warning, no failed
row nothing caught — and match its Python twin
([`bad_pipeline.py`](bad_pipeline.py)).

Every case is one entry in [`bad_cases.py`](bad_cases.py); the two workflows
and this file are written from it (`python bad_cases.py`). To add a case,
add an entry there and run that.

"""

KIND = {"refused": "refused", "warns": "warns", "fails": "rows fail"}


def readme() -> str:
    """This example's README, from the cases."""
    lines = [README_HEAD]
    for category in dict.fromkeys(c.category for c in CASES):
        lines += [f"## {category}", "",
                  "| step | written wrong | what happens | why | written right |",
                  "|---|---|---|---|---|"]
        for c in (c for c in CASES if c.category == category):
            lines.append(f"| `{c.id}` | `{_cell(c.bad)}` | **{KIND[c.kind]}**: {_cell(c.says)} "
                         f"| {_cell(c.why)} | `{_cell(c.fixed)}` |")
        lines.append("")
    return "\n".join(lines)


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def write_workflows() -> None:
    PROJECT.mkdir(parents=True, exist_ok=True)
    for name, doc in workflows().items():
        path = PROJECT / f"{name}.simple-steps-workflow"
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {path.relative_to(HERE)}")
    (HERE / "README.md").write_text(readme())
    print("wrote README.md")


if __name__ == "__main__":
    write_workflows()
