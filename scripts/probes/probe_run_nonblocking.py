"""During a long run, does the app still answer, and does Stop stop it? (dev_plan/138 N0, N1, N2)

Run: python scripts/probes/probe_run_nonblocking.py

A 3-row step `s`, then `t` mapping a 2-second tool over it (6 s). While `t`
runs: another user's request, this workflow's sync (an edit), a view of `s`
(finished) and of `t` (running) must each answer in well under a second.
The edit made during the run is applied when it ends. Then a second run is
stopped with /api/run/cancel: it answers 409 RunCancelled, and `t` is staged.
"""
import threading, time
import pandas as pd
import httpx, uvicorn

from SIMPLE_STEPS.decorators import simple_step_tool
from SIMPLE_STEPS import kernels

kernels.PERSIST = False


@simple_step_tool()
def nums() -> pd.DataFrame:
    return pd.DataFrame({"n": [1, 2, 3]})


@simple_step_tool()
def slow(n: int) -> int:
    time.sleep(2)
    return n * 2


from SIMPLE_STEPS.main import app

server = uvicorn.Server(uvicorn.Config(app, port=8766, log_level="error"))
threading.Thread(target=server.run, daemon=True).start()
time.sleep(1.5)

BASE = "http://127.0.0.1:8766"
c = httpx.Client(base_url=BASE, timeout=60)
c.get("/api/session")  # cookie
other = httpx.Client(base_url=BASE, timeout=60)          # another user
me = httpx.Client(base_url=BASE, timeout=60, cookies=c.cookies)

steps = [{"id": "a", "name": "s", "formula": "=nums[mod.source()]()"},
         {"id": "b", "name": "t", "formula": '=slow[mod.map()](wf["s"])'}]
run_body = {"step_id": "b", "formula": steps[1]["formula"], "workflow_key": "w", "workflow_steps": steps}
me.post("/api/workflow/sync", json={"workflow_key": "w", "workflow_steps": steps})
me.post("/api/run", json={**run_body, "step_id": "a", "formula": steps[0]["formula"]})   # s runs first

results = {}
fails = []


def timed(label, fn, limit=1.0):
    t = time.time()
    r = fn()
    took = time.time() - t
    ok = took < limit
    if not ok:
        fails.append(label)
    print(f"  {label:34} {r.status_code}  {took * 1000:6.0f} ms  {'ok' if ok else 'TOO SLOW'}")
    return r


print("1. A 6 s run of t; while it runs:")
t0 = time.time()
runner = threading.Thread(target=lambda: results.update(run=c.post("/api/run", json=run_body)))
runner.start()
time.sleep(0.6)
timed("another user's request", lambda: other.get("/api/settings"))
timed("connection check", lambda: me.get("/api/session"))
edited = [steps[0], {**steps[1], "id": "b"}, {"id": "c", "name": "u", "formula": "=7"}]
r = timed("sync (an edit: adds step u)", lambda: me.post(
    "/api/workflow/sync", json={"workflow_key": "w", "workflow_steps": edited}))
print(f"     busy={r.json().get('busy')} running={r.json().get('running')}")
r = timed("view of s (finished)", lambda: me.get("/api/view", params={"workflow_key": "w", "step": "s"}))
print(f"     state={r.json()['state']} cells={[x['value'] for x in r.json()['cells']]}")
r = timed("view of t (running)", lambda: me.get("/api/view", params={"workflow_key": "w", "step": "t"}))
print(f"     state={r.json()['state']} running={r.json()['running']} cells={[x['state'] for x in r.json()['cells']]}")
runner.join()
run = results["run"]
print(f"   run answered {run.status_code} at {time.time() - t0:.1f} s; "
      f"step u (the queued edit) in its states: {'u' in run.json()['metrics']['steps']}")
if "u" not in run.json()["metrics"]["steps"]:
    fails.append("queued edit")

print("2. Run t again (force) and stop it after 1 s:")
t0 = time.time()
runner = threading.Thread(target=lambda: results.update(run=c.post("/api/run", json={**run_body, "workflow_steps": edited, "force": True})))
runner.start()
time.sleep(1.0)
timed("cancel", lambda: me.post("/api/run/cancel", json={"workflow_key": "w"}))
runner.join()
run = results["run"]
print(f"   run answered {run.status_code} {run.json().get('error_type')} at {time.time() - t0:.1f} s: {run.json().get('detail')}")
states = me.post("/api/workflow/sync", json={"workflow_key": "w", "workflow_steps": edited}).json()["steps"]
cells = me.get("/api/view", params={"workflow_key": "w", "step": "t"}).json()["cells"]
print(f"   t after: {states['t']['status']}, cells {[(x['value'], x['state']) for x in cells]} (its previous result, kept)")
if run.status_code != 409 or states["t"]["status"] != "completed" or [x["value"] for x in cells] != [2, 4, 6]:
    fails.append("cancel a re-run")

print("3. Run a step that never ran, v, and stop it after 1 s:")
fresh = edited + [{"id": "d", "name": "v", "formula": '=slow[mod.map()](wf["s"])'}]
runner = threading.Thread(target=lambda: results.update(run=c.post("/api/run", json={
    **run_body, "step_id": "d", "formula": fresh[-1]["formula"], "workflow_steps": fresh})))
runner.start()
time.sleep(1.0)
me.post("/api/run/cancel", json={"workflow_key": "w"})
runner.join()
states = me.post("/api/workflow/sync", json={"workflow_key": "w", "workflow_steps": fresh}).json()["steps"]
print(f"   run answered {results['run'].status_code}; v after: {states['v']['status']}")
if results["run"].status_code != 409 or states["v"]["status"] != "staged":
    fails.append("cancel a first run")
print(f"   cancel with nothing running: {me.post('/api/run/cancel', json={'workflow_key': 'w'}).json()}")

print("\nPASS" if not fails else f"\nFAIL: {fails}")
