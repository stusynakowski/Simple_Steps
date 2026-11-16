import numpy as np, pandas as pd, sys
from simple_steps_core import Kernel, Catalog, tool, mod, wf
from SIMPLE_STEPS.core_bridge import save_with_outputs
@tool
def nums() -> pd.DataFrame: return pd.DataFrame({"n": [1, 2]})
@tool
def img(n: int) -> np.ndarray: return np.zeros((2000, 2000, 3), dtype=np.uint8)
k = Kernel(Catalog([nums, img]))
k["s"] = nums[mod.source()](); k["t"] = img[mod.map()](wf["s"]); k.run("t")
try:
    blob = save_with_outputs(k); import json; print("saved, bytes", len(json.dumps(blob)))
except Exception as e:
    print("save_with_outputs failed:", type(e).__name__, str(e)[:150])
