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


## Referring to steps

| step | written wrong | what happens | why | written right |
|---|---|---|---|---|
| `bare_name` | `double_n[mod.map()](readings)` | **refused**: readings is not defined. To use the step "readings", write wf["readings"] | A step is only ever wf["name"]; a bare name means nothing. | `double_n[mod.map()](wf["readings"])` |
| `quoted_name` | `double_n[mod.map()]("readings")` | **refused**: "readings" is a string. Did you mean wf["readings"]? | A quoted string is text, never a step. | `double_n[mod.map()](wf["readings"])` |
| `missing_step` | `double_n[mod.map()](wf["reading"])` | **refused**: input 'reading', which is not an earlier step | There's no step called that (a typo), or it hasn't run yet. | `double_n[mod.map()](wf["readings"])` |
| `two_inputs` | `double_n[mod.map()](wf["readings"], wf["more"])` | **refused**: a step reads one input; to combine steps use join | A step reads one input. Reading several is a combine. | `stack(wf["readings"], wf["more"])` |
| `row_selection` | `double_n[mod.map()](wf["readings"][0:2])` | **refused**: a selection can't be a tool's input | A tool's input is a whole step; make the part its own step (or pass it as an argument, n=wf["readings"][cols["n"]]). | `wf["readings"][0:2]` |

## Tools and modifiers

| step | written wrong | what happens | why | written right |
|---|---|---|---|---|
| `unknown_tool` | `dubble_n[mod.map()](wf["readings"])` | **refused**: 'dubble_n' is not in this workflow's catalog | The tool name is misspelt. | `double_n[mod.map()](wf["readings"])` |
| `unknown_modifier` | `double_n[mod.mapp()](wf["readings"])` | **refused**: unknown modifier mod.mapp | The modifier name is misspelt. | `double_n[mod.map()](wf["readings"])` |
| `no_verb` | `double_n[mod.retry(times=2)](wf["readings"])` | **refused**: the brackets need a shape verb | retry only wraps a verb; the brackets still need one. | `double_n[mod.map(), mod.retry(times=2)](wf["readings"])` |
| `misspelt_setting` | `double_n[mod.map(nme="doubled")](wf["readings"])` | **refused**: map takes no parameter 'nme'; it accepts axis, name, replace, retries | map has no setting nme. | `double_n[mod.map(), mod.name("doubled")](wf["readings"])` |
| `missing_setting` | `double_n[mod.map(), mod.retry()](wf["readings"])` | **refused**: retry needs times= — it has no default | retry has no default number of tries. | `double_n[mod.map(), mod.retry(times=2)](wf["readings"])` |
| `setting_is_a_step` | `identity[mod.sort(by=wf["readings"])](wf["readings"])` | **refused**: mod.sort(by=…) is a setting, and settings are literals | A modifier's settings are literals: sort by a column name. | `identity[mod.sort(by="n")](wf["readings"])` |
| `not_a_literal` | `greet[mod.map()](wf["readings"], name=str.upper("ada"))` | **refused**: name: an operation can't be an argument | An argument is a literal or a step — the formula bar runs no code. | `greet[mod.map()](wf["readings"], name="ADA")` |

## Columns and types

| step | written wrong | what happens | why | written right |
|---|---|---|---|---|
| `missing_column` | `identity[mod.select(columns=["score"])](wf["readings"])` | **refused**: select names 'score', which the input does not have (it has city, n) | readings has no score column. | `identity[mod.select(columns=["n"])](wf["readings"])` |
| `parameter_not_a_column` | `greet[mod.map()](wf["people"])` | **refused**: greet() needs 'name', which 'people' does not have (it has first) | greet reads a name column by name; people calls it first. Rename it first (people_named). | `greet[mod.map()](wf["people_named"])` |
| `reads_a_result` | `double_n[mod.map()](wf["scored"])` | **refused**: double_n() needs 'n', which 'scored' does not have (it has value) | A map step is only its result: scored holds value, not the readings' n. Read n from readings, or zip_ the two to have both. | `double_n[mod.map()](wf["readings"])` |
| `zip_shares_a_column` | `zip_(wf["readings"], wf["doubled"])` | **refused**: zip_: 'n' is in both 'readings' and 'doubled'; rename one | doubled names its result n, like the readings' own n; side by side, one would have to win. Give the result its own name. | `zip_(wf["readings"], wf["scored"])` |
| `nullable_column` | `add_one[mod.map()](wf["gappy"])` | **refused**: gappy.n can be None, but add_one() takes n: int; accept int \| None, or filter the Nones first | gappy.n has a gap, but add_one takes n: int. Use a tool that accepts int \| None. | `add_one_or_zero[mod.map()](wf["gappy"])` |
| `table_returns_text` | `describe_text[mod.table()](wf["readings"])` | **rows fail**: table expects a DataFrame back, got str | mod.table() makes the tool's DataFrame the step's grid; this tool returns a sentence. | `describe_rows[mod.table()](wf["readings"])` |

## Runs, but warns

| step | written wrong | what happens | why | written right |
|---|---|---|---|---|
| `argument_hides_column` | `label[mod.map()](wf["readings"], city="Paris")` | **warns**: city='Paris' overrides the 'city' column of 'readings' for every row | city="Paris" is used for every row, so the city column is ignored. | `label[mod.map()](wf["readings"])` |

## Runs, but rows fail

| step | written wrong | what happens | why | written right |
|---|---|---|---|---|
| `uncaught_failure` | `reciprocal[mod.map()](wf["readings"])` | **rows fail**: ZeroDivisionError: division by zero | NYC's n is 0. A failure nothing catches stops Run All. | `reciprocal[mod.map(), mod.try_except(default=0.0)](wf["readings"])` |
