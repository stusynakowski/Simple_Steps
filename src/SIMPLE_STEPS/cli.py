"""
simple-steps CLI
================
Single entry point to start the full Simple Steps application
(backend API + frontend UI).

Usage:
    simple-steps run app.py         # serve the App that app.py builds (like `streamlit run`)
    python -m simple_steps run app.py   # the same, through the interpreter
    simple-steps --load-examples    # copy the examples into ./examples
    simple-steps                    # start from cwd (workspace root)
    simple-steps --port 9000        # custom port
    simple-steps --host 0.0.0.0     # bind to all interfaces
    simple-steps --dev              # dev mode: reload on file changes
    simple-steps --no-browser       # don't auto-open browser

The current working directory becomes the "workspace root": its projects/
folder holds the workflow files, and its app.py (if any) is the App served.
Tools come only from that App's ``tools=[…]`` and the standard set.
"""

import argparse
import os
import shutil
import sys
import webbrowser
import threading
import time
import socket


def _port_is_free(host: str, port: int) -> bool:
    """Return True if the given port is available to bind."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        # As uvicorn binds: a port in TIME_WAIT just after a server stopped is
        # free to it, while a live server's port still isn't.
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
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


def print_versions() -> None:
    """
    Report what is actually installed, including each package's git commit.

    The version string rarely changes (simple-steps 0.0.0, core 0.1.0), so pip
    treats any installed copy as satisfying a fresh `pip install git+...` and
    silently leaves the old code in place. The commit is the only way to tell
    what you really have — which is what this prints.
    """
    import json

    try:
        import importlib.metadata as md
    except ImportError:  # pragma: no cover - Python < 3.8
        print("  (importlib.metadata unavailable)")
        return

    for name in ("simple-steps", "simple-steps-core"):
        try:
            dist = md.distribution(name)
        except Exception:
            print(f"  {name:18} NOT INSTALLED")
            continue

        commit = source = ""
        try:
            raw = dist.read_text("direct_url.json")
            if raw:
                info = json.loads(raw)
                commit = (info.get("vcs_info") or {}).get("commit_id", "")
                if info.get("dir_info", {}).get("editable"):
                    source = "editable"
                elif commit:
                    source = "git"
        except Exception:
            pass

        detail = f" ({source} {commit[:12]})" if commit else (f" ({source})" if source else "")
        print(f"  {name:18} {dist.version}{detail}")

    print()
    print("  The version numbers rarely change, so `pip install` sees an")
    print("  existing copy as up to date. To genuinely update:")
    print("    pip install --upgrade --force-reinstall --no-cache-dir \\")
    print('      "git+https://github.com/stusynakowski/Simple_Steps.git"')


def run_main(argv: list) -> int:
    """``simple-steps run app.py`` — serve the App a Python file builds.

    Like ``streamlit run``: the file's folder is its workspace, and the file is
    imported rather than run, so the CLI's --port / --host / --no-browser win
    over whatever ``app.serve()`` call the file makes for itself.
    """
    parser = argparse.ArgumentParser(
        prog="simple-steps run",
        description="Serve the Simple Steps App that a Python file builds.",
    )
    parser.add_argument("script", help="the app file, e.g. app.py")
    parser.add_argument("--port", type=int, default=None, help="port (default: the App's, 8000)")
    parser.add_argument("--host", type=str, default=None, help="host (default: the App's, 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    args = parser.parse_args(argv)

    path = os.path.abspath(args.script)
    if not os.path.isfile(path):
        print(f"  ✗ No such file: {args.script}")
        return 1
    from .application import AppError, load_app_file
    try:
        app = load_app_file(path)
    except AppError as exc:
        print(f"  ✗ {exc}")
        return 1
    app.serve(host=args.host, port=args.port, open_browser=not args.no_browser)
    return 0


#: Where the examples ship: inside the package, so a pip install has them.
EXAMPLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "examples")


def load_examples(dest_parent: str) -> int:
    """Copy the bundled examples folder — whatever it holds — to <dest_parent>/examples."""
    if not os.path.isdir(EXAMPLES_DIR):
        print(f"  ✗ This install has no examples (looked in {EXAMPLES_DIR}).")
        return 1
    dest = os.path.join(os.path.abspath(dest_parent), "examples")
    if os.path.exists(dest):
        print(f"  ✗ {dest} already exists; move it aside to load a fresh copy.")
        return 1
    shutil.copytree(EXAMPLES_DIR, dest,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))
    apps = sorted(
        os.path.relpath(os.path.join(root, "app.py"), dest_parent)
        for root, _dirs, files in os.walk(dest) if "app.py" in files
    )
    print(f"  ✓ Copied the examples to {dest}")
    for app in apps:
        print(f"    simple-steps run {app}")
    return 0


def main():
    # `run` is a subcommand; everything else keeps the flags it always had.
    if sys.argv[1:2] == ["run"]:
        sys.exit(run_main(sys.argv[2:]))

    parser = argparse.ArgumentParser(
        prog="simple-steps",
        description="Start the Simple Steps pipeline orchestrator. "
                    "To serve an app file: simple-steps run app.py",
    )
    parser.add_argument(
        "--port", type=int, default=8000,
        help="Port for the server (default: 8000)",
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--load-examples", action="store_true",
        help="Copy the bundled examples folder into the current directory, then exit.",
    )
    parser.add_argument(
        "--version", action="store_true",
        help="Print the installed simple-steps and simple-steps-core versions, "
             "including which git commit each came from, then exit.",
    )
    parser.add_argument(
        "--dev", action="store_true",
        help="Enable auto-reload for development",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Don't auto-open the browser",
    )
    parser.add_argument(
        "--local", action="store_true",
        help="Launch as a native desktop window (requires pip install simple-steps[desktop]). "
             "Same UI, no browser — uses pywebview.",
    )
    parser.add_argument(
        "--workspace", type=str, default=None,
        help="Workspace root directory (default: current working directory). "
             "Workflows live in its projects/ folder.",
    )
    parser.add_argument(
        "--projects-dir", type=str, default=None,
        help="Directory for project/pipeline storage (default: <workspace>/projects)",
    )
    args = parser.parse_args()

    if args.version:
        print_versions()
        return

    if args.load_examples:
        sys.exit(load_examples(os.getcwd()))

    # ── Delegate to native desktop mode if --local ───────────────────────
    if args.local:
        from .cli_local import main as local_main
        # Rebuild sys.argv without --local so cli_local's own parser works
        rebuilt = [sys.argv[0]]
        if args.port != 8000:
            rebuilt += ["--port", str(args.port)]
        if args.host != "127.0.0.1":
            rebuilt += ["--host", args.host]
        if args.workspace:
            rebuilt += ["--workspace", args.workspace]
        if args.projects_dir:
            rebuilt += ["--projects-dir", args.projects_dir]
        sys.argv = rebuilt
        local_main()
        return

    # ── Resolve workspace root ───────────────────────────────────────────
    workspace = os.path.abspath(args.workspace or os.getcwd())
    os.environ["SIMPLE_STEPS_WORKSPACE"] = workspace

    # ── Pass configuration via environment variables ─────────────────────
    # These are picked up by main.py and file_manager.py at import time

    if args.projects_dir:
        os.environ["SIMPLE_STEPS_PROJECTS_DIR"] = os.path.abspath(args.projects_dir)

    # ── Find a free port (Streamlit-style auto-increment) ────────────────
    port = _find_free_port(args.host, args.port)
    if port != args.port:
        print(f"  ⚠️  Port {args.port} is in use, using port {port} instead.")
        print()

    # ── Auto-open browser ────────────────────────────────────────────────
    if not args.no_browser and not args.dev:
        def _open_browser():
            time.sleep(1.5)
            url = f"http://{'localhost' if args.host == '0.0.0.0' else args.host}:{port}"
            print(f"\n  🌐 Opening {url} in your browser...\n")
            webbrowser.open(url)
        threading.Thread(target=_open_browser, daemon=True).start()

    # ── Detect workspace contents ────────────────────────────────────────
    has_projects = os.path.isdir(os.path.join(workspace, "projects"))
    has_app = os.path.isfile(os.path.join(workspace, "app.py"))

    # Count projects
    projects_dir = os.path.join(workspace, "projects")
    project_count = 0
    pipeline_count = 0
    if has_projects:
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
    print("  │          ⚡ Simple Steps v0.0.0 ⚡            │")
    print("  ├─────────────────────────────────────────────┤")
    print(f"  │  Backend API: http://{args.host}:{port}/api    │")
    print(f"  │  Frontend UI: http://{args.host}:{port}        │")
    print(f"  │  Docs:        http://localhost:{port}/docs   │")
    print("  ├─────────────────────────────────────────────┤")
    print(f"  │  Workspace:   {workspace}")
    if has_projects:
        print(f"  │    📋 {project_count} project(s), {pipeline_count} pipeline(s)")
    else:
        print(f"  │    📋 No projects/ folder found (will create on first save)")
    if has_app:
        print(f"  │    app.py: the App served")
    print("  └─────────────────────────────────────────────┘")
    print()

    # ── Start uvicorn ────────────────────────────────────────────────────
    import uvicorn

    uvicorn.run(
        "SIMPLE_STEPS.main:app",
        host=args.host,
        port=port,
        reload=args.dev,
        log_level="info",
    )


if __name__ == "__main__":
    main()
