"""
Build helper: compile the React frontend and copy it into the
SIMPLE_STEPS package so it ships with pip install.

Usage:
    simple-steps-build          # build frontend and bundle into package
    python -m SIMPLE_STEPS.build_frontend   # same thing
"""

import os
import shutil
import subprocess
import sys


# Name of the stamp file written into frontend_dist/ recording which sources
# the bundle was built from. scripts/preflight.py reads it.
SOURCE_STAMP = ".source-hash"

# Extensions that actually affect the built bundle.
_SOURCE_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".css", ".html")


def source_hash(src_dir: str) -> str:
    """
    A stable hash of every build-relevant file under *src_dir*.

    Content-based on purpose — mtimes are unusable here, since the build
    rewrites api.ts and restores it after the bundle is copied. Returns "" if
    the directory is absent (an installed package has no frontend/ tree).
    """
    import hashlib

    if not os.path.isdir(src_dir):
        return ""

    digest = hashlib.sha256()
    for root, dirnames, filenames in os.walk(src_dir):
        dirnames[:] = sorted(
            d for d in dirnames if d != "node_modules" and not d.startswith(".")
        )
        for name in sorted(filenames):
            if not name.endswith(_SOURCE_SUFFIXES):
                continue
            path = os.path.join(root, name)
            digest.update(os.path.relpath(path, src_dir).encode())
            with open(path, "rb") as f:
                digest.update(f.read())
    return digest.hexdigest()


def main():
    # ── Paths ────────────────────────────────────────────────────────────
    pkg_dir = os.path.dirname(__file__)                        # src/SIMPLE_STEPS/
    repo_root = os.path.abspath(os.path.join(pkg_dir, "..", ".."))  # repo root
    frontend_dir = os.path.join(repo_root, "frontend")
    dist_src = os.path.join(frontend_dir, "dist")
    dist_dest = os.path.join(pkg_dir, "frontend_dist")

    print()
    print("  ⚡ Simple Steps — Frontend Build")
    print("  ─────────────────────────────────")
    print(f"  Frontend source: {frontend_dir}")
    print(f"  Bundle target:   {dist_dest}")
    print()

    # ── Check frontend exists ────────────────────────────────────────────
    if not os.path.isfile(os.path.join(frontend_dir, "package.json")):
        print("  ❌ Cannot find frontend/package.json")
        print("     Make sure you're in the Simple Steps repo root.")
        sys.exit(1)

    # ── Update the API base URL for production (same-origin) ─────────────
    api_ts = os.path.join(frontend_dir, "src", "services", "api.ts")
    if os.path.exists(api_ts):
        with open(api_ts, "r") as f:
            content = f.read()

        # Replace hardcoded localhost URL with relative path for same-origin serving
        original_content = content
        # We want: const API_BASE = '/api'  (no host, relative)
        # But we should NOT permanently modify the dev file. Instead, we'll
        # patch it, build, then restore.
        patched_content = content.replace(
            "http://localhost:8000/api",
            "/api"
        ).replace(
            "http://127.0.0.1:8000/api",
            "/api"
        )

        if patched_content != content:
            print("  📝 Patching api.ts for production build (relative /api)...")
            with open(api_ts, "w") as f:
                f.write(patched_content)

    # ── Install npm dependencies ─────────────────────────────────────────
    print("  📦 Installing frontend dependencies...")
    result = subprocess.run(
        ["npm", "install"],
        cwd=frontend_dir,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ❌ npm install failed:\n{result.stderr}")
        _restore_api_ts(api_ts, original_content if 'original_content' in dir() else None)
        sys.exit(1)

    # ── Build ────────────────────────────────────────────────────────────
    print("  🔨 Building frontend (npm run build)...")
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=frontend_dir,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ❌ Build failed:\n{result.stderr}")
        _restore_api_ts(api_ts, original_content if 'original_content' in dir() else None)
        sys.exit(1)

    # ── Restore api.ts to dev version ────────────────────────────────────
    if 'original_content' in dir() and original_content:
        _restore_api_ts(api_ts, original_content)

    # ── Copy dist into package ───────────────────────────────────────────
    if os.path.isdir(dist_dest):
        print("  🗑  Removing old frontend_dist/...")
        shutil.rmtree(dist_dest)

    print(f"  📋 Copying {dist_src} → {dist_dest}")
    shutil.copytree(dist_src, dist_dest)

    # Stamp the bundle with a hash of the sources it was built from, so
    # staleness can be checked exactly. Timestamps cannot do this: this script
    # patches api.ts for the production build and restores it afterwards, which
    # leaves the source newer than the bundle it produced.
    stamp = source_hash(os.path.join(frontend_dir, "src"))
    if stamp:
        with open(os.path.join(dist_dest, SOURCE_STAMP), "w") as f:
            f.write(stamp)
        print(f"  🔖 Stamped bundle with source hash {stamp[:12]}")

    print()
    print("  ✅ Frontend bundled into package successfully!")
    print("  You can now run: simple-steps")
    print()


def _restore_api_ts(path, original_content):
    """Restore the dev api.ts after build."""
    if original_content and os.path.exists(path):
        with open(path, "w") as f:
            f.write(original_content)
        print("  📝 Restored api.ts to dev configuration")


if __name__ == "__main__":
    main()
