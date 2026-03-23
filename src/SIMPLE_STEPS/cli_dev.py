"""
simple-steps-dev CLI
====================
Starts BOTH the backend API (uvicorn) and the frontend Vite dev server
in a single command for local development.

Usage:
    simple-steps-dev                     # backend :8000, frontend :5173
    simple-steps-dev --port 9000         # backend on custom port
    simple-steps-dev --ops ./my_ops      # extra operation plugin dirs
"""

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        prog="simple-steps-dev",
        description="Start backend + frontend dev servers together",
    )
    parser.add_argument(
        "--port", type=int, default=8000,
        help="Backend API port (default: 8000)",
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1",
        help="Backend bind address (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--frontend-port", type=int, default=5173,
        help="Vite dev server port (default: 5173)",
    )
    parser.add_argument(
        "--ops", nargs="*", default=[],
        help="Additional directories to scan for *_ops.py plugins",
    )
    parser.add_argument(
        "--projects-dir", type=str, default=None,
        help="Directory for project/pipeline storage (default: ./projects)",
    )
    args = parser.parse_args()

    # ── Resolve paths ────────────────────────────────────────────────────
    # Find the frontend directory relative to this file or the cwd
    frontend_dir = Path.cwd() / "frontend"
    if not frontend_dir.is_dir():
        # Try relative to the package location
        pkg_root = Path(__file__).resolve().parent.parent.parent
        frontend_dir = pkg_root / "frontend"

    if not frontend_dir.is_dir():
        print("  ❌ Could not find the frontend/ directory.")
        print("     Run this command from the project root (where frontend/ lives).")
        sys.exit(1)

    package_json = frontend_dir / "package.json"
    node_modules = frontend_dir / "node_modules"

    if not package_json.exists():
        print(f"  ❌ No package.json in {frontend_dir}")
        sys.exit(1)

    # ── Environment variables for backend ────────────────────────────────
    env = os.environ.copy()

    if args.ops:
        env["SIMPLE_STEPS_EXTRA_OPS"] = ";".join(
            os.path.abspath(p) for p in args.ops
        )

    if args.projects_dir:
        env["SIMPLE_STEPS_PROJECTS_DIR"] = os.path.abspath(args.projects_dir)

    # ── Print banner ─────────────────────────────────────────────────────
    print()
    print("  ┌──────────────────────────────────────────────┐")
    print("  │       ⚡ Simple Steps — Dev Mode ⚡           │")
    print("  ├──────────────────────────────────────────────┤")
    print(f"  │  Backend API:  http://{args.host}:{args.port}/api     │")
    print(f"  │  Frontend UI:  http://localhost:{args.frontend_port}        │")
    print(f"  │  API Docs:     http://localhost:{args.port}/docs    │")
    print("  ├──────────────────────────────────────────────┤")
    print("  │  ✏️  Backend auto-reloads on Python changes   │")
    print("  │  ✏️  Frontend hot-reloads on React/TS changes │")
    print("  │  Press Ctrl+C to stop both servers           │")
    print("  └──────────────────────────────────────────────┘")
    print()

    # ── Install frontend deps if needed ──────────────────────────────────
    if not node_modules.is_dir():
        print("  📦 Installing frontend dependencies (npm install)...")
        subprocess.run(["npm", "install"], cwd=str(frontend_dir), check=True)
        print()

    # ── Start both processes ─────────────────────────────────────────────
    procs: list[subprocess.Popen] = []

    try:
        # Backend: uvicorn with --reload
        backend_cmd = [
            sys.executable, "-m", "uvicorn",
            "SIMPLE_STEPS.main:app",
            "--host", args.host,
            "--port", str(args.port),
            "--reload",
            "--log-level", "info",
        ]
        print(f"  🐍 Starting backend on :{args.port} ...")
        backend_proc = subprocess.Popen(
            backend_cmd,
            env=env,
            cwd=str(Path.cwd()),
        )
        procs.append(backend_proc)

        # Small delay so backend logs appear first
        time.sleep(0.5)

        # Frontend: Vite dev server
        frontend_cmd = [
            "npx", "vite",
            "--port", str(args.frontend_port),
            "--host", "localhost",
        ]
        print(f"  ⚛️  Starting Vite dev server on :{args.frontend_port} ...")
        print()
        frontend_proc = subprocess.Popen(
            frontend_cmd,
            cwd=str(frontend_dir),
            env=env,
        )
        procs.append(frontend_proc)

        # Wait for either process to exit
        while True:
            for p in procs:
                ret = p.poll()
                if ret is not None:
                    # One process died — kill the other and exit
                    raise SystemExit(ret)
            time.sleep(0.5)

    except (KeyboardInterrupt, SystemExit):
        print("\n  🛑 Shutting down...")
        for p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
        # Give them a moment to clean up
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        print("  ✅ All servers stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
