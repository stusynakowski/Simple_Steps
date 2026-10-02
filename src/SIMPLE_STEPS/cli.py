"""
simple-steps CLI
================
Single entry point to start the full Simple Steps application
(backend API + frontend UI).

Usage:
    simple-steps                    # start from cwd (workspace root)
    simple-steps --port 9000        # custom port
    simple-steps --host 0.0.0.0     # bind to all interfaces
    simple-steps --dev              # dev mode: reload on file changes
    simple-steps --no-browser       # don't auto-open browser
    simple-steps --packs ./my_packs # add extra operation pack directories

The current working directory becomes the "workspace root".  Simple Steps
will automatically discover:
    <cwd>/projects/   → project folders with pipeline JSON files
    <cwd>/packs/      → developer packs with @simple_step functions
    <cwd>/ops/        → workspace-level custom operations
    <cwd>/*.py        → top-level Python files with @simple_step decorators
"""

import argparse
import os
import sys
import webbrowser
import threading
import time
import socket


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


def print_versions() -> None:
    """
    Report what is actually installed, including each package's git commit.

    The version string never changes (both packages sit at 0.1.0), so pip
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
    print("  Both packages are version 0.1.0 always, so `pip install` sees an")
    print("  existing copy as up to date. To genuinely update:")
    print("    pip install --upgrade --force-reinstall --no-cache-dir \\")
    print('      "git+https://github.com/stusynakowski/Simple_Steps.git"')


def main():
    parser = argparse.ArgumentParser(
        prog="simple-steps",
        description="Start the Simple Steps pipeline orchestrator",
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
             "Simple Steps discovers projects/, packs/, and ops/ relative to this.",
    )
    parser.add_argument(
        "--ops", nargs="*", default=[],
        help="Additional directories to scan for *_ops.py plugins (legacy — prefer --packs)",
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

    if args.version:
        print_versions()
        return

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
        for p in args.ops:
            rebuilt += ["--ops", p]
        for p in args.packs:
            rebuilt += ["--packs", p]
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
    has_packs = os.path.isdir(os.path.join(workspace, "packs"))
    has_ops = os.path.isdir(os.path.join(workspace, "ops"))
    has_py = any(
        f.endswith(".py") and not f.startswith("__")
        for f in os.listdir(workspace)
        if os.path.isfile(os.path.join(workspace, f))
    )
    has_manifest = os.path.isfile(os.path.join(workspace, "simple_steps.toml"))

    # Count manifest packs
    manifest_pack_count = 0
    if has_manifest:
        try:
            from .pack_manager import load_manifest
            _m = load_manifest(workspace)
            manifest_pack_count = len(_m.packs)
        except Exception:
            pass

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
    print("  │          ⚡ Simple Steps v0.1.0 ⚡            │")
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
    if has_packs:
        print(f"  │    📦 packs/ discovered")
    if has_ops:
        print(f"  │    🔧 ops/ discovered")
    if has_py:
        print(f"  │    🐍 Top-level .py files discovered")
    if has_manifest:
        print(f"  │    📄 simple_steps.toml ({manifest_pack_count} pack(s) declared)")
    print("  └─────────────────────────────────────────────┘")
    print()

    if args.ops:
        for p in args.ops:
            print(f"  📂 Extra ops: {os.path.abspath(p)}")
        print()

    if args.packs:
        for p in args.packs:
            print(f"  📦 Pack dir:  {os.path.abspath(p)}")
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
