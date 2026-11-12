"""
file_io.py — the ``Folder`` resource: a folder on disk that steps read from
(``docs/dev_plan/weekend_developments/127-file-io.md``, F1).

Every app gets a ready-made one, ``res["workspace"]``: the folder the
Explorer shows, so a file uploaded there can be read by a step at once::

    res["workspace"].files[mod.source()](pattern="*.csv")
    res["workspace"].read[mod.source()](path="data/sales.csv")

More folders come from the Resources menu: ``Folder(path="…")``. A relative
path is the workspace's. No path a tool is given may leave its folder.
"""

from __future__ import annotations

import fnmatch
import hashlib
import os
from datetime import datetime, timezone

import pandas as pd

from .core_bridge import simple_step_resource
from .decorators import simple_step_tool
from .resources import Loaded, register_loaded

#: Folders ``files`` never lists: the ones the Explorer hides.
_SKIP = {"__pycache__", "node_modules", "venv", "dist", "build"}


def _hidden(name: str) -> bool:
    return name.startswith(".") or name in _SKIP or name.endswith(".egg-info")


@simple_step_resource
class Folder:
    """A folder on disk: list its files and read them as tables.

    Every app has one at the workspace root, ``res["workspace"]``.
    """

    def __init__(self, path: str = "."):
        from .file_manager import WORKSPACE_ROOT
        folder = os.path.expanduser(path)
        if not os.path.isabs(folder):
            folder = os.path.join(WORKSPACE_ROOT, folder)
        self.root = os.path.realpath(folder)
        if not os.path.isdir(self.root):
            raise ValueError(f"no folder at {self.root}")

    def _inside(self, path: str) -> str:
        """*path*, resolved inside this folder, or ValueError."""
        target = os.path.realpath(os.path.join(self.root, path))
        if os.path.commonpath([self.root, target]) != self.root:
            raise ValueError(f"{path!r} is outside the folder {self.root}")
        return target

    def _walk(self):
        for here, dirs, names in os.walk(self.root):
            dirs[:] = sorted(d for d in dirs if not _hidden(d))
            for name in sorted(names):
                if not _hidden(name):
                    full = os.path.join(here, name)
                    yield os.path.relpath(full, self.root).replace(os.sep, "/"), full

    def data_version(self) -> str:
        """Changes when any file in the folder is added, removed or modified,
        so a step that read the folder goes stale (core K25)."""
        h = hashlib.sha256()
        for rel, full in self._walk():
            try:
                st = os.stat(full)
            except OSError:
                continue
            h.update(f"{rel}\0{st.st_size}\0{st.st_mtime_ns}\n".encode())
        return h.hexdigest()[:16]

    @simple_step_tool
    def files(self, pattern: str = "*") -> pd.DataFrame:
        """One row per file in the folder that matches *pattern*: its path,
        size in bytes and when it was modified.

        Args:
            pattern: a glob over the path, e.g. ``*.csv`` or ``data/*``.
        """
        rows = []
        for rel, full in self._walk():
            if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(os.path.basename(rel), pattern):
                st = os.stat(full)
                rows.append({
                    "path": rel,
                    "size": st.st_size,
                    "modified": datetime.fromtimestamp(st.st_mtime, timezone.utc)
                                        .strftime("%Y-%m-%d %H:%M:%S"),
                })
        return pd.DataFrame(rows, columns=["path", "size", "modified"])

    @simple_step_tool
    def read(self, path: str, format: str = "auto") -> pd.DataFrame:
        """A file as a table. ``auto`` goes by its extension: ``.csv``,
        ``.tsv``, ``.json`` (records or columns), ``.jsonl``; anything else
        is read as text, one row per line.

        Args:
            path: the file, relative to the folder.
            format: auto, csv, tsv, json, jsonl or text.
        """
        target = self._inside(path)
        if not os.path.isfile(target):
            raise FileNotFoundError(f"no file {path!r} in {self.root}")
        fmt = format.lower()
        if fmt == "auto":
            ext = os.path.splitext(target)[1].lower().lstrip(".")
            fmt = ext if ext in ("csv", "tsv", "json", "jsonl") else "text"
        if fmt == "csv":
            return pd.read_csv(target)
        if fmt == "tsv":
            return pd.read_csv(target, sep="\t")
        if fmt == "json":
            return pd.read_json(target)
        if fmt == "jsonl":
            return pd.read_json(target, lines=True)
        if fmt == "text":
            with open(target, encoding="utf-8", errors="replace") as f:
                return pd.DataFrame({"line": f.read().splitlines()})
        raise ValueError(f"unknown format {format!r}: auto, csv, tsv, json, jsonl or text")


# Every app's workspace folder, as res["workspace"].
register_loaded("workspace", Loaded(Folder, path=".", locked=["path"]))
