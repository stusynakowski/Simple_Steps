"""
simple-steps-dev CLI
====================
Starts BOTH the backend API (uvicorn) and the frontend Vite dev server
in a single command for local development.

Usage:
    simple-steps-dev                     # backend :8000, frontend :5173
    simple-steps-dev --port 9000         # backend on custom port
    simple-steps-dev --workspace ~/my-repo  # use a different workspace root
    simple-steps-dev --ops ./my_ops      # extra operation plugin dirs

The current working directory (or --workspace) becomes the workspace root.
Simple Steps discovers projects/, packs/, ops/ relative to this root.
"""

import argparse
import os
import signal
import subprocess
import sys
import time
import socket
from pathlib import Path


def _port_is_free(host: str, port: int) -> bool:
    """Return True if the given port is available to bind."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _find_free_port(host: str, preferred: int, max_attempts: int = 50) -> int:
    """
    Return *preferred* if free, otherwise scan upward (Streamlit-style)
    until we find an open port.  Gives up after *max_attempts*.
    """
    for offset in range(max_attempts):
        candidate = preferred + offset
        if _port_is_free(host, candidate):
            return candidate
    # Last resort: let the OS pick one
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


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
        "--workspace", type=str, default=None,
        help="Workspace root directory (default: cwd). "
             "Simple Steps discovers projects/, packs/, and ops/ relative to this.",
    )
    parser.add_argument(
        "--ops", nargs="*", default=[],
        help="Additional directories to scan for *_ops.py plugins",
    )
    parser.add_argument(
        "--packs", nargs="*", default=[],
        help="Additional developer pack directories to scan for @simple_step functions",
    )
    parser.add_argument(
        "--projects-dir", type=str, default=None,
        help="Directory for project/pipeline storage (default: <workspace>/projects)",
    )
    args = parser.parse_args()

    # ── Resolve workspace root ────────────────────────────────────────────
    workspace = os.path.abspath(args.workspace or os.getcwd())

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
    env["SIMPLE_STEPS_WORKSPACE"] = workspace

    if args.ops:
        env["SIMPLE_STEPS_EXTRA_OPS"] = ";".join(
            os.path.abspath(p) for p in args.ops
        )

    if args.packs:
        env["SIMPLE_STEPS_PACKS_DIR"] = ";".join(
            os.path.abspath(p) for p in args.packs
        )

    if args.projects_dir:
        env["SIMPLE_STEPS_PROJECTS_DIR"] = os.path.abspath(args.projects_dir)

    # ── Find free ports (Streamlit-style auto-increment) ─────────────────
    backend_port = _find_free_port(args.host, args.port)
    frontend_port = _find_free_port("localhost", args.frontend_port)

    if backend_port != args.port:
        print(f"  ⚠️  Backend port {args.port} is in use, using port {backend_port} instead.")
    if frontend_port != args.frontend_port:
        print(f"  ⚠️  Frontend port {args.frontend_port} is in use, using port {frontend_port} instead.")

    # ── Detect workspace contents ────────────────────────────────────────
    has_projects = os.path.isdir(os.path.join(workspace, "projects"))
    has_packs = os.path.isdir(os.path.join(workspace, "packs"))
    has_ops = os.path.isdir(os.path.join(workspace, "ops"))

    project_count = 0
    if has_projects:
        project_count = sum(
            1 for e in os.listdir(os.path.join(workspace, "projects"))
            if os.path.isdir(os.path.join(workspace, "projects", e))
        )

    # ── Print banner ─────────────────────────────────────────────────────
    print()
    print("  ┌──────────────────────────────────────────────┐")
    print("  │       ⚡ Simple Steps — Dev Mode ⚡           │")
    print("  ├──────────────────────────────────────────────┤")
    print(f"  │  Backend API:  http://{args.host}:{backend_port}/api     │")
    print(f"  │  Frontend UI:  http://localhost:{frontend_port}        │")
    print(f"  │  API Docs:     http://localhost:{backend_port}/docs    │")
    print("  ├──────────────────────────────────────────────┤")
    print(f"  │  Workspace:    {workspace}")
    if has_projects:
        print(f"  │    📋 {project_count} project(s)")
    if has_packs:
        print(f"  │    📦 packs/ discovered")
    if has_ops:
        print(f"  │    🔧 ops/ discovered")
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
            "--port", str(backend_port),
            "--reload",
            "--log-level", "info",
        ]
        print(f"  🐍 Starting backend on :{backend_port} ...")
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
            "--port", str(frontend_port),
            "--host", "localhost",
        ]
        print(f"  ⚛️  Starting Vite dev server on :{frontend_port} ...")
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
