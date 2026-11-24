"""
core_bridge.py — the seam between this app and ``simple_steps_core``
===================================================================

``simple_steps_core`` is the heart of the backend: tools, the catalog, the
kernel and its checks. **This repo never edits core.** Where core cannot yet
express something we need, the gap is shimmed here and recorded in
``docs/core-proposals/008-core-changes.md``.

Every shim below is tagged with what removes it::

    SHIM(core §C18)  a tool's description is its docstring's first line, not
                     its first paragraph
    SHIM(core §C33)  inspect.signature(tool) is (*args, **kwargs), not the
                     function's
    SHIM(core §C34)  check_modifier and shape_verbs are internal
                     (simple_steps_core.catalog); the parser checks a
                     modifier's settings as you type with them
    SHIM(core §C36)  describe() lists a verb's retired name= setting, which
                     core then refuses
    SHIM(core §C45)  formula() raises SelectionError, not FormulaError, for a
                     selection it won't read (wf["s"][1][2]); read it as the
                     FormulaError it is
    SHIM(core §K23)  a running step can't be cancelled; stop the thread that
                     runs it instead

When core lands one of those, delete the tagged block. Nothing else should
need to change — that is the point of keeping them in one file.
"""

from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, Tuple

# `simple-steps-core` is declared as a git dependency, so an environment can
# end up with a core older than this app expects. Fail with the fix rather than
# a bare ImportError from four frames down: SIMPLE_STEPS/__init__ imports this
# module, so an older core otherwise makes the whole package unimportable.
try:
    from simple_steps_core import Catalog, Kernel, bound_tool, resource  # noqa: F401  (Kernel: the version check)
except ImportError as exc:  # pragma: no cover - environment-dependent
    import simple_steps_core as _core

    _missing = getattr(exc, "name_from", None) or "Kernel"
    raise ImportError(
        "This version of simple-steps needs a newer simple-steps-core.\n"
        f"  missing: {_missing}\n"
        f"  found core at: {getattr(_core, '__file__', '?')}\n"
        "\nThe kernel API (Catalog, Kernel) landed in core 0.2.0. Upgrade it with:\n"
        "  pip install --upgrade --force-reinstall "
        '"simple-steps-core @ git+https://github.com/stusynakowski/simple-steps-core.git"\n'
        "\nIf you are working from a checkout of this repo, point core at the\n"
        "submodule instead so the two cannot drift:\n"
        "  git submodule update --init external/simple-steps-core\n"
        "  pip install -e external/simple-steps-core"
    ) from exc

__all__ = [
    "docstring_summary",
    "with_signature",
    "check_modifier",
    "shape_verbs",
    "described_modifiers",
    "simple_step_resource",
    "formula",
    "RunCancelled",
    "interrupt",
]


# --------------------------------------------------------------------------- #
# Cancelling a run                                                            #
# --------------------------------------------------------------------------- #

class RunCancelled(BaseException):
    """Raised inside a running ``k.run`` to stop it (:func:`interrupt`).

    A ``BaseException``, so core's per-row error handling (which records an
    ``Exception`` as a failed row and goes on) lets it through and the run
    stops."""


def interrupt(thread_id: int) -> bool:
    """Stop the run in thread *thread_id* at its next Python instruction.

    SHIM(core §K23): core has no ``cancel()``. Run against 1.0.3: raising
    :class:`RunCancelled` in the thread running ``k.run`` ends it; the steps
    that had finished stay ``completed``, the interrupted one and those after
    it stay ``staged`` (nothing half-written), and the next run completes.
    A tool inside one long C call (numpy, a socket read) stops when that call
    returns; one that never returns can't be stopped from a thread (138 N2).
    The caller makes sure the thread is still inside ``k.run``.
    """
    import ctypes
    return ctypes.pythonapi.PyThreadState_SetAsyncExc(
        ctypes.c_ulong(thread_id), ctypes.py_object(RunCancelled)) == 1


# --------------------------------------------------------------------------- #
# Reading formulas                                                            #
# --------------------------------------------------------------------------- #

def formula(text: str) -> Any:
    """Core's ``formula(text)``, raising only ``FormulaError`` for text core
    won't read.

    SHIM(core §C45): for a selection it refuses (``wf["s"][1][2]``,
    ``[[0, "a"]]``, ``[::2]``) core raises ``SelectionError``, which callers
    expecting ``FormulaError`` don't catch: ``/api/parse_formula`` answered
    500, and one such step failed the whole workflow's sync.
    """
    from simple_steps_core import FormulaError, SelectionError
    from simple_steps_core import formula as core_formula
    try:
        return core_formula(text)
    except SelectionError as exc:
        raise FormulaError(str(exc)) from None


# --------------------------------------------------------------------------- #
# Tools                                                                       #
# --------------------------------------------------------------------------- #

def docstring_summary(fn: Callable) -> str:
    """The first paragraph of *fn*'s docstring, joined into one line.

    SHIM(core §C18): ``cat.describe()``'s ``description`` is the docstring's
    first *line*, so a summary wrapped over two lines is cut mid-sentence.
    Delete when core takes the first paragraph.
    """
    lines = []
    for line in (inspect.getdoc(fn) or "").splitlines():
        if not line.strip():
            if lines:
                break
            continue
        lines.append(line.strip())
    return " ".join(lines)


def with_signature(tool: Any) -> Any:
    """*tool* (core's ``Tool``), looking like its function to introspection.

    SHIM(core §C33): core's ``Tool`` carries ``__name__`` and ``__doc__`` but
    not ``__wrapped__``, so ``inspect.signature(tool)`` is ``(*args, **kwargs)``.
    Delete when core's ``Tool`` wraps its function.
    """
    functools.update_wrapper(tool, tool.fn, updated=())
    return tool


# --------------------------------------------------------------------------- #
# The parser's as-you-type checks                                             #
# --------------------------------------------------------------------------- #

def check_modifier(kind: str, settings: dict) -> Tuple[str, ...]:
    """Problems with one modifier's settings, as core words them.

    SHIM(core §C34): internal in core (``simple_steps_core.catalog``).
    """
    from simple_steps_core.catalog import check_modifier as _check
    return _check(kind, settings)


def shape_verbs() -> Tuple[str, ...]:
    """Core's shape verbs. SHIM(core §C34): internal in core."""
    from simple_steps_core.catalog import shape_verbs as _verbs
    return _verbs()


def described_modifiers(catalog: Catalog) -> dict:
    """``catalog.describe()["modifiers"]``, without the settings core refuses.

    SHIM(core §C36): every verb still lists ``name``, retired for
    ``mod.name(…)``, so the step editor would offer a field core then refuses.
    A setting is left out when core's own check calls it unknown. Delete when
    ``describe()`` lists only the settings a verb takes.
    """
    out = {}
    for kind, entry in catalog.describe()["modifiers"].items():
        kept = [s for s in entry["settings"]
                if not any(getattr(p, "code", None) == "unknown_setting"
                           for p in check_modifier(kind, {s["name"]: s.get("default")}))]
        out[kind] = {**entry, "settings": kept}
    return out


# --------------------------------------------------------------------------- #
# Resources                                                                   #
# --------------------------------------------------------------------------- #

def simple_step_resource(cls: type) -> type:
    """
    Declare a resource *type*: an object tools use (core's ``@resource``).

    The constructor's parameters are its literal settings, and the methods
    marked ``@simple_step_tool`` are its bound tools. Unmarked methods are
    never tools::

        @simple_step_resource
        class ClinicalDB:
            def __init__(self, url: str): ...

            @simple_step_tool
            def query(self, sql: str) -> pd.DataFrame: ...   # res["db"].query(…)

            def close(self) -> None: ...                     # not a tool
    """
    if not inspect.isclass(cls):
        raise TypeError("@simple_step_resource declares a class: an object tools use")
    from .resources import register_type
    return register_type(resource(cls))


def bound(func: Callable) -> Callable:
    """A method of a resource type, marked as one of its tools."""
    return bound_tool(func)
