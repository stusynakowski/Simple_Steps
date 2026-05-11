"""Utilities to publish a lightweight dataflow snapshot from Jupyter notebooks.

Notebooks can import this module and call :func:`register_step` whenever they
define or run a step. The data is written to a JSON file under a
`.simple_steps/` directory in the chosen workspace (by default the current
working directory or the path in env var SIMPLE_STEPS_WORKSPACE). A tiny
static viewer (docs/tools) can fetch and render this JSON to help visualize
the workflow while developing.

This is intentionally minimal and dependency-free.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_DIRNAME = ".simple_steps"
DEFAULT_FILENAME = "notebook_dataflow.json"


def _ensure_workspace_dir(workspace: Optional[str]) -> Path:
    base = None
    if workspace:
        base = Path(workspace)
    else:
        env = os.environ.get("SIMPLE_STEPS_WORKSPACE")
        if env:
            base = Path(env)
        else:
            base = Path.cwd()

    d = base / DEFAULT_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_datafile_path(workspace: Optional[str] = None) -> Path:
    """Return the path to the notebook dataflow JSON file for the workspace."""
    d = _ensure_workspace_dir(workspace)
    return d / DEFAULT_FILENAME


def load_dataflow(workspace: Optional[str] = None) -> Dict[str, Any]:
    """Load the current dataflow JSON. Returns an empty structure if no file.

    Returns a dict with key 'steps' mapping to a list.
    """
    p = get_datafile_path(workspace)
    if not p.exists():
        return {"steps": []}
    try:
        with p.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        # If the file is corrupted, return an empty skeleton so notebooks don't crash.
        return {"steps": []}


def write_dataflow(data: Dict[str, Any], workspace: Optional[str] = None) -> None:
    p = get_datafile_path(workspace)
    with p.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


def register_step(
    step_id: str,
    title: Optional[str] = None,
    inputs: Optional[List[str]] = None,
    outputs: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    workspace: Optional[str] = None,
) -> None:
    """Register or update a step in the notebook dataflow snapshot.

    Parameters
    - step_id: unique identifier for the step (string)
    - title: human-friendly title
    - inputs: list of input variable names or descriptions
    - outputs: list of output variable names or descriptions
    - metadata: optional free-form mapping for arbitrary info
    - workspace: optional path to workspace root where the .simple_steps dir will be placed

    This function is safe to call repeatedly from notebooks; it will upsert by step_id.
    """
    state = load_dataflow(workspace)
    steps = state.setdefault("steps", [])

    # find existing
    existing = None
    for s in steps:
        if s.get("id") == step_id:
            existing = s
            break

    entry = {
        "id": step_id,
        "title": title or step_id,
        "inputs": inputs or [],
        "outputs": outputs or [],
        "metadata": metadata or {},
    }

    if existing is not None:
        existing.update(entry)
    else:
        steps.append(entry)

    write_dataflow(state, workspace)


def clear_dataflow(workspace: Optional[str] = None) -> None:
    """Remove the dataflow JSON file for the workspace if it exists."""
    p = get_datafile_path(workspace)
    try:
        p.unlink()
    except Exception:
        # ignore errors (file may not exist)
        pass


__all__ = [
    "get_datafile_path",
    "load_dataflow",
    "write_dataflow",
    "register_step",
    "clear_dataflow",
]
