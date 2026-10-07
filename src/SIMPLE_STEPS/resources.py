"""
resources.py — the app's resource types, and each session's live objects.

A **resource** is an object a workflow uses that is not data: an LLM client, a
database, a file system (``docs/dev_plan/122-skeleton-complete.md`` §2). Core
owns the model — ``res["db"]`` references, type checks, bound tools — and the
caller owns the live objects (core 007, Q1). This module is that caller side:

- :data:`RESOURCE_TYPES` — the types *this app* declared with
  ``@simple_step_resource``, by class name. A workflow names a type by that
  name in its ``resources`` section. Kept here rather than read from core's
  ``grid.RESOURCE_TYPES`` so a same-named type registered by another library
  (core's own example declares a ``FakeDB`` too) can never replace one of ours.
- :func:`live_resource` — the object a declaration describes, built on first
  use and kept per session, so every row and every step of a session share
  one instance. Changing a declaration's settings builds a new one.

Only ``"source": "defined"`` declarations exist so far. Loaded resources,
overrides and secrets are core's slice 3 (``docs/core-proposals/006`` R3/R4).
"""

from __future__ import annotations

import json
import threading
from typing import Any, Dict, Mapping, Optional, Tuple

#: Resource types this app declared, by class name — the ResourceRegistry.
RESOURCE_TYPES: Dict[str, type] = {}

# session id → {(name, type, settings as JSON): the live object}
_LIVE: Dict[str, Dict[Tuple[str, str, str], Any]] = {}
_LOCK = threading.Lock()


class ResourceError(ValueError):
    """A workflow's resource declaration that can't be used, with the reason."""


def register_type(cls: type) -> type:
    """Add *cls* to :data:`RESOURCE_TYPES` (``@simple_step_resource`` calls this)."""
    RESOURCE_TYPES[cls.__name__] = cls
    return cls


def resource_type(declaration: Mapping[str, Any], name: str) -> type:
    """The class a declaration names, or :class:`ResourceError`."""
    source = declaration.get("source", "defined")
    if source != "defined":
        raise ResourceError(
            f'resource "{name}" is {source!r}; only defined resources are '
            "supported so far (loaded ones come with core's slice 3)"
        )
    type_name = declaration.get("type")
    cls = RESOURCE_TYPES.get(type_name)
    if cls is None:
        known = ", ".join(sorted(RESOURCE_TYPES)) or "none"
        raise ResourceError(
            f'resource "{name}" is a {type_name!r}, which this app doesn\'t have '
            f"(its resource types: {known})"
        )
    return cls


def settings_of(declaration: Mapping[str, Any]) -> Dict[str, Any]:
    """A declaration's literal settings."""
    return dict(declaration.get("settings") or {})


def live_resource(session_id: Optional[str], name: str,
                  declaration: Mapping[str, Any]) -> Any:
    """The live object for *declaration* in this session, built on first use."""
    cls = resource_type(declaration, name)
    settings = settings_of(declaration)
    key = (name, cls.__name__, json.dumps(settings, sort_keys=True, default=str))
    with _LOCK:
        bucket = _LIVE.setdefault(session_id or "", {})
        obj = bucket.get(key)
        if obj is None:
            # A redefined resource replaces the old object under its name.
            for old in [k for k in bucket if k[0] == name]:
                del bucket[old]
            try:
                obj = cls(**settings)
            except Exception as exc:
                raise ResourceError(f'resource "{name}" could not be built: {exc}') from exc
            bucket[key] = obj
        return obj


def drop_session(session_id: Optional[str]) -> None:
    """Forget a session's live objects."""
    with _LOCK:
        _LIVE.pop(session_id or "", None)
