"""
resources.py — the app's resource types, ready-made resources, and each
session's live objects.

A **resource** is an object a workflow uses that is not data: an LLM client, a
database, a file system (``docs/dev_plan/122-skeleton-complete.md`` §2). Core
owns the model — ``res["db"]`` references, type checks, bound tools — and the
caller owns the live objects (core 007, Q1). This module is that caller side:

- :data:`RESOURCE_TYPES` — the types *this app* declared with
  ``@simple_step_resource``, by class name. A workflow names a type by that
  name in its ``resources`` section. Kept here rather than read from core's
  ``grid.RESOURCE_TYPES`` so a same-named type registered by another library
  (core's own example declares a ``FakeDB`` too) can never replace one of ours.
- :data:`LOADED` — **ready-made** resources the deployment provides
  (:func:`simple_step_loaded`): a type and settings, some of them read from the
  environment (:func:`env`) so credentials never reach a workflow file.
- :func:`resolve` — a workflow's declaration → the class and the settings to
  build it with. Two sources (122 §2.4a):

  ``{"source": "defined", "type": T, "settings": {…}}``
      the workflow's own resource, built from its saved settings;
  ``{"source": "loaded", "type": T, "as_loaded": {…}, "overrides": {…}}``
      the deployment's resource of that name, with the user's changes on top.
      ``as_loaded`` records the deployment's (non-secret) settings when the
      workflow was saved, so a later difference can be shown, never applied
      silently.

- :func:`live_resource` — the object a declaration describes, built on first
  use and kept per session, so every row and every step of a session share
  one instance. Changing a declaration's settings builds a new one.

Core sees neither source: the app hands it ``wf.define(name, Type, **settings)``
with the resolved settings, which core checks like any other. Secrets as typed
settings (core's ``Secret``, 006 R3) are still core's slice 3.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Mapping, Optional, Tuple

#: Resource types this app declared, by class name — the ResourceRegistry.
RESOURCE_TYPES: Dict[str, type] = {}

# session id → {(name, type, settings fingerprint): the live object}
_LIVE: Dict[str, Dict[Tuple[str, str, str], Any]] = {}
_LOCK = threading.Lock()


class ResourceError(ValueError):
    """A workflow's resource declaration that can't be used, with the reason."""


def register_type(cls: type) -> type:
    """Add *cls* to :data:`RESOURCE_TYPES` (``@simple_step_resource`` calls this)."""
    RESOURCE_TYPES[cls.__name__] = cls
    return cls


# ─────────────────────────────────────────────────────────────────────────────
# Ready-made resources: provided by the deployment
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Env:
    """A setting read from an environment variable when the resource is built.

    Its value is never written to a workflow, never shown, and can't be changed
    by a user: the workflow records only ``env:NAME``.
    """
    name: str
    default: Optional[str] = None

    @property
    def pointer(self) -> str:
        return f"env:{self.name}"

    def resolve(self, resource: str, setting: str) -> str:
        value = os.environ.get(self.name, self.default)
        if value is None:
            raise ResourceError(
                f'resource "{resource}" needs {setting} from the environment '
                f"variable {self.name}, which isn't set"
            )
        return value


def env(name: str, default: Optional[str] = None) -> Env:
    """A setting read from environment variable *name*: ``api_key=env("DB_KEY")``."""
    return Env(name, default)


@dataclass
class Loaded:
    """A ready-made resource: its type, its settings, and which ones users
    may not change. Settings given as :func:`env` are always locked."""
    type: type
    settings: Dict[str, Any] = field(default_factory=dict)
    locked: Tuple[str, ...] = ()

    @property
    def visible(self) -> Dict[str, Any]:
        """The settings a workflow may record: everything not read from the environment."""
        return {k: v for k, v in self.settings.items() if not isinstance(v, Env)}

    @property
    def from_env(self) -> Dict[str, str]:
        """Settings read from the environment, as ``env:NAME`` pointers."""
        return {k: v.pointer for k, v in self.settings.items() if isinstance(v, Env)}

    def is_locked(self, setting: str) -> bool:
        return setting in self.locked or isinstance(self.settings.get(setting), Env)


#: Ready-made resources this deployment provides, by name.
LOADED: Dict[str, Loaded] = {}


def simple_step_loaded(name: str, type_: type, /, *, locked: Iterable[str] = (),
                       **settings: Any) -> Loaded:
    """Provide a ready-made resource called *name* to every workflow.

    ::

        simple_step_loaded("study", ClinicalDB,
                           url="postgres://study", api_key=env("DB_KEY"),
                           locked=["url"])

    A workflow uses it by name, ``res["study"]``. Users may change its
    unlocked settings; the workflow saves only those changes (``overrides``),
    so the deployment's settings — and credentials — always apply underneath.
    """
    if not _NAME.match(name):
        raise ResourceError(f"{name!r} can't name a resource")
    if type_.__name__ not in RESOURCE_TYPES:
        raise ResourceError(
            f"{type_.__name__} isn't a resource type; declare it with @simple_step_resource"
        )
    loaded = Loaded(type_, dict(settings), tuple(locked))
    LOADED[name] = loaded
    return loaded


def loaded_info() -> Dict[str, Dict[str, Any]]:
    """What the UI may know about the ready-made resources: never a secret."""
    return {
        name: {"type": l.type.__name__, "settings": l.visible, "from_env": l.from_env,
               "locked": sorted(set(l.locked) | set(l.from_env))}
        for name, l in sorted(LOADED.items())
    }


# ─────────────────────────────────────────────────────────────────────────────
# Resolving a workflow's declaration
# ─────────────────────────────────────────────────────────────────────────────

def _type_named(type_name: Any, name: str) -> type:
    cls = RESOURCE_TYPES.get(type_name)
    if cls is None:
        known = ", ".join(sorted(RESOURCE_TYPES)) or "none"
        raise ResourceError(
            f'resource "{name}" is a {type_name!r}, which this app doesn\'t have '
            f"(its resource types: {known})"
        )
    return cls


def resolve(name: str, declaration: Mapping[str, Any], *,
            secrets: bool = True) -> Tuple[type, Dict[str, Any]]:
    """The class and settings a declaration builds with.

    With *secrets* false, settings read from the environment are left out —
    enough for core to check the declaration without the credentials.
    """
    source = declaration.get("source", "defined")
    if source == "defined":
        return (_type_named(declaration.get("type"), name),
                dict(declaration.get("settings") or {}))
    if source != "loaded":
        raise ResourceError(f'resource "{name}" has an unknown source {source!r}')

    loaded = LOADED.get(name)
    if loaded is None:
        raise ResourceError(
            f'resource "{name}" comes from the deployment, which doesn\'t provide it '
            f"here. Ask for it to be loaded, or define your own in the Resources menu"
        )
    declared = declaration.get("type")
    if declared and declared != loaded.type.__name__:
        raise ResourceError(
            f'resource "{name}" was saved as a {declared}, but the deployment provides '
            f"a {loaded.type.__name__}"
        )
    overrides = dict(declaration.get("overrides") or {})
    for setting in overrides:
        if loaded.is_locked(setting):
            raise ResourceError(f'resource "{name}": {setting} is set by the deployment')
    settings: Dict[str, Any] = {}
    for key, value in loaded.settings.items():
        if isinstance(value, Env):
            if secrets:
                settings[key] = value.resolve(name, key)
        else:
            settings[key] = value
    settings.update(overrides)
    return loaded.type, settings


def resource_type(declaration: Mapping[str, Any], name: str) -> type:
    """The class a declaration names, or :class:`ResourceError`."""
    return resolve(name, declaration, secrets=False)[0]


def live_resource(session_id: Optional[str], name: str,
                  declaration: Mapping[str, Any]) -> Any:
    """The live object for *declaration* in this session, built on first use."""
    cls, settings = resolve(name, declaration)
    # A fingerprint, not the settings themselves: they may hold a credential.
    fingerprint = hashlib.sha256(
        json.dumps(settings, sort_keys=True, default=str).encode()).hexdigest()
    key = (name, cls.__name__, fingerprint)
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


# ─────────────────────────────────────────────────────────────────────────────
# Declaring: what the Resources menu and the console send
# ─────────────────────────────────────────────────────────────────────────────

_NAME = re.compile(r"^[A-Za-z_][\w-]*$")


def _parse_definition(text: str) -> Tuple[str, Dict[str, Any]]:
    """``Claude(model="…")`` → ``("Claude", {"model": "…"})``."""
    text = (text or "").strip().lstrip("=").strip()
    try:
        node = ast.parse(text, mode="eval").body
    except SyntaxError as exc:
        raise ResourceError(f"Invalid definition: {exc.msg}") from None
    if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
        raise ResourceError('a resource is a type called with settings: Claude(model="…")')
    if node.args:
        raise ResourceError(f"{node.func.id}(…) takes settings by name, e.g. "
                            f'{node.func.id}(model="…")')
    settings: Dict[str, Any] = {}
    for kw in node.keywords:
        if kw.arg is None:
            raise ResourceError("**kwargs aren't allowed in a definition")
        try:
            settings[kw.arg] = ast.literal_eval(kw.value)
        except ValueError:
            raise ResourceError(
                f"{kw.arg}= must be a literal (text, a number, a list, …), "
                f"not {ast.unparse(kw.value)}"
            ) from None
    return node.func.id, settings


def declare(name: str, definition: str) -> Dict[str, Any]:
    """``("claude", 'Claude(model="claude-opus-5-5")')`` → a declaration.

    What the toolbar's Resources menu and the console's ``res["x"] = Type(…)``
    send. The definition is written in formula syntax: a resource type called
    with literal keyword settings.

    If *name* is a ready-made resource, the definition is the user's version of
    it: the declaration is ``source: "loaded"`` and records only the settings
    that differ from the deployment's (``overrides``). A setting the deployment
    locked, or reads from the environment, can't be changed. Otherwise the
    declaration is ``source: "defined"``.

    Core checks the result against the constructor (``wf.define``), so a bad
    setting is refused here, before it is saved, rather than when a step runs.
    """
    from simple_steps_core import grid

    name = (name or "").strip()
    if not _NAME.match(name):
        raise ResourceError(
            f"{name!r} can't name a resource; use letters, digits, _ or -, "
            "starting with a letter: res[\"claude\"]"
        )
    type_name, settings = _parse_definition(definition)

    loaded = LOADED.get(name)
    if loaded is not None:
        if type_name != loaded.type.__name__:
            raise ResourceError(
                f'"{name}" is the deployment\'s {loaded.type.__name__}; it can be '
                f"changed but not replaced. Pick another name for a {type_name}"
            )
        overrides: Dict[str, Any] = {}
        for key, value in settings.items():
            if loaded.is_locked(key):
                if isinstance(loaded.settings.get(key), Env) or value != loaded.settings.get(key):
                    raise ResourceError(
                        f'{key} is set by the deployment for "{name}" and can\'t be changed'
                    )
                continue
            if key not in loaded.settings or value != loaded.settings[key]:
                overrides[key] = value
        declaration: Dict[str, Any] = {"source": "loaded", "type": type_name,
                                       "as_loaded": loaded.visible}
        if overrides:
            declaration["overrides"] = overrides
    else:
        declaration = {"source": "defined", "type": type_name}
        if settings:
            declaration["settings"] = settings

    cls, checked = resolve(name, declaration, secrets=False)
    try:
        grid.Workflow().define(name, cls, **checked)
    except TypeError as exc:
        raise ResourceError(str(exc)) from None
    return declaration


def drop_session(session_id: Optional[str]) -> None:
    """Forget a session's live objects."""
    with _LOCK:
        _LIVE.pop(session_id or "", None)
