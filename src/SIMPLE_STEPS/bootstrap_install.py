"""Bootstrap installer for Simple Steps from a GitHub repo URL.

This script is intentionally standalone so it can be executed directly from a
raw GitHub URL in any project directory.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_REPO_URL = "https://github.com/stusynakowski/Simple_Steps.git"


def _has_uv() -> bool:
    return shutil.which("uv") is not None


def _venv_python(venv_dir: Path) -> Path:
    if platform.system().lower().startswith("win"):
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def _activation_hint(venv_dir: Path) -> str:
    if platform.system().lower().startswith("win"):
        return f"{venv_dir}\\Scripts\\activate"
    return f"source {venv_dir}/bin/activate"


def _build_spec(repo_url: str, extras: list[str], ref: str | None) -> str:
    extras_part = f"[{','.join(extras)}]" if extras else ""
    git_url = f"git+{repo_url}"
    if ref:
        git_url = f"{git_url}@{ref}"
    return f"simple-steps{extras_part} @ {git_url}"


def _run(cmd: list[str], cwd: Path, dry_run: bool) -> None:
    print("$", " ".join(cmd))
    if dry_run:
        return
    subprocess.run(cmd, cwd=str(cwd), check=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="simple-steps-bootstrap",
        description=(
            "Create a project-local virtual environment and install Simple Steps "
            "from a GitHub repository URL using uv (if available) or pip."
        ),
    )
    parser.add_argument(
        "--project-dir",
        default=".",
        help="Target project directory (default: current directory)",
    )
    parser.add_argument(
        "--venv-dir",
        default=".venv",
        help="Virtual environment directory relative to project-dir (default: .venv)",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable used to create the venv (default: current Python)",
    )
    parser.add_argument(
        "--installer",
        choices=["auto", "uv", "pip"],
        default="auto",
        help="Installer backend (default: auto)",
    )
    parser.add_argument(
        "--repo-url",
        default=DEFAULT_REPO_URL,
        help="GitHub repository HTTPS URL (default: project repo)",
    )
    parser.add_argument(
        "--ref",
        default=None,
        help="Optional git ref (tag/branch/commit) to pin",
    )
    parser.add_argument(
        "--extras",
        default="",
        help="Comma-separated extras, e.g. dev or agent,agent-anthropic",
    )
    parser.add_argument(
        "--upgrade",
        action="store_true",
        help="Pass upgrade flag during install",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print commands without executing them",
    )
    args = parser.parse_args(argv)

    project_dir = Path(args.project_dir).expanduser().resolve()
    venv_dir = (project_dir / args.venv_dir).resolve()
    extras = [item.strip() for item in args.extras.split(",") if item.strip()]

    installer = args.installer
    if installer == "auto":
        installer = "uv" if _has_uv() else "pip"
    elif installer == "uv" and not _has_uv():
        print("Requested installer 'uv' but uv was not found on PATH.")
        return 2

    project_dir.mkdir(parents=True, exist_ok=True)

    if installer == "uv":
        create_cmd = ["uv", "venv", str(venv_dir), "--python", args.python]
    else:
        create_cmd = [args.python, "-m", "venv", str(venv_dir)]
    _run(create_cmd, cwd=project_dir, dry_run=args.dry_run)

    venv_python = _venv_python(venv_dir)
    spec = _build_spec(repo_url=args.repo_url, extras=extras, ref=args.ref)

    if installer == "uv":
        install_cmd = ["uv", "pip", "install", "--python", str(venv_python)]
        if args.upgrade:
            install_cmd.append("--upgrade")
        install_cmd.append(spec)
    else:
        install_cmd = [str(venv_python), "-m", "pip", "install"]
        if args.upgrade:
            install_cmd.append("--upgrade")
        install_cmd.append(spec)

    _run(install_cmd, cwd=project_dir, dry_run=args.dry_run)

    print()
    print("Simple Steps installed.")
    print(f"Project: {project_dir}")
    print(f"Venv:    {venv_dir}")
    print(f"Activate with: {_activation_hint(venv_dir)}")
    print("Then run: simple-steps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
