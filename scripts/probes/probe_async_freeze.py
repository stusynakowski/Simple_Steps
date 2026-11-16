"""Does a long run freeze the server for other requests (sync, view, ping)?"""
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

server = uvicorn.Server(uvicorn.Config(app, port=8765, log_level="error"))
threading.Thread(target=server.run, daemon=True).start()
time.sleep(1.5)

c = httpx.Client(base_url="http://127.0.0.1:8765", timeout=60)
c.get("/api/session")  # cookie
steps = [{"id": "a", "name": "s", "formula": "=nums[mod.source()]()"},
         {"id": "b", "name": "t", "formula": '=slow[mod.map()](wf["s"])'}]
body = {"step_id": "b", "formula": steps[1]["formula"], "workflow_key": "w", "workflow_steps": steps}

t0 = time.time()
runner = threading.Thread(target=lambda: print("run   status", c.post("/api/run", json=body).status_code,
                                               f"done at {time.time()-t0:.1f}s"))
runner.start()
time.sleep(0.5)

def timed(label, fn):
    s = time.time()
    r = fn()
    print(f"{label:5} status {r.status_code}  waited {time.time()-s:.1f}s  (at {time.time()-t0:.1f}s)")

c2 = httpx.Client(base_url="http://127.0.0.1:8765", timeout=60, cookies=c.cookies)
c3 = httpx.Client(base_url="http://127.0.0.1:8765", timeout=60)
sync = threading.Thread(target=lambda: timed("sync", lambda: c2.post("/api/workflow/sync",
                        json={"workflow_key": "w", "workflow_steps": steps})))
sync.start()
time.sleep(0.3)
# A request with no kernel involvement at all, from another user:
timed("ping", lambda: c3.get("/api/settings"))
runner.join(); sync.join()
