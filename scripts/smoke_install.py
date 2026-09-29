#!/usr/bin/env python3
"""
smoke_install.py — build a wheel, install it into a clean virtualenv, launch
the server, and drive a workflow through the HTTP API.

This tests what a user actually does. Running pytest against the source tree
tells you nothing about whether the wheel ships the frontend bundle, whether
the console scripts registered, or whether the package imports on a machine
that has never seen the repo.

    python scripts/smoke_install.py
    python scripts/smoke_install.py --python python3.12   # pick an interpreter
    python scripts/smoke_install.py --keep                # don't delete the venv

Exit code is 0 only if every stage passes. Intended for CI as well as local use,
and written with no shell dependencies so it runs the same on Windows.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import http.cookiejar
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Stages are reported individually so a failure says which step broke.
PASSED: list[str] = []
FAILED: list[tuple[str, str]] = []


def report(stage: str, ok: bool, detail: str = "") -> bool:
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {stage}" + (f" — {detail}" if detail and not ok else ""))
    (PASSED if ok else FAILED).append(stage if ok else (stage, detail))
    return ok


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def venv_bin(venv: Path, name: str) -> Path:
    """Resolve an executable inside a venv, cross-platform."""
    if os.name == "nt":
        exe = venv / "Scripts" / f"{name}.exe"
        return exe if exe.exists() else venv / "Scripts" / name
    return venv / "bin" / name


# Session identity is a server-issued HttpOnly cookie (`ss_session`), and the
# payload store is scoped to it. Without a cookie jar, the request that reads a
# step's output lands in a different session and correctly 404s.
_OPENER = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)


def http_get(url: str, timeout: float = 5.0) -> tuple[int, bytes]:
    try:
        with _OPENER.open(url, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_post(url: str, payload: dict, timeout: float = 20.0) -> tuple[int, bytes]:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--python", default=sys.executable,
                    help="interpreter used to create the clean venv")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--keep", action="store_true",
                    help="keep the temporary venv for inspection")
    args = ap.parse_args()

    work = Path(tempfile.mkdtemp(prefix="simple-steps-smoke-"))
    venv = work / "venv"
    dist = work / "dist"
    server = None

    print(f"\nSimple Steps — clean install smoke test")
    print(f"  repo:    {REPO_ROOT}")
    print(f"  python:  {args.python}")
    print(f"  scratch: {work}\n")

    try:
        # ── 1. interpreter version ──────────────────────────────────────
        v = run([args.python, "-c",
                 "import sys; print('%d.%d' % sys.version_info[:2])"])
        version = v.stdout.strip()
        major, minor = (int(x) for x in version.split("."))
        report("interpreter is >= 3.10", (major, minor) >= (3, 10),
               f"found {version}; simple-steps-core requires >= 3.10")

        # ── 2. build the wheel ──────────────────────────────────────────
        b = run([sys.executable, "-m", "build", "--wheel", "--outdir", str(dist)],
                cwd=REPO_ROOT)
        wheels = list(dist.glob("*.whl"))
        if not report("wheel builds", b.returncode == 0 and bool(wheels),
                      (b.stderr or b.stdout)[-400:]):
            return 1
        wheel = wheels[0]

        # ── 3. the wheel must carry the built frontend ──────────────────
        import zipfile
        with zipfile.ZipFile(wheel) as z:
            names = z.namelist()
        has_ui = any("frontend_dist/index.html" in n for n in names)
        report("wheel contains frontend_dist/index.html", has_ui,
               "the UI will 404 — run the frontend build before packaging")
        strays = sorted({
            n.split("/")[0] for n in names
            if "/" in n and not n.startswith(("SIMPLE_STEPS/", "simple_steps-"))
        })
        report("wheel ships no stray top-level packages", not strays,
               f"would pollute site-packages: {', '.join(strays)}")

        # ── 4. clean venv + install ─────────────────────────────────────
        c = run([args.python, "-m", "venv", str(venv)])
        if not report("clean venv created", c.returncode == 0, c.stderr[-300:]):
            return 1
        pip = str(venv_bin(venv, "pip"))
        run([pip, "install", "--upgrade", "-q", "pip"])
        i = run([pip, "install", str(wheel)])
        if not report("wheel installs", i.returncode == 0,
                      (i.stderr or i.stdout)[-600:]):
            return 1

        # ── 5. imports outside the source tree ──────────────────────────
        py = str(venv_bin(venv, "python"))
        m = run([py, "-c",
                 "from SIMPLE_STEPS.main import app; "
                 "from SIMPLE_STEPS.decorators import OPERATION_REGISTRY as R; "
                 "print(len(R))"], cwd=str(work))
        n_ops = m.stdout.strip().splitlines()[-1] if m.returncode == 0 else "?"
        report("package imports outside the repo", m.returncode == 0,
               (m.stderr or "")[-500:])

        # ── 6. console scripts ──────────────────────────────────────────
        for script in ("simple-steps", "simple-steps-local", "simple-steps-dev"):
            exe = venv_bin(venv, script)
            if not exe.exists():
                report(f"console script `{script}` exists", False, "not installed")
                continue
            s = run([str(exe), "--help"], cwd=str(work))
            report(f"console script `{script}` runs", s.returncode == 0,
                   (s.stderr or s.stdout)[-200:])

        # ── 7. serve ────────────────────────────────────────────────────
        base = f"http://127.0.0.1:{args.port}"
        logfile = work / "server.log"
        with open(logfile, "w") as log:
            server = subprocess.Popen(
                [py, "-m", "uvicorn", "SIMPLE_STEPS.main:app",
                 "--host", "127.0.0.1", "--port", str(args.port)],
                cwd=str(work), stdout=log, stderr=subprocess.STDOUT,
            )
        up = False
        for _ in range(40):
            if server.poll() is not None:
                break
            try:
                if http_get(f"{base}/api/operations", timeout=1.0)[0] == 200:
                    up = True
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not report("server starts and serves /api/operations", up,
                      logfile.read_text()[-600:]):
            return 1

        # ── 8. the palette is real ──────────────────────────────────────
        _, body = http_get(f"{base}/api/operations")
        ops = json.loads(body)
        report("palette is non-empty", len(ops) > 0, f"got {len(ops)}")
        placeholders = [o["id"] for o in ops if str(o["id"]).endswith("_preview")]
        report("palette has no placeholder operations", not placeholders,
               f"{len(placeholders)} ops raise NotImplementedError: "
               f"{', '.join(placeholders[:5])}")

        # ── 9. the UI is served ─────────────────────────────────────────
        status, page = http_get(f"{base}/")
        report("UI is served at /", status == 200 and len(page) > 0,
               f"HTTP {status}")

        # ── 10. run a step and read its output back ─────────────────────
        # Mint the session cookie first, exactly as the browser does on boot.
        http_get(f"{base}/api/session")
        status, body = http_post(f"{base}/api/run", {
            "step_id": "smoke1", "operation_id": "literal",
            "config": {"expr": "[1, 2, 3]"}, "input_ref_id": None,
            "step_map": {}, "is_preview": False,
        })
        ok = status == 200 and json.loads(body or b"{}").get("status") == "success"
        report("a step runs end to end", ok, f"HTTP {status}: {body[:300]!r}")
        if ok:
            ref = json.loads(body)["output_ref_id"]
            status, body = http_get(f"{base}/api/data/{ref}")
            rows = json.loads(body) if status == 200 else []
            report("step output is readable by reference",
                   status == 200 and len(rows) > 0, f"HTTP {status}")

    finally:
        if server and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        if args.keep:
            print(f"\n  kept: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)

    total = len(PASSED) + len(FAILED)
    print(f"\n  {len(PASSED)}/{total} stages passed")
    if FAILED:
        print("\n  failures:")
        for stage, detail in FAILED:
            print(f"    - {stage}")
            if detail:
                for line in detail.strip().splitlines()[-4:]:
                    print(f"        {line}")
        return 1
    print("  all stages passed\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
