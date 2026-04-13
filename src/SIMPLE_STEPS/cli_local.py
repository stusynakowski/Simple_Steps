"""
simple-steps-local CLI
======================
Launches Simple Steps as a **native desktop window** — no browser required.

Under the hood it starts the same FastAPI backend (uvicorn) in a background
thread, then opens the bundled React frontend inside a pywebview window.
The UI is pixel-for-pixel identical to the browser version.

The current working directory (or --workspace) becomes the workspace root,
so the file-system shown in the app is always "wherever you are" when you
run the command.

Usage:
    simple-steps-local                          # launch from cwd
    simple-steps-local --workspace ~/my-data    # explicit workspace
    simple-steps-local --port 9000              # custom backend port
    simple-steps-local --packs ./my_packs       # extra operation packs
    simple-steps-local --width 1400 --height 900

Requirements:
    pip install simple-steps[desktop]
    # or: pip install pywebview
"""

import argparse
import os
import sys
import threading
import time
import socket


def _find_free_port(preferred: int = 8000) -> int:
    """Return *preferred* if it's available, otherwise pick a random free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


def _wait_for_server(host: str, port: int, timeout: float = 15.0):
    """Block until the uvicorn server is accepting connections."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.15)
    return False


def _start_backend(host: str, port: int):
    """Run uvicorn in the current thread (blocking). Meant for a daemon thread."""
    import uvicorn
    uvicorn.run(
        "SIMPLE_STEPS.main:app",
        host=host,
        port=port,
        log_level="warning",  # keep the terminal quiet in desktop mode
    )


def main():
    # ── Check for subcommands ────────────────────────────────────────────
    if len(sys.argv) > 1 and sys.argv[1] == "pack":
        from .cli_pack import main as pack_main
        pack_main(sys.argv[2:])
        return

    parser = argparse.ArgumentParser(
        prog="simple-steps-local",
        description="Launch Simple Steps as a native desktop window (no browser)",
    )
    parser.add_argument(
        "--port", type=int, default=8000,
        help="Backend API port (default: 8000, auto-picks another if busy)",
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1",
        help="Backend bind address (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--workspace", type=str, default=None,
        help="Workspace root directory (default: current working directory)",
    )
    parser.add_argument(
        "--ops", nargs="*", default=[],
        help="Additional directories to scan for *_ops.py plugins",
    )
    parser.add_argument(
        "--packs", nargs="*", default=[],
        help="Additional developer pack directories to scan",
    )
    parser.add_argument(
        "--projects-dir", type=str, default=None,
        help="Directory for project/pipeline storage (default: <workspace>/projects)",
    )
    parser.add_argument(
        "--width", type=int, default=1280,
        help="Window width in pixels (default: 1280)",
    )
    parser.add_argument(
        "--height", type=int, default=860,
        help="Window height in pixels (default: 860)",
    )
    parser.add_argument(
        "--title", type=str, default=None,
        help="Window title (default: 'Simple Steps — <workspace>')",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Enable pywebview debug mode (right-click → Inspect)",
    )
    args = parser.parse_args()

    # ── Check pywebview is installed ─────────────────────────────────────
    try:
        import webview  # noqa: F401
    except ImportError:
        print()
        print("  ❌  pywebview is not installed.")
        print()
        print("  Install it with:")
        print("      pip install simple-steps[desktop]")
        print("  or:")
        print("      pip install pywebview")
        print()
        sys.exit(1)

    # ── Resolve workspace root ───────────────────────────────────────────
    workspace = os.path.abspath(args.workspace or os.getcwd())
    os.environ["SIMPLE_STEPS_WORKSPACE"] = workspace

    if args.ops:
        os.environ["SIMPLE_STEPS_EXTRA_OPS"] = ";".join(
            os.path.abspath(p) for p in args.ops
        )
    if args.packs:
        os.environ["SIMPLE_STEPS_PACKS_DIR"] = ";".join(
            os.path.abspath(p) for p in args.packs
        )
    if args.projects_dir:
        os.environ["SIMPLE_STEPS_PROJECTS_DIR"] = os.path.abspath(args.projects_dir)

    # ── Pick a port ──────────────────────────────────────────────────────
    port = _find_free_port(args.port)
    host = args.host
    url = f"http://{host}:{port}"

    # ── Detect workspace contents (for banner) ───────────────────────────
    has_projects = os.path.isdir(os.path.join(workspace, "projects"))
    has_packs = os.path.isdir(os.path.join(workspace, "packs"))
    has_ops = os.path.isdir(os.path.join(workspace, "ops"))
    has_py = any(
        f.endswith(".py") and not f.startswith("__")
        for f in os.listdir(workspace)
        if os.path.isfile(os.path.join(workspace, f))
    )

    project_count = 0
    pipeline_count = 0
    if has_projects:
        projects_dir = os.path.join(workspace, "projects")
        for entry in os.listdir(projects_dir):
            full = os.path.join(projects_dir, entry)
            if os.path.isdir(full):
                project_count += 1
                pipeline_count += sum(
                    1 for f in os.listdir(full) if f.endswith(".json")
                )

    # ── Print startup banner ─────────────────────────────────────────────
    print()
    print("  ┌─────────────────────────────────────────────┐")
    print("  │       ⚡ Simple Steps v0.1.0 (Desktop) ⚡     │")
    print("  ├─────────────────────────────────────────────┤")
    print(f"  │  Mode:        Native window (pywebview)      │")
    print(f"  │  Backend API: {url}/api")
    print(f"  │  Workspace:   {workspace}")
    if has_projects:
        print(f"  │    📋 {project_count} project(s), {pipeline_count} pipeline(s)")
    else:
        print(f"  │    📋 No projects/ folder (will create on first save)")
    if has_packs:
        print(f"  │    📦 packs/ discovered")
    if has_ops:
        print(f"  │    🔧 ops/ discovered")
    if has_py:
        print(f"  │    🐍 Top-level .py files discovered")
    print("  └─────────────────────────────────────────────┘")
    print()

    # ── Start backend in a daemon thread ─────────────────────────────────
    backend_thread = threading.Thread(
        target=_start_backend,
        args=(host, port),
        daemon=True,
    )
    backend_thread.start()

    print("  ⏳ Waiting for backend to start...")
    if not _wait_for_server(host, port, timeout=15.0):
        print("  ❌ Backend did not start within 15 seconds. Exiting.")
        sys.exit(1)
    print("  ✅ Backend ready.")
    print("  🪟 Opening native window...\n")

    # ── Launch pywebview window ──────────────────────────────────────────
    window_title = args.title or f"Simple Steps — {os.path.basename(workspace)}"

    webview.create_window(
        window_title,
        url,
        width=args.width,
        height=args.height,
        min_size=(800, 600),
    )

    # webview.start() blocks until the window is closed.
    # When the user closes the window, the process (and daemon backend) exit.
    webview.start(debug=args.debug)

    print("\n  👋 Window closed. Shutting down.\n")


if __name__ == "__main__":
    main()
