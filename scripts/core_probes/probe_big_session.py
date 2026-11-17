"""Big sessions on core alone: page views, saving, loading, run-state reads.

Evidence for docs/core-proposals/014-asks-at-adfaf87.md (C50-C52, C49, C48).
Run: python scripts/core_probes/probe_big_session.py [rows ...]  (default 300000 1000000)
"""
import asyncio  # noqa: F401  (the async tool below)
import os
import sys
import tempfile
import time

import numpy as np
import pandas as pd
import simple_steps_core as core
from simple_steps_core import Catalog, Kernel, formula, tool


@tool
def double(x: float) -> float:
    return x * 2


@tool
def img(x: float) -> np.ndarray:
    return np.full((256, 256, 3), int(x) % 255, dtype=np.uint8)


@tool
async def slow(x: float) -> float:
    return x


def timed(fn):
    t = time.perf_counter()
    out = fn()
    return out, time.perf_counter() - t


def mtimes(folder):
    found = {}
    for root, _, files in os.walk(folder):
        for f in files:
            p = os.path.join(root, f)
            found[os.path.relpath(p, folder)] = os.stat(p).st_mtime_ns
    return found


cat = Catalog([double, img])
print(f"core {getattr(core, '__version__', '?')} at {os.path.dirname(core.__file__)}")
print(f"pandas {pd.__version__}, string dtype backed by {type(pd.Series(['a']).array).__name__}")

for n in map(int, sys.argv[1:] or ["300000", "1000000"]):
    k = Kernel(cat)
    k["src"] = pd.DataFrame({"x": np.arange(n, dtype=float)})
    k["d"] = formula('double[mod.map()](wf["src"])')
    k["small"] = pd.DataFrame({"x": [1.0, 2.0, 3.0]})
    k["pics"] = formula('img[mod.map()](wf["small"])')
    k.run_all()
    print(f"\n--- {n:,} rows ---")

    # C50: a 50-row page, in memory, no store, no save
    _, t_view = timed(lambda: k.view("d", (0, 50)))
    _, t_view_src = timed(lambda: k.view("src", (0, 50)))
    _, t_cell = timed(lambda: k.cell("d", 5))
    print(f"C50 k.view('d', (0, 50)) {t_view:.2f}s | k.view('src', (0, 50)) {t_view_src:.2f}s | k.cell('d', 5) {t_cell:.2f}s")

    # C52: reads the app makes after every edit
    _, t_needs = timed(k.needs_run)
    _, t_states = timed(lambda: [k.step(s).state for s in ("src", "d", "small", "pics")])
    _, t_rerun = timed(lambda: k.run("d"))
    print(f"C52 needs_run() {t_needs:.2f}s | four step states {t_states:.2f}s | run('d') when current {t_rerun:.2f}s")

    # C49: saving again
    folder = tempfile.mkdtemp()
    report, t_save = timed(lambda: k.save(folder, outputs=True))
    before = mtimes(folder)
    time.sleep(0.05)
    _, t_resave = timed(lambda: k.save(folder, outputs=True))
    after = mtimes(folder)
    rewritten = sorted(f for f in before if after.get(f) != before[f])
    print(f"C49 save {t_save:.2f}s (exact={report['exact']}) | save again, nothing changed {t_resave:.2f}s, "
          f"rewrote {len(rewritten)} of {len(before)} files: {rewritten}")

    # C51: load
    k2, t_load = timed(lambda: Kernel.load(folder, cat))
    print(f"C51 Kernel.load {t_load:.2f}s | needs_run after load: {k2.needs_run() or 'nothing'}")

# C48: async tools
k = Kernel(Catalog([slow]))
k["s"] = pd.DataFrame({"x": [1.0]})
k["t"] = formula('slow[mod.map()](wf["s"])')
k.run("t")
cell = k.cell("t", 0)
print(f"\nC48 async tool: step {k.step('t').state}, cell holds {type(k.step('t').output.data['t'].iloc[0]).__name__}")
