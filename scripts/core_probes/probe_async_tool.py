import asyncio, pandas as pd
from simple_steps_core import Kernel, Catalog, tool
from simple_steps_core import mod, wf  # noqa
@tool
def nums() -> pd.DataFrame: return pd.DataFrame({"n": [1, 2]})
@tool
async def slow(n: int) -> int:
    await asyncio.sleep(0.1); return n * 2
k = Kernel(Catalog([nums, slow]))
k["s"] = nums[mod.source()]()
k["t"] = slow[mod.map()](wf["s"])
k.run("t")
st = k.step("t")
print("state", st.state); print(k.view("t")["rows"][0]["cells"])
