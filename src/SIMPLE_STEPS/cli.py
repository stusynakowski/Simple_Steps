"""
simple-steps CLI
================
Single entry point to start the full Simple Steps application
(backend API + frontend UI).

Usage:
    simple-steps                    # start on default port 8000
    simple-steps --port 9000        # custom port
    simple-steps --host 0.0.0.0     # bind to all interfaces
    simple-steps --dev              # dev mode: reload on file changes
    simple-steps --no-browser       # don't auto-open browser
    simple-steps --ops ./my_ops     # add extra operation plugin paths
"""

import argparse
import os
import sys
import webbrowser
import threading
import time


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
        "--dev", action="store_true",
        help="Enable auto-reload for development",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Don't auto-open the browser",
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
        help="Directory for project/pipeline storage (default: ./projects)",
    )
    args = parser.parse_args()

    # ── Pass configuration via environment variables ─────────────────────
    # These are picked up by main.py and file_manager.py at import time

    if args.ops:
        # Semicolon-separated list of extra plugin paths (legacy)
        os.environ["SIMPLE_STEPS_EXTRA_OPS"] = ";".join(
            os.path.abspath(p) for p in args.ops
        )

    if args.packs:
        # Semicolon-separated list of developer pack directories
        os.environ["SIMPLE_STEPS_PACKS_DIR"] = ";".join(
            os.path.abspath(p) for p in args.packs
        )

    if args.projects_dir:
        os.environ["SIMPLE_STEPS_PROJECTS_DIR"] = os.path.abspath(args.projects_dir)

    # ── Auto-open browser ────────────────────────────────────────────────
    if not args.no_browser and not args.dev:
        def _open_browser():
            time.sleep(1.5)  # wait for server to start
            url = f"http://{'localhost' if args.host == '0.0.0.0' else args.host}:{args.port}"
            print(f"\n  🌐 Opening {url} in your browser...\n")
            webbrowser.open(url)
        threading.Thread(target=_open_browser, daemon=True).start()

    # ── Print startup banner ─────────────────────────────────────────────
    print()
    print("  ┌─────────────────────────────────────────┐")
    print("  │         ⚡ Simple Steps v0.1.0 ⚡        │")
    print("  ├─────────────────────────────────────────┤")
    print(f"  │  Backend API: http://{args.host}:{args.port}/api  │")
    print(f"  │  Frontend UI: http://{args.host}:{args.port}      │")
    print("  │  Docs:        http://localhost:{}/docs  │".format(args.port))
    print("  └─────────────────────────────────────────┘")
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
        port=args.port,
        reload=args.dev,
        log_level="info",
    )


if __name__ == "__main__":
    main()
