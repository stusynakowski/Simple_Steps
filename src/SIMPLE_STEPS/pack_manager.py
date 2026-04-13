"""
pack_manager.py
===============
Manages the workspace-level pack manifest (``simple_steps.toml``), handles
cloning packs from git repos, scaffolding new packs from the built-in
template, and installing pip-based packs.

The manifest lives at ``<workspace>/simple_steps.toml`` and looks like::

    [packs]

    [packs.youtube]
    source = "git"
    url = "https://github.com/org/ss-youtube-pack.git"
    ref = "main"
    path = ".packs/ss-youtube-pack"

    [packs.my-local-pack]
    source = "local"
    path = "../shared-packs/my-local-pack"

    [packs.some-pip-pack]
    source = "pip"
    package = "simple-steps-some-pack"

Each pack entry tells Simple Steps *where* the pack comes from and where
it lives on disk.  ``simple-steps pack install`` reads the manifest and
ensures all declared packs are present.
"""

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional

# ── Try tomllib (3.11+) or tomli ────────────────────────────────────────────
try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ModuleNotFoundError:
        tomllib = None  # type: ignore[assignment]

# We also need a TOML writer — tomllib is read-only
try:
    import tomli_w
except ModuleNotFoundError:
    tomli_w = None  # type: ignore[assignment]


MANIFEST_FILENAME = "simple_steps.toml"
PACKS_CACHE_DIR = ".packs"  # where git-cloned packs live inside the workspace


class PackSource(str, Enum):
    GIT = "git"
    LOCAL = "local"
    PIP = "pip"


@dataclass
class PackEntry:
    """A single pack declaration from the manifest."""
    name: str
    source: PackSource
    url: str = ""          # git URL
    ref: str = "main"      # git branch/tag
    path: str = ""         # local filesystem path (relative to workspace)
    package: str = ""      # pip package name
    enabled: bool = True


@dataclass
class PackManifest:
    """The full workspace manifest."""
    packs: Dict[str, PackEntry] = field(default_factory=dict)


# ── Manifest I/O ─────────────────────────────────────────────────────────────

def _manifest_path(workspace: str) -> str:
    return os.path.join(workspace, MANIFEST_FILENAME)


def load_manifest(workspace: str) -> PackManifest:
    """Load the simple_steps.toml manifest (or return empty if not found)."""
    path = _manifest_path(workspace)
    if not os.path.isfile(path):
        return PackManifest()

    if tomllib is None:
        print("  ⚠️  Cannot read simple_steps.toml — install 'tomli' for Python <3.11")
        return PackManifest()

    with open(path, "rb") as f:
        data = tomllib.load(f)

    packs_data = data.get("packs", {})
    manifest = PackManifest()

    for name, cfg in packs_data.items():
        if not isinstance(cfg, dict):
            continue
        try:
            source = PackSource(cfg.get("source", "local"))
        except ValueError:
            print(f"  ⚠️  Unknown pack source '{cfg.get('source')}' for '{name}', skipping")
            continue

        manifest.packs[name] = PackEntry(
            name=name,
            source=source,
            url=cfg.get("url", ""),
            ref=cfg.get("ref", "main"),
            path=cfg.get("path", ""),
            package=cfg.get("package", ""),
            enabled=cfg.get("enabled", True),
        )

    return manifest


def save_manifest(workspace: str, manifest: PackManifest):
    """Write the manifest back to simple_steps.toml."""
    path = _manifest_path(workspace)

    if tomli_w is not None:
        # Use tomli_w for proper TOML serialization
        data: dict = {"packs": {}}
        for name, entry in manifest.packs.items():
            pack_dict: dict = {"source": entry.source.value}
            if entry.url:
                pack_dict["url"] = entry.url
            if entry.ref and entry.ref != "main":
                pack_dict["ref"] = entry.ref
            if entry.path:
                pack_dict["path"] = entry.path
            if entry.package:
                pack_dict["package"] = entry.package
            if not entry.enabled:
                pack_dict["enabled"] = False
            data["packs"][name] = pack_dict
        with open(path, "wb") as f:
            tomli_w.dump(data, f)
    else:
        # Fallback: write TOML manually (simple subset)
        _write_manifest_manual(path, manifest)

    print(f"  💾 Saved {path}")


def _write_manifest_manual(path: str, manifest: PackManifest):
    """Write a simple TOML file by hand (no dependency needed)."""
    lines = [
        "# Simple Steps — workspace pack manifest",
        "# Managed by: simple-steps pack add / remove",
        "# Run `simple-steps pack install` to sync all declared packs.",
        "",
        "[packs]",
        "",
    ]
    for name, entry in manifest.packs.items():
        lines.append(f"[packs.{name}]")
        lines.append(f'source = "{entry.source.value}"')
        if entry.url:
            lines.append(f'url = "{entry.url}"')
        if entry.ref and entry.ref != "main":
            lines.append(f'ref = "{entry.ref}"')
        if entry.path:
            lines.append(f'path = "{entry.path}"')
        if entry.package:
            lines.append(f'package = "{entry.package}"')
        if not entry.enabled:
            lines.append(f"enabled = false")
        lines.append("")

    with open(path, "w") as f:
        f.write("\n".join(lines))


# ── Pack Operations ──────────────────────────────────────────────────────────

def add_pack_git(
    workspace: str,
    url: str,
    name: Optional[str] = None,
    ref: str = "main",
    *,
    clone: bool = True,
) -> PackEntry:
    """
    Add a git-based pack to the manifest and optionally clone it.

    If ``name`` is not provided, it's inferred from the repo URL.
    """
    if not name:
        # https://github.com/org/ss-youtube-pack.git → ss-youtube-pack
        name = url.rstrip("/").rstrip(".git").rsplit("/", 1)[-1]
        name = re.sub(r"[^a-z0-9\-_]", "-", name.lower())

    cache_dir = os.path.join(workspace, PACKS_CACHE_DIR)
    clone_dest = os.path.join(cache_dir, name)
    rel_path = os.path.join(PACKS_CACHE_DIR, name)

    entry = PackEntry(
        name=name,
        source=PackSource.GIT,
        url=url,
        ref=ref,
        path=rel_path,
    )

    if clone:
        _clone_or_pull(workspace, entry)

    # Update manifest
    manifest = load_manifest(workspace)
    manifest.packs[name] = entry
    save_manifest(workspace, manifest)

    return entry


def add_pack_local(
    workspace: str,
    path: str,
    name: Optional[str] = None,
) -> PackEntry:
    """
    Add a local directory pack to the manifest.

    ``path`` can be absolute or relative to the workspace.
    """
    abs_path = os.path.abspath(os.path.join(workspace, path))
    if not os.path.isdir(abs_path):
        raise FileNotFoundError(f"Pack directory not found: {abs_path}")

    # Store as relative path if it's under the workspace
    if abs_path.startswith(os.path.abspath(workspace)):
        rel = os.path.relpath(abs_path, workspace)
    else:
        rel = abs_path  # outside workspace — store absolute

    if not name:
        name = os.path.basename(abs_path)
        name = re.sub(r"[^a-z0-9\-_]", "-", name.lower())

    entry = PackEntry(
        name=name,
        source=PackSource.LOCAL,
        path=rel,
    )

    manifest = load_manifest(workspace)
    manifest.packs[name] = entry
    save_manifest(workspace, manifest)

    return entry


def add_pack_pip(
    workspace: str,
    package: str,
    name: Optional[str] = None,
    *,
    install: bool = True,
) -> PackEntry:
    """
    Add a pip-installable pack to the manifest and optionally install it.
    """
    if not name:
        name = package.replace("simple-steps-", "").replace("_", "-")
        name = re.sub(r"[^a-z0-9\-_]", "-", name.lower())

    entry = PackEntry(
        name=name,
        source=PackSource.PIP,
        package=package,
    )

    if install:
        _pip_install(package)

    manifest = load_manifest(workspace)
    manifest.packs[name] = entry
    save_manifest(workspace, manifest)

    return entry


def remove_pack(workspace: str, name: str, *, delete_files: bool = False) -> bool:
    """Remove a pack from the manifest (and optionally delete cloned files)."""
    manifest = load_manifest(workspace)
    entry = manifest.packs.pop(name, None)
    if entry is None:
        print(f"  ⚠️  Pack '{name}' not found in manifest")
        return False

    if delete_files and entry.source == PackSource.GIT and entry.path:
        abs_path = os.path.join(workspace, entry.path)
        if os.path.isdir(abs_path):
            shutil.rmtree(abs_path)
            print(f"  🗑  Deleted {abs_path}")

    save_manifest(workspace, manifest)
    print(f"  ✅ Removed pack '{name}' from manifest")
    return True


def install_all(workspace: str) -> List[str]:
    """
    Read the manifest and ensure all declared packs are present.
    Clones git repos, installs pip packages, validates local paths.
    Returns a list of issues (empty = all good).
    """
    manifest = load_manifest(workspace)
    issues: List[str] = []

    if not manifest.packs:
        print("  📋 No packs declared in simple_steps.toml")
        return issues

    print(f"\n  📦 Installing {len(manifest.packs)} declared pack(s)…\n")

    for name, entry in manifest.packs.items():
        if not entry.enabled:
            print(f"  ⏭  {name}: disabled")
            continue

        if entry.source == PackSource.GIT:
            try:
                _clone_or_pull(workspace, entry)
                print(f"  ✅ {name}: git pack ready ({entry.path})")
            except Exception as e:
                msg = f"{name}: git error — {e}"
                issues.append(msg)
                print(f"  ❌ {msg}")

        elif entry.source == PackSource.LOCAL:
            abs_path = _resolve_pack_path(workspace, entry)
            if os.path.isdir(abs_path):
                print(f"  ✅ {name}: local pack found ({abs_path})")
            else:
                msg = f"{name}: directory not found — {abs_path}"
                issues.append(msg)
                print(f"  ❌ {msg}")

        elif entry.source == PackSource.PIP:
            try:
                _pip_install(entry.package)
                print(f"  ✅ {name}: pip package installed ({entry.package})")
            except Exception as e:
                msg = f"{name}: pip install failed — {e}"
                issues.append(msg)
                print(f"  ❌ {msg}")

    return issues


def list_packs(workspace: str) -> List[PackEntry]:
    """Return all packs declared in the manifest."""
    manifest = load_manifest(workspace)
    return list(manifest.packs.values())


def get_manifest_pack_dirs(workspace: str) -> List[str]:
    """
    Return the absolute filesystem paths for all manifest-declared packs
    that resolve to directories on disk.  Used by main.py to feed
    additional directories into the PackLoader.

    Only git and local packs produce directories; pip packs are discovered
    via entry points automatically.
    """
    manifest = load_manifest(workspace)
    dirs: List[str] = []

    for name, entry in manifest.packs.items():
        if not entry.enabled:
            continue

        if entry.source in (PackSource.GIT, PackSource.LOCAL):
            abs_path = _resolve_pack_path(workspace, entry)
            if os.path.isdir(abs_path):
                dirs.append(abs_path)

    return dirs


# ── Scaffold a new pack ──────────────────────────────────────────────────────

def scaffold_pack(
    workspace: str,
    name: str,
    *,
    target: Optional[str] = None,
    pip_installable: bool = False,
) -> str:
    """
    Create a new pack from the built-in template.

    If ``pip_installable`` is True, generates the full pyproject.toml /
    src/ layout for a pip-installable pack.  Otherwise, creates a simple
    directory with a starter operations file inside the workspace packs/
    directory.

    Returns the absolute path to the created pack.
    """
    slug = re.sub(r"[^a-z0-9\-_]", "-", name.lower()).strip("-")

    if pip_installable:
        return _scaffold_pip_pack(workspace, name, slug, target)
    else:
        return _scaffold_local_pack(workspace, name, slug, target)


def _scaffold_local_pack(
    workspace: str, name: str, slug: str, target: Optional[str]
) -> str:
    """Create a simple pack directory inside packs/."""
    if target:
        pack_dir = os.path.abspath(target)
    else:
        pack_dir = os.path.join(workspace, "packs", slug)

    if os.path.exists(pack_dir):
        raise FileExistsError(f"Directory already exists: {pack_dir}")

    os.makedirs(pack_dir, exist_ok=True)

    # Create the starter operations file
    ops_file = os.path.join(pack_dir, f"{slug.replace('-', '_')}_ops.py")
    module_name = slug.replace("-", "_")
    category_name = name.replace("-", " ").title()

    with open(ops_file, "w") as f:
        f.write(f'''"""
{category_name} operations for Simple Steps.

Add your @simple_step functions here. They'll be auto-discovered
when Simple Steps starts.
"""

from SIMPLE_STEPS.decorators import simple_step


@simple_step(
    id="{module_name}_example",
    name="{category_name} Example",
    category="{category_name}",
    operation_type="dataframe",
)
def {module_name}_example(df, threshold: float = 0.5):
    """Example operation — customize this for your domain."""
    return df
''')

    # Create a README
    with open(os.path.join(pack_dir, "README.md"), "w") as f:
        f.write(f"# {category_name}\n\n")
        f.write(f"A Simple Steps developer pack.\n\n")
        f.write("## Operations\n\n")
        f.write(f"| Operation | ID | Description |\n")
        f.write(f"|---|---|---|\n")
        f.write(f"| {category_name} Example | `{module_name}_example` | Example operation |\n")

    print(f"  ✅ Created pack '{name}' at {pack_dir}")
    print(f"     Edit {os.path.basename(ops_file)} to add your operations.")
    return pack_dir


def _scaffold_pip_pack(
    workspace: str, name: str, slug: str, target: Optional[str]
) -> str:
    """Create a full pip-installable pack structure."""
    if target:
        pack_dir = os.path.abspath(target)
    else:
        pack_dir = os.path.join(workspace, slug)

    if os.path.exists(pack_dir):
        raise FileExistsError(f"Directory already exists: {pack_dir}")

    pip_name = f"simple-steps-{slug}"
    module_name = f"simple_steps_{slug.replace('-', '_')}"
    category_name = name.replace("-", " ").title()

    # Create directory structure
    src_dir = os.path.join(pack_dir, "src", module_name)
    os.makedirs(src_dir, exist_ok=True)

    # pyproject.toml
    with open(os.path.join(pack_dir, "pyproject.toml"), "w") as f:
        f.write(f"""[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "{pip_name}"
version = "0.1.0"
description = "{category_name} operation pack for Simple Steps"
requires-python = ">=3.9"
readme = "README.md"
license = "MIT"

dependencies = [
    "simple-steps>=0.1.0",
]

[project.entry-points."simple_steps.packs"]
{slug.replace('-', '_')} = "{module_name}"

[tool.setuptools.packages.find]
where = ["src"]
""")

    # __init__.py
    with open(os.path.join(src_dir, "__init__.py"), "w") as f:
        f.write(f'''"""
{pip_name}
{"=" * len(pip_name)}
{category_name} operation pack for Simple Steps.

All @simple_step decorated functions are auto-registered
when Simple Steps starts — just: pip install {pip_name}
"""

from . import operations  # noqa: F401
''')

    # operations.py
    op_slug = slug.replace("-", "_")
    with open(os.path.join(src_dir, "operations.py"), "w") as f:
        f.write(f'''"""
{category_name} operations for Simple Steps.
"""

from SIMPLE_STEPS.decorators import simple_step


@simple_step(
    id="{op_slug}_example",
    name="{category_name} Example",
    category="{category_name}",
    operation_type="dataframe",
)
def {op_slug}_example(df, threshold: float = 0.5):
    """Example operation — customize this for your domain."""
    return df
''')

    # README.md
    with open(os.path.join(pack_dir, "README.md"), "w") as f:
        f.write(f"""# {pip_name}

{category_name} operation pack for [Simple Steps](https://github.com/stusynakowski/Simple_Steps).

## Installation

```bash
pip install {pip_name}
```

## Development

```bash
cd {slug}
pip install -e .
```

## Operations

| Operation | ID | Description |
|---|---|---|
| {category_name} Example | `{op_slug}_example` | Example operation |
""")

    print(f"  ✅ Created pip-installable pack '{pip_name}' at {pack_dir}")
    print(f"     Install for dev:  cd {slug} && pip install -e .")
    return pack_dir


# ── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_pack_path(workspace: str, entry: PackEntry) -> str:
    """Resolve a pack entry's path to an absolute filesystem path."""
    if not entry.path:
        return ""
    if os.path.isabs(entry.path):
        return entry.path
    return os.path.abspath(os.path.join(workspace, entry.path))


def _clone_or_pull(workspace: str, entry: PackEntry):
    """Clone a git repo (or pull if it already exists)."""
    abs_path = _resolve_pack_path(workspace, entry)
    if not abs_path:
        abs_path = os.path.join(workspace, PACKS_CACHE_DIR, entry.name)

    if os.path.isdir(os.path.join(abs_path, ".git")):
        # Repo already cloned — pull latest
        print(f"  🔄 Pulling latest for {entry.name}…")
        subprocess.run(
            ["git", "-C", abs_path, "pull", "--ff-only"],
            check=True,
            capture_output=True,
            text=True,
        )
        # Checkout the right ref if specified
        if entry.ref:
            subprocess.run(
                ["git", "-C", abs_path, "checkout", entry.ref],
                check=True,
                capture_output=True,
                text=True,
            )
    else:
        # Fresh clone
        os.makedirs(os.path.dirname(abs_path), exist_ok=True)
        print(f"  📥 Cloning {entry.url} → {abs_path}…")
        cmd = ["git", "clone", entry.url, abs_path]
        if entry.ref:
            cmd.extend(["--branch", entry.ref])
        subprocess.run(cmd, check=True, capture_output=True, text=True)


def _pip_install(package: str):
    """Install a pip package into the current environment."""
    print(f"  📥 pip install {package}…")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", package],
        check=True,
        capture_output=True,
        text=True,
    )
