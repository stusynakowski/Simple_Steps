"""
Tests for PackLoader — validates three-tier operation discovery.
"""
import os
import sys
import tempfile
import textwrap
import pytest

# Ensure src/ is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from SIMPLE_STEPS.pack_loader import PackLoader, OpTier, LoadResult
from SIMPLE_STEPS.decorators import OPERATION_REGISTRY


# ── Helpers ──────────────────────────────────────────────────────────────────

def _write_ops_file(directory: str, filename: str, content: str) -> str:
    """Write a Python file with @simple_step functions into a temp dir."""
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        f.write(textwrap.dedent(content))
    return path


# ── Tier 1: System ops audit ────────────────────────────────────────────────

class TestSystemOpsAudit:
    def test_system_ops_are_recorded(self):
        """PackLoader should snapshot existing system ops after operations are imported."""
        # System ops are loaded by importing the operations module
        # (normally done by main.py at startup)
        import SIMPLE_STEPS.operations  # noqa: F401
        import SIMPLE_STEPS.orchestration_ops  # noqa: F401

        loader = PackLoader()
        loader.load_all()
        results = loader.get_results(tier=OpTier.SYSTEM)
        assert len(results) == 1
        assert results[0].success is True
        # System ops should include at least the built-in ones
        # (load_csv, filter_rows, drop_na, ss_map, etc.)
        assert len(results[0].ops_registered) > 0

    def test_get_ops_by_tier_has_system_key(self):
        loader = PackLoader()
        loader.load_all()
        by_tier = loader.get_ops_by_tier()
        assert "system" in by_tier
        assert "developer_pack" in by_tier
        assert "project" in by_tier


# ── Tier 2: Developer packs ─────────────────────────────────────────────────

class TestDeveloperPacks:
    def test_load_developer_pack_from_directory(self, tmp_path):
        """A .py file with @simple_step in a pack dir gets registered."""
        pack_dir = str(tmp_path / "my_pack")
        _write_ops_file(pack_dir, "scoring_ops.py", f"""\
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))
            from SIMPLE_STEPS.decorators import simple_step

            @simple_step(id="test_pack_score_{id(tmp_path)}", name="Test Score", category="Test Pack")
            def score_it(value: str = "hello") -> str:
                return value.upper()
        """)

        loader = PackLoader(developer_pack_dirs=[pack_dir])
        loader.load_all()

        op_id = f"test_pack_score_{id(tmp_path)}"
        assert op_id in OPERATION_REGISTRY
        entry = OPERATION_REGISTRY[op_id]
        assert entry.get("tier") == "developer_pack"
        assert entry.get("source_file") == os.path.join(pack_dir, "scoring_ops.py")

        # Cleanup
        del OPERATION_REGISTRY[op_id]

    def test_nonexistent_directory_is_skipped(self, tmp_path):
        """A missing directory should not cause an error."""
        loader = PackLoader(developer_pack_dirs=[str(tmp_path / "nope")])
        results = loader.load_all()
        errors = [r for r in results if not r.success]
        # Should not crash — it just prints a warning
        assert True

    def test_file_with_syntax_error_is_handled(self, tmp_path):
        """A broken .py file should not crash the loader."""
        pack_dir = str(tmp_path / "broken_pack")
        _write_ops_file(pack_dir, "bad_ops.py", """\
            def this_is_broken(
                # missing closing paren and colon
        """)

        loader = PackLoader(developer_pack_dirs=[pack_dir])
        loader.load_all()

        dev_results = loader.get_results(tier=OpTier.DEVELOPER_PACK)
        assert any(not r.success for r in dev_results)

    def test_nested_pack_directory(self, tmp_path):
        """Files in nested sub-folders should also be discovered."""
        nested_dir = str(tmp_path / "deep_pack" / "sub" / "module")
        op_id = f"test_nested_{id(tmp_path)}"
        _write_ops_file(nested_dir, "deep_ops.py", f"""\
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', '..', 'src'))
            from SIMPLE_STEPS.decorators import simple_step

            @simple_step(id="{op_id}", name="Deep Op", category="Deep")
            def deep_fn() -> str:
                return "deep"
        """)

        loader = PackLoader(developer_pack_dirs=[str(tmp_path / "deep_pack")])
        loader.load_all()

        assert op_id in OPERATION_REGISTRY
        del OPERATION_REGISTRY[op_id]


# ── Tier 3: Project ops ─────────────────────────────────────────────────────

class TestProjectOps:
    def test_load_from_ops_subfolder(self, tmp_path):
        """Operations in <project>/ops/ should be discovered."""
        project_dir = str(tmp_path / "my_project")
        ops_dir = os.path.join(project_dir, "ops")
        op_id = f"test_proj_ops_{id(tmp_path)}"
        _write_ops_file(ops_dir, "custom_ops.py", f"""\
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'src'))
            from SIMPLE_STEPS.decorators import simple_step

            @simple_step(id="{op_id}", name="Project Op", category="Project Custom")
            def custom_fn(x: str = "test") -> str:
                return x
        """)

        loader = PackLoader(project_dirs=[project_dir])
        loader.load_all()

        assert op_id in OPERATION_REGISTRY
        assert OPERATION_REGISTRY[op_id].get("tier") == "project"
        del OPERATION_REGISTRY[op_id]

    def test_load_from_project_root_py_files(self, tmp_path):
        """Loose .py files in the project root should also be loaded."""
        project_dir = str(tmp_path / "loose_project")
        op_id = f"test_loose_{id(tmp_path)}"
        _write_ops_file(project_dir, "my_helpers.py", f"""\
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src'))
            from SIMPLE_STEPS.decorators import simple_step

            @simple_step(id="{op_id}", name="Loose Op", category="Loose")
            def loose_fn() -> str:
                return "loose"
        """)

        loader = PackLoader(project_dirs=[project_dir])
        loader.load_all()

        assert op_id in OPERATION_REGISTRY
        del OPERATION_REGISTRY[op_id]

    def test_load_project_on_demand(self, tmp_path):
        """load_project() should work after initial load_all()."""
        loader = PackLoader()
        loader.load_all()

        project_dir = str(tmp_path / "late_project")
        ops_dir = os.path.join(project_dir, "ops")
        op_id = f"test_late_{id(tmp_path)}"
        _write_ops_file(ops_dir, "late_ops.py", f"""\
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'src'))
            from SIMPLE_STEPS.decorators import simple_step

            @simple_step(id="{op_id}", name="Late Op", category="Late")
            def late_fn() -> str:
                return "late"
        """)

        results = loader.load_project(project_dir)
        assert any(r.success for r in results)
        assert op_id in OPERATION_REGISTRY
        del OPERATION_REGISTRY[op_id]

    def test_duplicate_import_is_skipped(self, tmp_path):
        """Importing the same file twice should be a no-op."""
        project_dir = str(tmp_path / "dup_project")
        ops_dir = os.path.join(project_dir, "ops")
        op_id = f"test_dup_{id(tmp_path)}"
        _write_ops_file(ops_dir, "dup_ops.py", f"""\
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'src'))
            from SIMPLE_STEPS.decorators import simple_step

            @simple_step(id="{op_id}", name="Dup Op", category="Dup")
            def dup_fn() -> str:
                return "dup"
        """)

        loader = PackLoader(project_dirs=[project_dir])
        loader.load_all()

        # Load again — should not crash or duplicate
        results_before = len(loader.get_results())
        loader.load_project(project_dir)
        results_after = len(loader.get_results())

        # No new results should have been added (file already loaded)
        assert results_after == results_before

        del OPERATION_REGISTRY[op_id]


# ── Summary & Reporting ──────────────────────────────────────────────────────

class TestSummaryReporting:
    def test_summary_returns_string(self):
        loader = PackLoader()
        loader.load_all()
        text = loader.summary()
        assert "Pack Loader Summary" in text
        assert "system" in text

    def test_get_results_unfiltered(self):
        loader = PackLoader()
        loader.load_all()
        all_results = loader.get_results()
        assert len(all_results) >= 1  # at least the system audit

    def test_get_results_filtered_by_tier(self):
        loader = PackLoader()
        loader.load_all()
        system = loader.get_results(tier=OpTier.SYSTEM)
        assert all(r.tier == OpTier.SYSTEM for r in system)
