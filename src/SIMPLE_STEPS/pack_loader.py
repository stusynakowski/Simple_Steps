"""
pack_loader.py — Three-Tier Operation Discovery & Registration
================================================================

Simple Steps discovers and loads decorated Python functions from three
tiers, each serving a different audience:

Tier 1 — **System Ops** (always loaded)
    Built-in operations that ship with the ``simple_steps`` package.
    Located in ``src/SIMPLE_STEPS/operations.py`` and
    ``src/SIMPLE_STEPS/orchestration_ops.py``.  These are imported by
    default when the app starts — no user action required.

Tier 2 — **Developer Packs** (opt-in, reusable across projects)
    Domain-specific function libraries created by developers for a
    particular problem space (e.g. YouTube mining, LLM analysis,
    web-scraping).  These live **outside** the core source in a
    well-known directory:

        <repo>/packs/
            youtube/
                youtube_ops.py
                analysis_ops.py
            webscraping/
                scraper_ops.py

    Or any external directory passed via:
        • CLI:  ``simple-steps --packs ./my_packs``
        • Env:  ``SIMPLE_STEPS_PACKS_DIR=/path/to/packs``

    The platform scans these directories and imports every ``.py`` file
    that contains ``@simple_step`` or ``@pack.step`` decorated functions.
    Developers can share packs as plain folders or git repos.

Tier 3 — **Project Ops** (per-project, auto-discovered)
    Custom functions that live inside a project directory alongside the
    pipeline JSON files.  When a project is opened, the platform scans
    for a ``ops/`` sub-folder (or any ``.py`` files in the project root)
    and registers the decorated functions automatically.

        projects/
            my-youtube-analysis/
                pipeline-1.json
                ops/
                    custom_scoring.py
                    helpers.py

    Any ``@simple_step``-decorated function found in those files is
    registered and becomes available to the pipelines in that project.

All three tiers share the same decorator (``@simple_step``) and the
same global ``OPERATION_REGISTRY``, so operations from any tier can be
referenced identically in formulas and the UI.

Dependencies: Each function's Python dependencies are assumed to be
installed in the active environment.  The ``OperationPack`` pattern
(tier 2) provides optional dependency-checking and health-check support.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import traceback
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set

if sys.version_info >= (3, 10):
    from importlib.metadata import entry_points
else:
    from importlib_metadata import entry_points  # type: ignore[no-redef]

from .decorators import OPERATION_REGISTRY

# Entry point group name — pip-installed packs advertise themselves here
ENTRY_POINT_GROUP = "simple_steps.packs"


# ─────────────────────────────────────────────────────────────────────────────
# Tier enum — used to tag where each operation came from
# ─────────────────────────────────────────────────────────────────────────────

class OpTier(str, Enum):
    SYSTEM = "system"
    DEVELOPER_PACK = "developer_pack"
    PROJECT = "project"


# ─────────────────────────────────────────────────────────────────────────────
# Load result — one per file import attempt
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class LoadResult:
    file_path: str
    tier: OpTier
    success: bool
    module_name: str = ""
    ops_registered: List[str] = field(default_factory=list)
    error: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# PackLoader — the main entry point
# ─────────────────────────────────────────────────────────────────────────────

class PackLoader:
    """
    Discovers and loads ``@simple_step``-decorated functions from all
    three tiers.  Keeps an audit log of what was loaded and from where.

    Usage (inside main.py)::

        loader = PackLoader(
            developer_pack_dirs=["./packs", "/shared/team-packs"],
            project_dirs=["./projects/my-project"],
        )
        loader.load_all()
        print(loader.summary())
    """

    def __init__(
        self,
        developer_pack_dirs: Optional[List[str]] = None,
        project_dirs: Optional[List[str]] = None,
    ):
        self.developer_pack_dirs: List[str] = developer_pack_dirs or []
        self.project_dirs: List[str] = project_dirs or []

        # Audit trail
        self._results: List[LoadResult] = []
        self._loaded_modules: Set[str] = set()

    # ── Public API ───────────────────────────────────────────────────────

    def load_all(self) -> List[LoadResult]:
        """
        Load all three tiers in order.  System ops are loaded via normal
        Python imports (they're already imported by main.py); this method
        handles Tier 2 and Tier 3.

        Returns the full list of LoadResults.
        """
        print("\n  ⚡ Pack Loader — discovering operations …\n")

        # Tier 1: System ops are imported by main.py directly
        #   (operations.py, orchestration_ops.py)
        #   We just note them for the audit log.
        self._audit_system_ops()

        # Tier 2a: pip-installed packs (entry points)
        self._load_installed_packs()

        # Tier 2b: Developer packs (filesystem directories)
        for pack_dir in self.developer_pack_dirs:
            self._load_directory(pack_dir, OpTier.DEVELOPER_PACK)

        # Tier 3: Project ops
        for proj_dir in self.project_dirs:
            self._load_project_ops(proj_dir)

        self._print_summary()
        return list(self._results)

    def load_project(self, project_dir: str) -> List[LoadResult]:
        """
        Load (or reload) operations for a single project.
        Call this when the user switches projects or opens a new one.

        Returns only the LoadResults for this project.
        """
        before = len(self._results)
        self._load_project_ops(project_dir)
        new_results = self._results[before:]

        if new_results:
            ok = sum(1 for r in new_results if r.success)
            fail = sum(1 for r in new_results if not r.success)
            print(f"  📂 Project ops for '{os.path.basename(project_dir)}': "
                  f"{ok} files loaded, {fail} failed")

        return new_results

    def load_developer_pack(self, pack_dir: str) -> List[LoadResult]:
        """
        Load a single developer pack directory on-demand.

        Returns only the LoadResults for this directory.
        """
        before = len(self._results)
        self._load_directory(pack_dir, OpTier.DEVELOPER_PACK)
        return self._results[before:]

    def get_results(self, tier: Optional[OpTier] = None) -> List[LoadResult]:
        """Return load results, optionally filtered by tier."""
        if tier is None:
            return list(self._results)
        return [r for r in self._results if r.tier == tier]

    def get_ops_by_tier(self) -> Dict[str, List[str]]:
        """
        Return a mapping of tier → list of operation IDs that were
        loaded from that tier.
        """
        result: Dict[str, List[str]] = {t.value: [] for t in OpTier}
        for r in self._results:
            if r.success:
                result[r.tier.value].extend(r.ops_registered)
        return result

    def summary(self) -> str:
        """Return a human-readable summary string."""
        lines = ["Pack Loader Summary", "=" * 40]
        by_tier = self.get_ops_by_tier()
        for tier_name, op_ids in by_tier.items():
            lines.append(f"  {tier_name}: {len(op_ids)} operations")
            for oid in op_ids:
                lines.append(f"    • {oid}")
        errors = [r for r in self._results if not r.success and r.error]
        if errors:
            lines.append("")
            lines.append(f"  ⚠️  {len(errors)} file(s) failed to load:")
            for r in errors:
                lines.append(f"    ❌ {r.file_path}: {r.error}")
        return "\n".join(lines)

    # ── Tier 1: System ───────────────────────────────────────────────────

    def _audit_system_ops(self):
        """
        System ops are loaded by normal import in main.py.  We snapshot
        the registry state so we can tag them as 'system' in the audit.
        """
        current_ids = set(OPERATION_REGISTRY.keys())
        self._results.append(LoadResult(
            file_path="<system>",
            tier=OpTier.SYSTEM,
            success=True,
            module_name="SIMPLE_STEPS.operations + orchestration_ops",
            ops_registered=sorted(current_ids),
        ))
        print(f"  🔧 System ops: {len(current_ids)} operations registered")

    # ── Tier 2a: pip-installed packs (entry points) ──────────────────────

    def _load_installed_packs(self):
        """
        Discover packs installed via pip.

        Any package that declares an entry point in the group
        ``simple_steps.packs`` will be imported automatically.

        Example in a pack's pyproject.toml::

            [project.entry-points."simple_steps.packs"]
            my_pack = "simple_steps_my_pack"

        The value is the Python module to import. Importing it triggers
        the ``@simple_step`` or ``@pack.step`` decorators, which
        register the operations into the global OPERATION_REGISTRY.
        """
        try:
            eps = entry_points(group=ENTRY_POINT_GROUP)
        except TypeError:
            # Python 3.9 compat: entry_points() doesn't support group= kwarg
            all_eps = entry_points()
            eps = all_eps.get(ENTRY_POINT_GROUP, [])

        if not eps:
            print("  📦 Installed packs: none found")
            return

        print(f"  📦 Installed packs: found {len(list(eps))} entry point(s)")

        for ep in eps:
            before_ids = set(OPERATION_REGISTRY.keys())
            try:
                ep.load()  # imports the module → triggers decorators
                after_ids = set(OPERATION_REGISTRY.keys())
                new_ops = sorted(after_ids - before_ids)

                # Tag new operations
                for op_id in new_ops:
                    entry = OPERATION_REGISTRY.get(op_id)
                    if entry:
                        entry["tier"] = OpTier.DEVELOPER_PACK.value
                        entry["source_file"] = f"<pip:{ep.name}>"

                self._results.append(LoadResult(
                    file_path=f"<pip:{ep.name}>",
                    tier=OpTier.DEVELOPER_PACK,
                    success=True,
                    module_name=ep.value,
                    ops_registered=new_ops,
                ))

                if new_ops:
                    print(f"    ✅ {ep.name}: {', '.join(new_ops)}")
                else:
                    print(f"    ⏭  {ep.name}: imported but no new operations")

            except Exception as e:
                self._results.append(LoadResult(
                    file_path=f"<pip:{ep.name}>",
                    tier=OpTier.DEVELOPER_PACK,
                    success=False,
                    module_name=getattr(ep, 'value', str(ep)),
                    error=f"{type(e).__name__}: {e}",
                ))
                print(f"    ❌ {ep.name}: {e}")
                traceback.print_exc()

    # ── Tier 2b & 3: File scanning ──────────────────────────────────────

    def _load_directory(self, dir_path: str, tier: OpTier):
        """
        Recursively scan a directory for Python files and import them.
        Any file containing ``@simple_step`` or ``@pack.step`` decorated
        functions will have those functions auto-registered into the
        global OPERATION_REGISTRY upon import.
        """
        abs_path = os.path.abspath(dir_path)

        if not os.path.isdir(abs_path):
            print(f"  ⚠️  Directory not found, skipping: {abs_path}")
            return

        tier_label = "📦 Developer Pack" if tier == OpTier.DEVELOPER_PACK else "📂 Project Ops"
        print(f"  {tier_label}: scanning {abs_path}")

        # Add to sys.path so internal imports within the plugin files work
        parent_dir = os.path.dirname(abs_path)
        for p in (abs_path, parent_dir):
            if p not in sys.path:
                sys.path.insert(0, p)

        for root, _dirs, files in os.walk(abs_path):
            for filename in sorted(files):
                if not filename.endswith(".py"):
                    continue
                if filename.startswith("__"):
                    continue  # skip __init__.py, __pycache__, etc.

                full_path = os.path.join(root, filename)
                self._import_file(full_path, tier)

    def _load_project_ops(self, project_dir: str):
        """
        Load operations from a project directory **recursively**.

        Scans every ``*.py`` file in the project directory tree, skipping
        ``__pycache__``, hidden directories, and ``__init__.py`` files.

        This means users can organise their custom operations any way they
        like — flat in the project root, in an ``ops/`` sub-folder, in
        deeply nested packages, etc.
        """
        abs_dir = os.path.abspath(project_dir)
        if not os.path.isdir(abs_dir):
            return

        print(f"  📂 Project Ops: recursively scanning {abs_dir}")

        # Ensure the project root is on sys.path so imports within
        # project files work as expected.
        if abs_dir not in sys.path:
            sys.path.insert(0, abs_dir)

        for root, dirs, files in os.walk(abs_dir):
            # Skip hidden directories and __pycache__
            dirs[:] = [
                d for d in dirs
                if not d.startswith(".") and d != "__pycache__"
            ]

            # Ensure each sub-directory is also on sys.path for relative
            # imports within project code.
            if root not in sys.path:
                sys.path.insert(0, root)

            for filename in sorted(files):
                if not filename.endswith(".py"):
                    continue
                if filename.startswith("__"):
                    continue

                full_path = os.path.join(root, filename)
                self._import_file(full_path, OpTier.PROJECT)

    # ── Low-level import ─────────────────────────────────────────────────

    def _import_file(self, file_path: str, tier: OpTier):
        """
        Import a single Python file and record which operations it
        registered.  If the file was already imported, skip it.
        """
        abs_path = os.path.abspath(file_path)

        if abs_path in self._loaded_modules:
            return  # already loaded

        # Snapshot the registry before import
        before_ids = set(OPERATION_REGISTRY.keys())

        module_name = os.path.splitext(os.path.basename(abs_path))[0]
        # Make module names unique to avoid collisions across directories
        unique_module_name = f"_ss_pack_{tier.value}_{module_name}_{hash(abs_path) % 10000}"

        try:
            spec = importlib.util.spec_from_file_location(unique_module_name, abs_path)
            if spec is None or spec.loader is None:
                self._results.append(LoadResult(
                    file_path=abs_path, tier=tier, success=False,
                    error="Could not create module spec",
                ))
                return

            module = importlib.util.module_from_spec(spec)
            sys.modules[unique_module_name] = module
            spec.loader.exec_module(module)

            # Check what new operations appeared
            after_ids = set(OPERATION_REGISTRY.keys())
            new_ops = sorted(after_ids - before_ids)

            # Tag the new operations with their tier
            for op_id in new_ops:
                entry = OPERATION_REGISTRY.get(op_id)
                if entry:
                    entry["tier"] = tier.value
                    entry["source_file"] = abs_path

            self._loaded_modules.add(abs_path)
            self._results.append(LoadResult(
                file_path=abs_path,
                tier=tier,
                success=True,
                module_name=unique_module_name,
                ops_registered=new_ops,
            ))

            if new_ops:
                print(f"    ✅ {os.path.basename(abs_path)}: {', '.join(new_ops)}")
            else:
                print(f"    ⏭  {os.path.basename(abs_path)}: no @simple_step functions found")

        except Exception as e:
            self._results.append(LoadResult(
                file_path=abs_path,
                tier=tier,
                success=False,
                module_name=unique_module_name,
                error=f"{type(e).__name__}: {e}",
            ))
            print(f"    ❌ {os.path.basename(abs_path)}: {e}")
            traceback.print_exc()

    # ── Reporting ────────────────────────────────────────────────────────

    def _print_summary(self):
        by_tier = self.get_ops_by_tier()
        total = sum(len(ops) for ops in by_tier.values())
        errors = sum(1 for r in self._results if not r.success)
        print(f"\n  ── Pack Loader complete ──")
        print(f"  Total operations: {total}")
        for tier_name, ops in by_tier.items():
            if ops:
                print(f"    {tier_name}: {len(ops)}")
        if errors:
            print(f"  ⚠️  {errors} file(s) had errors (see log above)")
        print()


# ─────────────────────────────────────────────────────────────────────────────
# Module-level convenience for project-level dynamic loading
# ─────────────────────────────────────────────────────────────────────────────

_global_loader: Optional[PackLoader] = None


def get_loader() -> Optional[PackLoader]:
    """Return the global PackLoader instance (set by main.py at startup)."""
    return _global_loader


def set_loader(loader: PackLoader):
    """Set the global PackLoader instance."""
    global _global_loader
    _global_loader = loader
