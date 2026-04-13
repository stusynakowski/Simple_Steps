"""
file_manager.py
===============
Projects are *folders* inside the top-level ``projects/`` directory.

    projects/
        my-youtube-analysis/
            channel_scrape.json
            sentiment_v2.json
        data-cleaning/
            normalize.json

Each ``*.json`` file is a ``PipelineFile`` (steps + metadata, no runtime data).
"""

import json
import os
import re
from typing import List, Optional
from datetime import datetime

from .models import PipelineFile, ProjectInfo

# ── Workspace root ───────────────────────────────────────────────────────────
# The "workspace" is the directory the user launched simple-steps from.
# All project/pipeline storage is relative to this root.

WORKSPACE_ROOT = os.environ.get(
    "SIMPLE_STEPS_WORKSPACE",
    os.getcwd(),
)

PROJECTS_DIR = os.environ.get(
    "SIMPLE_STEPS_PROJECTS_DIR",
    os.path.join(WORKSPACE_ROOT, "projects"),
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Convert a display name to a safe directory / file slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "project"


def _project_dir(project_id: str) -> str:
    # Project IDs from list_projects() are already the raw folder name on disk.
    # Just sanitize away anything truly dangerous (path traversal, etc.)
    safe = re.sub(r"[^a-z0-9A-Z\-_]", "", project_id)
    return os.path.join(PROJECTS_DIR, safe)


def _pipeline_path(project_id: str, pipeline_id: str) -> str:
    # Try _slugify first (matches how save_pipeline creates the filename),
    # then fall back to plain sanitisation for IDs that are already on-disk slugs.
    slug = _slugify(pipeline_id)
    candidate = os.path.join(_project_dir(project_id), f"{slug}.json")
    if os.path.exists(candidate):
        return candidate
    # Fallback: sanitize but preserve underscores / case already on disk
    safe = re.sub(r"[^a-z0-9A-Z\-_]", "", pipeline_id)
    return os.path.join(_project_dir(project_id), f"{safe}.json")


def ensure_projects_dir():
    os.makedirs(PROJECTS_DIR, exist_ok=True)


# ── Project-level operations ─────────────────────────────────────────────────

def list_projects() -> List[ProjectInfo]:
    ensure_projects_dir()
    result = []
    for entry in sorted(os.listdir(PROJECTS_DIR)):
        full = os.path.join(PROJECTS_DIR, entry)
        if os.path.isdir(full):
            pipelines = [
                f[:-5]  # strip .json
                for f in sorted(os.listdir(full))
                if f.endswith(".json")
            ]
            result.append(ProjectInfo(id=entry, name=entry.replace("-", " ").title(), pipelines=pipelines))
    return result


def create_project(name: str) -> ProjectInfo:
    ensure_projects_dir()
    project_id = _slugify(name)
    os.makedirs(_project_dir(project_id), exist_ok=True)
    return ProjectInfo(id=project_id, name=name, pipelines=[])


def delete_project(project_id: str) -> bool:
    import shutil
    path = _project_dir(project_id)
    if os.path.isdir(path):
        shutil.rmtree(path)
        return True
    return False


# ── Pipeline-level operations ────────────────────────────────────────────────

def list_pipelines(project_id: str) -> List[PipelineFile]:
    """Return all pipeline definitions inside a project folder."""
    folder = _project_dir(project_id)
    if not os.path.isdir(folder):
        return []
    results = []
    for fname in sorted(os.listdir(folder)):
        if fname.endswith(".json"):
            try:
                with open(os.path.join(folder, fname)) as f:
                    data = json.load(f)
                pf = PipelineFile(**data)
                # Ensure the id matches the on-disk filename slug so that
                # load_pipeline(_slugify(id)) will find the right file.
                file_slug = fname[:-5]  # strip ".json"
                if _slugify(pf.id) != file_slug:
                    pf.id = file_slug
                results.append(pf)
            except Exception as e:
                print(f"Error reading {fname}: {e}")
    return results


def load_pipeline(project_id: str, pipeline_id: str) -> Optional[PipelineFile]:
    path = _pipeline_path(project_id, pipeline_id)
    if not os.path.exists(path):
        # Fallback: try the raw pipeline_id as a direct filename
        # (handles cases where the id IS the filename slug already)
        fallback = os.path.join(_project_dir(project_id), f"{pipeline_id}.json")
        if os.path.exists(fallback):
            path = fallback
        else:
            return None
    try:
        with open(path) as f:
            return PipelineFile(**json.load(f))
    except Exception as e:
        print(f"Error loading pipeline {pipeline_id}: {e}")
        return None


def save_pipeline(project_id: str, pipeline: PipelineFile) -> PipelineFile:
    """Save (create or overwrite) a pipeline file inside a project folder."""
    # Ensure the project folder exists
    os.makedirs(_project_dir(project_id), exist_ok=True)

    now = datetime.now().isoformat()
    if not pipeline.created_at:
        pipeline.created_at = now
    pipeline.updated_at = now

    # Use pipeline id as filename slug
    pipeline_slug = _slugify(pipeline.id) or _slugify(pipeline.name)
    path = os.path.join(_project_dir(project_id), f"{pipeline_slug}.json")
    with open(path, "w") as f:
        f.write(pipeline.model_dump_json(indent=2))

    return pipeline


def delete_pipeline(project_id: str, pipeline_id: str) -> bool:
    path = _pipeline_path(project_id, pipeline_id)
    if not os.path.exists(path):
        # Fallback: try the raw pipeline_id as a direct filename
        fallback = os.path.join(_project_dir(project_id), f"{pipeline_id}.json")
        if os.path.exists(fallback):
            path = fallback
        else:
            return False
    os.remove(path)
    return True

