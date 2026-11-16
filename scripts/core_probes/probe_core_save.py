import json, tempfile, numpy as np, pandas as pd
from simple_steps_core import Kernel, Catalog, tool, mod, wf
@tool
def dbl(n: int) -> int: return n * 2
@tool
def img(n: int) -> np.ndarray: return np.zeros((500, 500, 3), dtype=np.uint8) + n
k = Kernel(Catalog([dbl, img]))
k["d"] = pd.DataFrame({"n": [1, 2], "pic": [np.ones((4, 4), np.uint8), np.zeros((4, 4), np.uint8)]})
k["t"] = dbl[mod.map()](wf["d"]); k["i"] = img[mod.map()](wf["d"])
k.run_all()
try: k.view("i"); print("view of array step: ok")
except Exception as e: print("view of array step:", type(e).__name__, str(e)[:80])
f = tempfile.mkdtemp()
rep = k.save(f); print("report:", json.dumps(rep, default=str)[:400])
import os; print("files:", sorted(os.path.relpath(os.path.join(r, x), f) for r, _, xs in os.walk(f) for x in xs))
k2 = Kernel.load(f, Catalog([dbl, img]))
print("loaded states:", {s.name: s.state for s in k2.steps})
print("d pic restored as:", type(k2.step("d").data["pic"].iloc[0]).__name__ if "pic" in k2.step("d").data else "missing")
