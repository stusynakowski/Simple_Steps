"""Uneven data and inverse pairs at core 1.0.2 (spec 020 §10g, §10h).

    .venv/bin/python -I scripts/core_probes/probe_uneven_inverses.py
"""
import pandas as pd
from simple_steps_core import Catalog, Kernel, formula, tool


@tool
def data() -> pd.DataFrame:
    "uneven lists and records"
    return pd.DataFrame({
        "city": ["Oslo", "Rome", "Cairo", "Lima"],
        "temp_c": [4.0, 18.5, 31.2, 19.0],
        "tags": [["cold"], [], ["hot", "dry", "sun"], None],
        "info": [{"pop": 1, "sea": True}, {"pop": 3}, {"sea": False, "nile": True}, {}],
    })


@tool
def each_tag(tags: list | None) -> list:
    "the tags, one per row"
    return list(tags) if tags is not None else []


k = Kernel(Catalog(tools=[data, each_tag]))
k["d"] = formula('data[mod.source()]()')


def show(name, text):
    k[name] = formula(text)
    if k.step(name).problems:
        print(f"{name:10} PROBLEM {[str(p) for p in k.step(name).problems]}")
        return
    try:
        k.run(name)
    except Exception as exc:  # noqa: BLE001
        print(f"{name:10} RAISED {type(exc).__name__}: {exc}")
    v = k.view(name)
    rows = [(r["#"], r["lineage"], {c: (d.get("value"), d.get("state")) for c, d in r["cells"].items()})
            for r in v["rows"]]
    print(f"{name:10} state={k.step(name).state}")
    for row in rows:
        print("            ", row)


# Uneven data
show("expanded", 'each_tag[mod.expand()](wf["d"])')                      # lengths 1, 0, 3, None
show("widened", 'identity[mod.widen(column="info")](wf["d"])')           # different keys

# Inverse pairs
show("packed", 'identity[mod.pack(columns=["city", "temp_c"]), mod.name("rec")](wf["d"])')
show("unpacked", 'identity[mod.widen(column="rec")](wf["packed"])')      # pack then widen
show("sorted", 'identity[mod.sort(by="temp_c")](wf["d"])')
show("parent", 'identity[mod.copy(columns={"#d": "parent"})](wf["expanded"])')
show("regather", 'as_list[mod.collapse(by="parent")](wf["parent"])')     # expand then gather
