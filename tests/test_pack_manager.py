"""
Tests for the pack management system (pack_manager.py + cli_pack.py).
"""

import os
import sys
import json
import shutil
import tempfile
import textwrap
import pytest

# Add src to path so we can import SIMPLE_STEPS
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from SIMPLE_STEPS.pack_manager import (
    PackManifest,
    PackEntry,
    PackSource,
    load_manifest,
    save_manifest,
    add_pack_local,
    remove_pack,
    list_packs,
    get_manifest_pack_dirs,
    scaffold_pack,
    install_all,
    MANIFEST_FILENAME,
)


@pytest.fixture
def workspace(tmp_path):
    """Create a temporary workspace directory."""
    return str(tmp_path)


@pytest.fixture
def workspace_with_manifest(workspace):
    """Create a workspace with a sample simple_steps.toml."""
    manifest_path = os.path.join(workspace, MANIFEST_FILENAME)
    with open(manifest_path, "w") as f:
        f.write(textwrap.dedent("""\
            [packs]

            [packs.my-local]
            source = "local"
            path = "external/my-local-pack"

            [packs.some-git-pack]
            source = "git"
            url = "https://github.com/org/some-pack.git"
            ref = "main"
            path = ".packs/some-pack"
        """))
    return workspace


class TestManifestIO:
    """Test loading and saving the simple_steps.toml manifest."""

    def test_load_empty_workspace(self, workspace):
        """Loading from a workspace without a manifest returns empty."""
        m = load_manifest(workspace)
        assert isinstance(m, PackManifest)
        assert len(m.packs) == 0

    def test_load_manifest(self, workspace_with_manifest):
        """Loading a manifest with entries parses correctly."""
        m = load_manifest(workspace_with_manifest)
        assert len(m.packs) == 2
        assert "my-local" in m.packs
        assert "some-git-pack" in m.packs

        local = m.packs["my-local"]
        assert local.source == PackSource.LOCAL
        assert local.path == "external/my-local-pack"

        git = m.packs["some-git-pack"]
        assert git.source == PackSource.GIT
        assert git.url == "https://github.com/org/some-pack.git"
        assert git.ref == "main"

    def test_save_and_reload(self, workspace):
        """Saving a manifest and reloading it preserves data."""
        m = PackManifest()
        m.packs["test-pack"] = PackEntry(
            name="test-pack",
            source=PackSource.LOCAL,
            path="packs/test",
        )
        save_manifest(workspace, m)

        # Verify file was created
        assert os.path.isfile(os.path.join(workspace, MANIFEST_FILENAME))

        # Reload
        m2 = load_manifest(workspace)
        assert "test-pack" in m2.packs
        assert m2.packs["test-pack"].source == PackSource.LOCAL
        assert m2.packs["test-pack"].path == "packs/test"

    def test_save_git_pack(self, workspace):
        """Saving a git pack entry preserves URL and ref."""
        m = PackManifest()
        m.packs["remote"] = PackEntry(
            name="remote",
            source=PackSource.GIT,
            url="https://github.com/org/pack.git",
            ref="v1.0",
            path=".packs/pack",
        )
        save_manifest(workspace, m)

        m2 = load_manifest(workspace)
        assert m2.packs["remote"].url == "https://github.com/org/pack.git"
        assert m2.packs["remote"].ref == "v1.0"

    def test_save_pip_pack(self, workspace):
        """Saving a pip pack entry preserves the package name."""
        m = PackManifest()
        m.packs["from-pip"] = PackEntry(
            name="from-pip",
            source=PackSource.PIP,
            package="simple-steps-from-pip",
        )
        save_manifest(workspace, m)

        m2 = load_manifest(workspace)
        assert m2.packs["from-pip"].package == "simple-steps-from-pip"


class TestAddPack:
    """Test adding packs to the manifest."""

    def test_add_local_pack(self, workspace):
        """Adding a local pack creates a manifest entry."""
        # Create the local pack directory
        local_dir = os.path.join(workspace, "my-pack")
        os.makedirs(local_dir)

        entry = add_pack_local(workspace, "my-pack")

        assert entry.name == "my-pack"
        assert entry.source == PackSource.LOCAL
        assert entry.path == "my-pack"

        # Verify manifest was updated
        m = load_manifest(workspace)
        assert "my-pack" in m.packs

    def test_add_local_pack_with_name(self, workspace):
        """Adding a local pack with a custom name uses that name."""
        local_dir = os.path.join(workspace, "some-dir")
        os.makedirs(local_dir)

        entry = add_pack_local(workspace, "some-dir", name="custom-name")
        assert entry.name == "custom-name"

        m = load_manifest(workspace)
        assert "custom-name" in m.packs

    def test_add_nonexistent_local_raises(self, workspace):
        """Adding a non-existent local path raises FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            add_pack_local(workspace, "does-not-exist")


class TestRemovePack:
    """Test removing packs from the manifest."""

    def test_remove_pack(self, workspace):
        """Removing a pack deletes it from the manifest."""
        # Add a pack first
        local_dir = os.path.join(workspace, "to-remove")
        os.makedirs(local_dir)
        add_pack_local(workspace, "to-remove")

        # Verify it's there
        assert "to-remove" in load_manifest(workspace).packs

        # Remove it
        result = remove_pack(workspace, "to-remove")
        assert result is True
        assert "to-remove" not in load_manifest(workspace).packs

    def test_remove_nonexistent_returns_false(self, workspace):
        """Removing a pack that doesn't exist returns False."""
        result = remove_pack(workspace, "ghost")
        assert result is False


class TestListPacks:
    """Test listing packs."""

    def test_list_empty(self, workspace):
        """Listing packs on empty workspace returns empty list."""
        assert list_packs(workspace) == []

    def test_list_packs(self, workspace_with_manifest):
        """Listing packs returns all manifest entries."""
        packs = list_packs(workspace_with_manifest)
        assert len(packs) == 2
        names = {p.name for p in packs}
        assert names == {"my-local", "some-git-pack"}


class TestGetManifestPackDirs:
    """Test resolving manifest entries to filesystem directories."""

    def test_empty_workspace(self, workspace):
        """No manifest → no dirs."""
        assert get_manifest_pack_dirs(workspace) == []

    def test_local_pack_dir(self, workspace):
        """A local pack entry that exists on disk is returned."""
        pack_dir = os.path.join(workspace, "packs", "my-pack")
        os.makedirs(pack_dir)

        entry = add_pack_local(workspace, os.path.join("packs", "my-pack"))

        dirs = get_manifest_pack_dirs(workspace)
        assert len(dirs) == 1
        assert dirs[0] == pack_dir

    def test_missing_local_not_returned(self, workspace):
        """A local entry pointing to a missing directory is not returned."""
        m = PackManifest()
        m.packs["missing"] = PackEntry(
            name="missing", source=PackSource.LOCAL, path="does/not/exist"
        )
        save_manifest(workspace, m)

        dirs = get_manifest_pack_dirs(workspace)
        assert dirs == []

    def test_pip_packs_not_in_dirs(self, workspace):
        """Pip packs don't produce filesystem directories."""
        m = PackManifest()
        m.packs["pip-one"] = PackEntry(
            name="pip-one", source=PackSource.PIP, package="some-pip-pkg"
        )
        save_manifest(workspace, m)

        dirs = get_manifest_pack_dirs(workspace)
        assert dirs == []


class TestScaffold:
    """Test pack scaffolding."""

    def test_scaffold_local_pack(self, workspace):
        """Scaffolding a local pack creates the expected structure."""
        pack_dir = scaffold_pack(workspace, "my-domain")
        assert os.path.isdir(pack_dir)

        # Should have an ops file
        ops_files = [f for f in os.listdir(pack_dir) if f.endswith("_ops.py")]
        assert len(ops_files) == 1

        # Should have a README
        assert os.path.isfile(os.path.join(pack_dir, "README.md"))

        # Ops file should contain @simple_step decorator
        with open(os.path.join(pack_dir, ops_files[0])) as f:
            content = f.read()
        assert "@simple_step" in content
        assert 'category="My Domain"' in content

    def test_scaffold_pip_pack(self, workspace):
        """Scaffolding a pip-installable pack creates the full structure."""
        pack_dir = scaffold_pack(workspace, "my-domain", pip_installable=True)
        assert os.path.isdir(pack_dir)

        # Should have pyproject.toml
        assert os.path.isfile(os.path.join(pack_dir, "pyproject.toml"))

        # Should have src/ layout
        src_dir = os.path.join(pack_dir, "src")
        assert os.path.isdir(src_dir)

        # Module dir
        module_dirs = [d for d in os.listdir(src_dir) if not d.endswith(".egg-info")]
        assert len(module_dirs) == 1

        # __init__.py and operations.py
        module_dir = os.path.join(src_dir, module_dirs[0])
        assert os.path.isfile(os.path.join(module_dir, "__init__.py"))
        assert os.path.isfile(os.path.join(module_dir, "operations.py"))

        # pyproject.toml should have the entry point
        with open(os.path.join(pack_dir, "pyproject.toml")) as f:
            content = f.read()
        assert "simple_steps.packs" in content

    def test_scaffold_existing_raises(self, workspace):
        """Scaffolding into an existing directory raises FileExistsError."""
        os.makedirs(os.path.join(workspace, "packs", "exists"))
        with pytest.raises(FileExistsError):
            scaffold_pack(workspace, "exists")


class TestInstallAll:
    """Test the install_all function."""

    def test_install_empty(self, workspace):
        """Installing from empty manifest produces no issues."""
        issues = install_all(workspace)
        assert issues == []

    def test_install_local_present(self, workspace):
        """A local pack that exists on disk reports no issues."""
        pack_dir = os.path.join(workspace, "local-pack")
        os.makedirs(pack_dir)
        add_pack_local(workspace, "local-pack")

        issues = install_all(workspace)
        assert issues == []

    def test_install_local_missing(self, workspace):
        """A local pack that's missing reports an issue."""
        m = PackManifest()
        m.packs["ghost"] = PackEntry(
            name="ghost", source=PackSource.LOCAL, path="does/not/exist"
        )
        save_manifest(workspace, m)

        issues = install_all(workspace)
        assert len(issues) == 1
        assert "ghost" in issues[0]
        assert "not found" in issues[0]


class TestCLIPack:
    """Test the CLI pack subcommand (functional tests)."""

    def test_cli_list_empty(self, workspace, capsys):
        """CLI list on empty workspace shows helpful message."""
        from SIMPLE_STEPS.cli_pack import main as pack_main
        pack_main(["--workspace", workspace, "list"])
        output = capsys.readouterr().out
        assert "No packs" in output

    def test_cli_create_and_list(self, workspace, capsys):
        """CLI create then list shows the created pack."""
        from SIMPLE_STEPS.cli_pack import main as pack_main

        # Create
        pack_main(["--workspace", workspace, "create", "test-domain"])
        output = capsys.readouterr().out
        assert "Created pack" in output

        # Verify files exist
        pack_dir = os.path.join(workspace, "packs", "test-domain")
        assert os.path.isdir(pack_dir)

    def test_cli_create_pip(self, workspace, capsys):
        """CLI create --pip generates pip-installable structure."""
        from SIMPLE_STEPS.cli_pack import main as pack_main
        pack_main(["--workspace", workspace, "create", "my-pip-pack", "--pip"])
        output = capsys.readouterr().out
        assert "pip-installable" in output

        pack_dir = os.path.join(workspace, "my-pip-pack")
        assert os.path.isfile(os.path.join(pack_dir, "pyproject.toml"))
