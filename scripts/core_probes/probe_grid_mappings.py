"""Run every shape verb and combine on one fixture grid; print how rows,
columns, row ids, lineage and cell provenance map from input to output."""
import json
import pandas as pd
from simple_steps_core import Kernel, Catalog, tool, formula


@tool
def readings() -> pd.DataFrame:
    "the fixture"
    return pd.DataFrame({
        "city": ["Oslo", "Rome", "Oslo", "Cairo"],
        "temp_c": [4.0, 18.5, 6.0, 31.2],
        "tags": [["cold"], ["warm", "sun"], ["cold", "wind"], ["hot"]],
    })


@tool
def more() -> pd.DataFrame:
    "a second source"
    return pd.DataFrame({"city": ["Lima"], "temp_c": [19.0], "tags": [["mild"]]})


@tool
def countries() -> pd.DataFrame:
    "for join"
    return pd.DataFrame({"city": ["Oslo", "Rome", "Cairo"], "country": ["NO", "IT", "EG"]})


@tool
def to_f(temp_c: float) -> float:
    "C to F"
    return round(temp_c * 9 / 5 + 32, 1)


@tool
def is_warm(temp_c: float) -> bool:
    "warm?"
    return temp_c > 10


@tool
def each_tag(tags: list) -> list:
    "the tags, one per row"
    return list(tags)


@tool
def info(city: str) -> dict:
    "a record per city"
    return {"len": len(city), "upper": city.upper()}


@tool
def summary(df: pd.DataFrame) -> pd.DataFrame:
    "the whole table in, a table out"
    return pd.DataFrame({"rows": [len(df)], "mean_c": [round(df["temp_c"].mean(), 2)]})


@tool
def mean_temp(temp_c: list) -> float:
    "the mean of a group's temps"
    return round(sum(temp_c) / len(temp_c), 2)


@tool
def band(temp_c: float) -> str:
    "a key per row"
    return "warm" if temp_c > 10 else "cold"


@tool
def fragile(temp_c: float) -> float:
    "fails on 18.5"
    if temp_c == 18.5:
        raise ValueError("sensor glitch")
    return temp_c


@tool
def half(fragile: float) -> float:
    "reads fragile's output"
    return fragile / 2


k = Kernel(Catalog(tools=[readings, more, countries, to_f, is_warm, each_tag, info, summary, mean_temp,
                          band, fragile, half]))
STEPS = [
    ("r", 'readings[mod.source()]()'),
    ("r2", 'more[mod.source()]()'),
    ("cn", 'countries[mod.source()]()'),
    ("map", 'to_f[mod.map()](wf["r"])'),
    ("filter", 'is_warm[mod.filter()](wf["r"])'),
    ("expand", 'each_tag[mod.expand()](wf["r"])'),
    ("collapse", 'mean_temp[mod.collapse(by="city")](wf["r"])'),
    ("group", 'band[mod.group()](wf["r"])'),
    ("bygroup", 'mean_temp[mod.collapse(by="group")](wf["group"])'),
    ("fragile", 'fragile[mod.map()](wf["r"])'),
    ("half", 'half[mod.map()](wf["fragile"])'),
    ("table", 'summary[mod.table()](wf["r"])'),
    ("sweep", 'to_f[mod.sweep(temp_c=[0.0, 100.0])]()'),
    ("info", 'info[mod.map()](wf["r"])'),
    ("pack", 'identity[mod.pack(columns=["city", "temp_c"]), mod.name("rec")](wf["r"])'),
    ("widen", 'identity[mod.widen(column="rec")](wf["pack"])'),
    ("select", 'identity[mod.select(columns=["city"])](wf["r"])'),
    ("drop", 'identity[mod.drop(columns=["tags"])](wf["r"])'),
    ("rename", 'identity[mod.rename(columns={"temp_c": "t"})](wf["r"])'),
    ("copy", 'identity[mod.copy(columns={"city": "city2"})](wf["r"])'),
    ("sort", 'identity[mod.sort(by="temp_c")](wf["r"])'),
    ("slice", 'identity[mod.slice(start=1, stop=3)](wf["r"])'),
    ("distinct", 'identity[mod.distinct(columns=["city"])](wf["r"])'),
    ("join", 'join(wf["r"], wf["cn"], on="city")'),
    ("stack", 'stack(wf["r"], wf["r2"])'),
    ("zip", 'zip_(wf["r"], wf["map"])'),
]

out = {}
for name, text in STEPS:
    rec = {"formula": text}
    try:
        k[name] = formula(text)
        if k.step(name).problems:
            rec["problems"] = [str(p) for p in k.step(name).problems]
            out[name] = rec
            continue
        try:
            k.run(name)
        except Exception as exc:  # noqa: BLE001
            rec["run_raised"] = f"{type(exc).__name__}: {exc}"
        st = k.step(name)
        data = st.data
        rec["state"] = st.state
        rec["shape"] = list(data.shape)
        rec["columns"] = [str(c) for c in data.columns if not str(c).startswith("#")]
        rec["id_columns"] = [str(c) for c in data.columns if str(c).startswith("#")]
        v = k.view(name)
        rec["rows"] = [{"#": r["#"], "pos": r["position"], "lineage": r.get("lineage"), "state": r.get("state"),
                        "cells": {c: d.get("value") for c, d in r["cells"].items()},
                        "cell_states": {c: d.get("state") for c, d in r["cells"].items()}} for r in v["rows"]]
        try:
            first = v["rows"][0]["#"] if v["rows"] else None
            col = rec["columns"][-1] if rec["columns"] else None
            cell = k.cell(name, 0, col)
            rec["cell0"] = {"column": col, "inputs": [{kk: i.get(kk) for kk in ("step", "row", "columns", "argument", "values")} for i in (cell.get("inputs") or [])],
                            "lineage": cell.get("lineage")}
        except Exception as exc:  # noqa: BLE001
            rec["cell0_error"] = f"{type(exc).__name__}: {exc}"
    except Exception as exc:  # noqa: BLE001
        rec["error"] = f"{type(exc).__name__}: {exc}"
    out[name] = rec

print(json.dumps(out, default=str, indent=1))
