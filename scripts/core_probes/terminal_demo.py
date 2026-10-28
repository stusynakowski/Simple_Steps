# Core probe (2026-10-26; on core's kernel API 2026-10-27), see docs/core-proposals/011-core-handover.md. Run: .venv/bin/python scripts/core_probes/terminal_demo.py
import pandas as pd
from simple_steps_core import Catalog, Kernel, mod, tool

@tool
def patients():
    return pd.DataFrame({"name": ["Ana", "Ben", "Cy"], "temp_c": [36.6, 38.2, 37.1]})
@tool
def to_f(temp_c: float) -> float:
    return temp_c * 9 / 5 + 32
@tool
def feverish(temp_c: float, limit: float = 38) -> bool:
    return temp_c >= limit

CAT = Catalog(tools=[patients, to_f, feverish])
wf = Kernel(CAT)
wf["p"] = patients[mod.source()]()
wf["sick"] = feverish[mod.filter()](wf["p"])
wf["f"] = to_f[mod.map()](wf["sick"])
wf.run_all()
print(wf.step("f").data)
wf["sick"] = feverish[mod.filter()](wf["p"], limit=37)
print({s.name: s.state for s in wf.steps})
wf.run_all(); print(wf.step("f").data)
wf2 = Kernel.from_json(wf.to_json(), CAT)
wf2.run_all(); print("reloaded", wf2.step("f").data.to_dict("list"))
