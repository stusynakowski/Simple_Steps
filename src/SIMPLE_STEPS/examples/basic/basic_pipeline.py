"""
basic_pipeline.py — the basic example's workflows, written in Python.

Each saved workflow in ``workspace/projects/basic/`` has a *twin* here: the
same steps, one Python line per step, in simple-steps-core's syntax. The
formula a step saves is exactly the right-hand side of its line::

    saved:   scale[mod.map(), mod.name("score")](wf["readings"])
    Python:  wf["score"] = scale[mod.map(), mod.name("score")](wf["readings"])

``runme.py`` runs both — the saved file through the app, the twin straight in
core — and checks every step's output is the same. The twin imports the
app's own tools, so the two run the same code.
"""

from __future__ import annotations

from simple_steps_core import Kernel
from simple_steps_core import join, mod, op, stack, zip_

from SIMPLE_STEPS.catalog import catalog

from SIMPLE_STEPS.operations import to_rows

from basic_tools import (add_computed, add_n, bucket_score, build_record, classify_age,
                         count_by, describe_table, empty_table, fan_out, grid_cell, is_big,
                         label_city, make_coords, make_pair, make_range, make_series,
                         reverse_text, risky, sample_people, scale, slow_double,
                         sometimes_fails, split_text, to_upper, top_n, word_count)

# core's built-in tools, by name, as core's own example writes them
identity, count, gather, total, first, last = (
    op(name) for name in ("identity", "count", "gather", "total", "first", "last"))

READINGS = '{"city": ["SF", "NYC", "SF", "LA"], "n": [1, 2, 3, 2]}'


def build_all_orchestrations() -> Kernel:
    """``all-orchestrations``: every shape verb, the combine verbs, execution
    modifiers, verb inference and standard Python values as sources —
    simple-steps-core's own ``all_orchestrations`` example, step for step."""
    wf = Kernel(catalog())

    # sources: a table from JSON text, and a column of records
    wf["readings"] = to_rows[mod.source()](data=READINGS)
    wf["records"] = to_rows[mod.source()](data='{"value": [{"city": "SF", "temp": 18.0}, {"city": "NYC", "temp": 31.0}]}')

    # map: one value per row. A map step is only its results (the `score`
    # column), on the readings' row ids; zip_ puts the two side by side.
    wf["score"] = scale[mod.map(), mod.name("score")](wf["readings"])
    wf["scored"] = zip_(wf["readings"], wf["score"])

    # rows: filter, slice, sort, distinct (no tool runs for the last three)
    wf["kept"] = is_big[mod.filter()](wf["scored"])
    wf["head2"] = identity[mod.slice(stop=2)](wf["scored"])
    wf["ranked"] = identity[mod.sort(by="score", ascending=False)](wf["scored"])
    wf["unique_city"] = identity[mod.distinct(columns=["city"])](wf["scored"])

    # columns: select, drop, rename
    wf["picked"] = identity[mod.select(columns=["city", "score"])](wf["scored"])
    wf["dropped"] = identity[mod.drop(columns=["score"])](wf["scored"])
    wf["renamed"] = identity[mod.rename(columns={"n": "count"})](wf["scored"])

    # group, then collapse per group. group keeps each row's columns and adds
    # its key; the collapse reads it directly.
    wf["bucket"] = label_city[mod.group(), mod.name("bucket")](wf["scored"])
    wf["per_city"] = add_n[mod.collapse(by="bucket", initial=0)](wf["bucket"])

    # collapse to one row: a builtin reducer and a tool
    wf["n_rows"] = count[mod.collapse()](wf["readings"])
    wf["sum_n"] = add_n[mod.collapse(initial=0)](wf["readings"])

    # expand (one row → many), and expand then widen
    wf["bursts"] = fan_out[mod.expand(), mod.name("item")](wf["readings"])
    wf["coords"] = make_coords[mod.expand()](wf["readings"])
    wf["spread"] = identity[mod.widen(columns=["axis", "val"])](wf["coords"])
    wf["wide"] = identity[mod.widen(columns=["city", "temp"])](wf["records"])

    # sweep: the cross product of parameters, no input
    wf["grid_search"] = grid_cell[mod.sweep(model=["a", "b"], window=[7, 30])]

    # execution modifiers around a map
    wf["robust"] = scale[mod.map(), mod.name("score"), mod.retry(times=2), mod.timeout(seconds=5)](wf["readings"])

    # verb inference: no brackets, core picks the verb from the tool
    wf["auto_map"] = scale(wf["readings"])
    wf["auto_filter"] = is_big(wf["readings"])
    wf["auto_collapse"] = add_n(wf["readings"])
    wf["auto_expand"] = fan_out(wf["readings"])

    # plain Python values as sources: each is one cell, then reshaped
    wf["a_list"] = [1, 2, 3, 4]
    wf["a_dict"] = {"x": 10, "y": 20}
    wf["a_scalar"] = 7
    wf["from_list"] = identity[mod.expand()](wf["a_list"])
    wf["from_dict"] = identity[mod.widen(columns=["x", "y"])](wf["a_dict"])

    # tuples widen by position (c0, c1)
    wf["pairs"] = make_pair[mod.map()](wf["readings"])
    wf["split"] = identity[mod.widen()](wf["pairs"])

    # builtin reducers over one column
    wf["ns"] = identity[mod.select(columns=["n"])](wf["readings"])
    wf["gathered"] = gather[mod.collapse()](wf["ns"])
    wf["total_n"] = total[mod.collapse()](wf["ns"])
    wf["first_n"] = first[mod.collapse()](wf["ns"])
    wf["last_n"] = last[mod.collapse()](wf["ns"])

    # a map over a map
    wf["again"] = scale[mod.map(), mod.name("again")](wf["scored"])

    # combine verbs: read more than one step
    wf["city_info"] = to_rows[mod.source()](data='{"city": ["SF", "NYC", "LA"], "region": ["west", "east", "west"]}')
    wf["more"] = to_rows[mod.source()](data='{"city": ["BOS", "SEA"], "n": [5, 6]}')
    wf["enriched"] = join(wf["readings"], wf["city_info"], on="city", how="left")
    wf["all_readings"] = stack(wf["readings"], wf["more"])
    wf["scores_only"] = identity[mod.select(columns=["score"])](wf["scored"])
    wf["zipped"] = zip_(wf["ns"], wf["scores_only"])

    # failure: risky raises on n == 2; try_except lets those rows through
    wf["failure"] = risky[mod.map(), mod.name("out"), mod.try_except(), mod.retry(times=1)](wf["readings"])
    return wf


def build_table_tools() -> Kernel:
    """``table-tools``: the data-manipulation tools — sources, per-row tools,
    whole-table tools (``mod.table()``) and diagnostics."""
    wf = Kernel(catalog())

    # numbers: per-row tools, a caught failure, a list fanned out to rows
    wf["numbers"] = make_range[mod.source()](n=6, start=1)
    wf["doubled"] = slow_double[mod.map(), mod.name("doubled")](wf["numbers"], delay_ms=0)
    wf["checked"] = sometimes_fails[mod.map(), mod.name("checked"), mod.try_except(default=-1)](wf["numbers"])
    wf["series"] = make_series[mod.expand(), mod.name("item")](wf["numbers"], length=2)

    # people: per-row analysis, then whole-table tools
    wf["people"] = sample_people[mod.source()](count=8, seed=0)
    wf["staged"] = classify_age[mod.map(), mod.name("stage")](wf["people"])
    wf["banded"] = bucket_score[mod.map(), mod.name("band")](wf["people"], scheme="halves")
    wf["top3"] = top_n[mod.table()](wf["people"], column="score", n=3)
    wf["per_city"] = count_by[mod.table()](wf["people"], column="city")
    wf["ages"] = add_computed[mod.table()](wf["people"], source_column="age", new_column="age_x2", operation="double")
    wf["described"] = describe_table[mod.table()](wf["people"])

    # text: one row per piece, then per-row text tools
    wf["words"] = split_text[mod.source()](text="alpha beta,gamma,delta epsilon zeta")
    wf["counted"] = word_count[mod.map(), mod.name("words")](wf["words"])
    wf["shout"] = to_upper[mod.map(), mod.name("upper")](wf["words"])
    wf["backward"] = reverse_text[mod.map(), mod.name("reversed")](wf["words"])
    wf["as_values"] = identity[mod.rename(columns={"text": "value"})](wf["words"])
    wf["records"] = build_record[mod.map(), mod.name("record")](wf["as_values"])

    # empty in, empty out
    wf["empty"] = empty_table[mod.source()](columns="a,b")
    wf["empty_described"] = describe_table[mod.table()](wf["empty"])
    return wf
