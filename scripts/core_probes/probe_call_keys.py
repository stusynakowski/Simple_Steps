"""Change tracking today: edit one source value, see what is flagged and
what is recomputed (008 K31, spec 019 §4.3).

    .venv/bin/python scripts/core_probes/probe_call_keys.py

At core 1.0.2 (dbaf4c7): editing one row flags `f` as a whole, doesn't flag
`h` at all, and a re-run makes 6 tool calls where 2 are needed.
"""
from simple_steps_core import Catalog, Kernel, formula, tool

CALLS = []


@tool
def to_f(temp_c: float) -> float:
    "counted"
    CALLS.append(("to_f", temp_c))
    return temp_c * 9 / 5 + 32


@tool
def half(to_f: float) -> float:
    "counted"
    CALLS.append(("half", to_f))
    return to_f / 2


k = Kernel(Catalog(tools=[to_f, half]))
k["r"] = formula('identity[mod.sweep(temp_c=[1.0, 2.0, 3.0])]()')
k["f"] = formula('to_f[mod.map()](wf["r"])')
k["h"] = formula('half[mod.map()](wf["f"])')
k.run_all()
print("first run calls:", len(CALLS))
CALLS.clear()

k["r"] = formula('identity[mod.sweep(temp_c=[1.0, 20.0, 3.0])]()')   # edit row 1 only
print("states:", {n: k.step(n).state for n in "rfh"})
print("needs_run:", k.needs_run())
k.run_all()
print("re-run calls:", len(CALLS), CALLS)
