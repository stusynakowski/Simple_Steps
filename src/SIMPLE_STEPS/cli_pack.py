"""
simple-steps pack CLI
=====================
Subcommand for managing operation packs in the workspace.

Usage:
    simple-steps pack list                           # list declared packs
    simple-steps pack add <url-or-path>              # add a pack from git / local / pip
    simple-steps pack create <name>                  # scaffold a new local pack
    simple-steps pack create <name> --pip            # scaffold a pip-installable pack
    simple-steps pack remove <name>                  # remove a pack from manifest
    simple-steps pack install                        # install/sync all declared packs
"""

import argparse
import os
import sys
import re


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="simple-steps pack",
        description="Manage Simple Steps operation packs",
    )
    parser.add_argument(
        "--workspace", type=str, default=None,
        help="Workspace root directory (default: current working directory)",
    )

    sub = parser.add_subparsers(dest="action", help="Pack management action")

    # ── list ──────────────────────────────────────────────────────────────
    sub_list = sub.add_parser("list", help="List packs declared in simple_steps.toml")

    # ── add ───────────────────────────────────────────────────────────────
    sub_add = sub.add_parser("add", help="Add a pack (git URL, local path, or pip package)")
    sub_add.add_argument(
        "source",
        help="Git URL (https://..., git@...), local path, or pip package name",
    )
    sub_add.add_argument(
        "--name", type=str, default=None,
        help="Custom name for the pack in the manifest",
    )
    sub_add.add_argument(
        "--ref", type=str, default="main",
        help="Git branch or tag to checkout (default: main)",
    )
    sub_add.add_argument(
        "--no-install", action="store_true",
        help="Add to manifest without cloning/installing",
    )
    sub_add.add_argument(
        "--pip", action="store_true",
        help="Treat source as a pip package name",
    )

    # ── remove ────────────────────────────────────────────────────────────
    sub_remove = sub.add_parser("remove", help="Remove a pack from the manifest")
    sub_remove.add_argument("name", help="Pack name to remove")
    sub_remove.add_argument(
        "--delete", action="store_true",
        help="Also delete cloned files from disk",
    )

    # ── create ────────────────────────────────────────────────────────────
    sub_create = sub.add_parser("create", help="Scaffold a new pack")
    sub_create.add_argument("name", help="Name for the new pack")
    sub_create.add_argument(
        "--pip", action="store_true", dest="pip_installable",
        help="Create a full pip-installable pack (with pyproject.toml, src/ layout)",
    )
    sub_create.add_argument(
        "--target", type=str, default=None,
        help="Directory to create the pack in (default: packs/<name> or ./<name>)",
    )

    # ── install ───────────────────────────────────────────────────────────
    sub_install = sub.add_parser(
        "install", help="Install/sync all packs declared in simple_steps.toml"
    )

    args = parser.parse_args(argv)
    workspace = os.path.abspath(args.workspace or os.getcwd())

    if not args.action:
        parser.print_help()
        sys.exit(1)

    # Lazy import so the CLI starts fast
    from .pack_manager import (
        add_pack_git,
        add_pack_local,
        add_pack_pip,
        remove_pack,
        scaffold_pack,
        install_all,
        list_packs,
    )

    if args.action == "list":
        _cmd_list(workspace, list_packs)

    elif args.action == "add":
        _cmd_add(workspace, args, add_pack_git, add_pack_local, add_pack_pip)

    elif args.action == "remove":
        _cmd_remove(workspace, args, remove_pack)

    elif args.action == "create":
        _cmd_create(workspace, args, scaffold_pack)

    elif args.action == "install":
        _cmd_install(workspace, install_all)


# ── Command Implementations ──────────────────────────────────────────────────

def _cmd_list(workspace, list_packs_fn):
    """List all packs in the manifest."""
    packs = list_packs_fn(workspace)
    if not packs:
        print("\n  📋 No packs declared in simple_steps.toml")
        print("     Use `simple-steps pack add <url>` to add one.\n")
        return

    print(f"\n  📦 Packs declared in {os.path.join(workspace, 'simple_steps.toml')}:\n")
    for entry in packs:
        status = "✅" if entry.enabled else "⏸️ "
        if entry.source.value == "git":
            detail = f"{entry.url} ({entry.ref})"
        elif entry.source.value == "local":
            detail = entry.path
        else:
            detail = f"pip: {entry.package}"
        print(f"    {status} {entry.name:20s}  [{entry.source.value:5s}]  {detail}")
    print()


def _cmd_add(workspace, args, add_git_fn, add_local_fn, add_pip_fn):
    """Add a pack to the manifest."""
    source = args.source

    print()

    if args.pip:
        # Explicit pip mode
        entry = add_pip_fn(
            workspace, source, name=args.name,
            install=not args.no_install,
        )
        print(f"\n  📦 Added pip pack '{entry.name}' → {entry.package}\n")

    elif _is_git_url(source):
        # Git repository
        entry = add_git_fn(
            workspace, source, name=args.name, ref=args.ref,
            clone=not args.no_install,
        )
        print(f"\n  📦 Added git pack '{entry.name}' → {entry.url}")
        print(f"     Cloned to: {entry.path}\n")

    elif os.path.isdir(os.path.join(workspace, source)) or os.path.isdir(source):
        # Local directory
        entry = add_local_fn(workspace, source, name=args.name)
        print(f"\n  📦 Added local pack '{entry.name}' → {entry.path}\n")

    else:
        # Assume pip package
        entry = add_pip_fn(
            workspace, source, name=args.name,
            install=not args.no_install,
        )
        print(f"\n  📦 Added pip pack '{entry.name}' → {entry.package}\n")


def _cmd_remove(workspace, args, remove_fn):
    """Remove a pack from the manifest."""
    print()
    removed = remove_fn(workspace, args.name, delete_files=args.delete)
    if not removed:
        sys.exit(1)
    print()


def _cmd_create(workspace, args, scaffold_fn):
    """Scaffold a new pack."""
    print()
    try:
        pack_dir = scaffold_fn(
            workspace, args.name,
            target=args.target,
            pip_installable=args.pip_installable,
        )
        print()
        if args.pip_installable:
            print("  Next steps:")
            print(f"    1. cd {pack_dir}")
            print(f"    2. Edit src/*/operations.py to add your functions")
            print(f"    3. pip install -e .  (install in dev mode)")
            print(f"    4. Restart simple-steps\n")
        else:
            print("  Next steps:")
            print(f"    1. Edit the .py file in {pack_dir}")
            print(f"    2. Restart simple-steps — your ops will appear automatically\n")
    except FileExistsError as e:
        print(f"  ❌ {e}")
        sys.exit(1)


def _cmd_install(workspace, install_fn):
    """Install all packs from the manifest."""
    issues = install_fn(workspace)
    if issues:
        print(f"\n  ⚠️  {len(issues)} issue(s) during install:")
        for issue in issues:
            print(f"    • {issue}")
        print()
        sys.exit(1)
    else:
        print("\n  ✅ All packs installed successfully.\n")


# ── Utilities ────────────────────────────────────────────────────────────────

def _is_git_url(s: str) -> bool:
    """Check if a string looks like a git URL."""
    return (
        s.startswith("https://")
        or s.startswith("http://")
        or s.startswith("git@")
        or s.startswith("ssh://")
        or s.endswith(".git")
    )


if __name__ == "__main__":
    main()
