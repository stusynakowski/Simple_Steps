"""Evidence for the app's asks of core in docs/core-proposals/015 (C53, C55–C59).

Run against core alone:  python scripts/core_probes/probe_editing_asks.py

Each section prints what core does today; 015 quotes the output.
"""
import json
import threading
import time

import numpy as np
import pandas as pd
import simple_steps_core as c
from simple_steps_core import Catalog, Kernel, formula


@c.tool
def to_f(temp_c: float, offset: float = 0.0) -> float:
    return temp_c * 9 / 5 + 32 + offset


RECEIVED = []


@c.tool
def arr(m: np.ndarray) -> str:
    RECEIVED.append(type(m).__name__)
    return type(m).__name__


@c.tool
def slow(a: float) -> float:
    time.sleep(0.01)
    return a * 2


def js(x) -> str:
    return json.dumps(x, default=str)


print(f"core {c.__version__}\n")
k = Kernel(Catalog([to_f, arr, slow]))
k["p"] = pd.DataFrame({"name": ["a", "b", "c"], "temp_c": [10.0, 38.2, 20.0]})
k["f"] = formula('to_f[mod.map()](wf["p"], offset=1.0)')
k.run("f")

print("C55. What k.cell gives for one cell (no expression for the cell itself):")
cell = k.cell("f", 1, "f")
print("  keys:", sorted(cell))
print("  value:", cell["value"], "| inputs:", js(cell["inputs"]))

print("\nC57. k.cell inputs for a step reading a slice, g = to_f[mod.map()](wf['f'][1:3]):")
k["g"] = formula('to_f[mod.map()](wf["f"][1:3])')
k.run("g")
g0 = k.cell("g", 0, "g")
print("  g[0] lineage:", js(g0["lineage"]))
print("  g[0] inputs: ", js([{x: i.get(x) for x in ("step", "row", "rows", "row_numbers")} for i in g0["inputs"]]))

print("\nC53. Clearing: set the step to None, then put its formula back:")
op = k.step("f").operation
k["f"] = None
print("  after None:", k.step("f").state, "| g:", k.step("g").state)
k["f"] = op
print("  formula back:", k.step("f").state, "| values:", k.step("f").data.iloc[:, 0].tolist())
print("  Kernel methods named clear/reset/drop:",
      [m for m in dir(Kernel) if any(w in m for w in ("clear", "reset", "drop", "invalidate"))])

print("\nC56. The existing mod.copy:")
k["q"] = formula('identity[mod.copy()](wf["p"])')
try:
    k.run("q")
    print("  ran:", k.step("q").state)
except Exception as exc:
    print("  ", str(exc)[:160])

print("\nC58. A tool typed np.ndarray, under mod.table():")
k["n"] = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
k["t"] = formula('arr[mod.table()](wf["n"][1:3])')
k.run("t")
print("  the tool was called with:", RECEIVED, "| step:", k.step("t").state,
      "(it returned text, not a table: a separate, correct refusal)")

print("\nC59. Reads from another thread while k.run runs:")
k["src"] = pd.DataFrame({"a": [float(i) for i in range(300)]})
k.run("src")
k["d"] = formula('slow[mod.map()](wf["src"])')
done = threading.Event()
t = threading.Thread(target=lambda: (k.run("d"), done.set()))
t.start()
reads, errors = 0, []
while not done.is_set():
    for read in (lambda: k.view("src", (0, 50)), lambda: k.view("d", (0, 50)),
                 lambda: [s.state for s in k.steps], k.needs_run, lambda: k.cell("src", 3, "a")):
        try:
            read()
            reads += 1
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
t.join()
print(f"  {reads} reads during the run, {len(errors)} errors {errors[:2]}")
