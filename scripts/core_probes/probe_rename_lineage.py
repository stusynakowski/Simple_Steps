# Core probe (2026-10-26; on core's kernel API 2026-10-27), see docs/core-proposals/011-core-handover.md. Run: .venv/bin/python scripts/core_probes/probe_rename_lineage.py
import pandas as pd
from simple_steps_core import Catalog, Kernel, mod, tool
@tool
def make(): return pd.DataFrame({"n": [1, 2]})
@tool
def dbl(n: int) -> int: return n * 2
@tool
def spread(n: int) -> list: return [n, n * 10]
wf = Kernel(Catalog(tools=[make, dbl, spread])); wf["p"] = make[mod.source()](); wf["d"] = dbl[mod.map()](wf["p"]); wf.run_all()
wf.rename("p", "q")
print("after rename:", [s.name for s in wf.steps], "| d formula:", wf.step("d").formula, "| d state:", wf.step("d").state, wf.step("d").problems)
wf2 = Kernel(Catalog(tools=[make, dbl, spread])); wf2["p"] = make[mod.source()](); wf2["e"] = spread[mod.expand()](wf2["p"]); wf2["d"] = dbl[mod.map()](wf2["e"]); wf2.run_all()
print(wf2.step("e").data)
print(wf2.cell("d", 1, "value")); print(wf2.cell("e", 1, "value"))
print("meta keys:", list(wf2.step("e").output.meta), "| states:", type(wf2.step("e").output.states))
