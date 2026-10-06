"""
core_bridge.py — the seam between this app and ``simple_steps_core``
===================================================================

``simple_steps_core`` is the heart of the backend: it owns the tool registry,
the tool contracts (:class:`ToolDefinition` / :class:`ToolParam`), resources
and the engine. **This repo never edits core.** Where core cannot yet express
something we need, the gap is shimmed here and recorded in
``docs/core-proposals/003-app-adoption.md``.

Every shim below is tagged with the proposal section that removes it::

    SHIM(core §A)  ToolParam has no `description` field
    SHIM(core §E)  output_schema is None for DataFrame / Series
    SHIM(core §G)  ToolDefinition.type has no 'step' member
    SHIM(core §J)  one DataFrame param empties the whole input_schema, and
                   reports every parameter's type_name as "Any"
    SHIM(core §K)  grid: no verb hands a tool the whole table
    SHIM(core §L)  grid: a step cannot take a value from another step
                   (core 004 §B6, P5)

When core lands one of those, delete the tagged block and read the value off
the :class:`ToolDefinition` instead. Nothing else should need to change — that
is the point of keeping them in one file.

What is *not* a shim: docstring **parsing** into per-argument text is proposed
for core (§A/§B), so this module is the only place that does it today.
"""

from __future__ import annotations

import inspect
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple, get_type_hints

import pandas as pd

from simple_steps_core import register_tool as _core_register_tool

# `simple-steps-core` is declared as a git dependency, so an environment can
# end up with a core older than this app expects. Fail with the fix rather than
# a bare ImportError from four frames down: SIMPLE_STEPS/__init__ imports this
# module, so an older core otherwise makes the whole package unimportable and
# the traceback points here instead of at the install.
try:
    from simple_steps_core import REGISTRY, ResourceSpec
except ImportError as exc:  # pragma: no cover - environment-dependent
    import simple_steps_core as _core

    # `name_from` is the name that could not be imported; `name` is the module
    # it was wanted from, which is not the useful half here.
    _missing = getattr(exc, "name_from", None) or "ResourceSpec"
    raise ImportError(
        "This version of simple-steps needs a newer simple-steps-core.\n"
        f"  missing: {_missing}\n"
        f"  found core at: {getattr(_core, '__file__', '?')}\n"
        "\nResourceSpec landed in core on 2026-09-22. Upgrade it with:\n"
        "  pip install --upgrade --force-reinstall "
        '"simple-steps-core @ git+https://github.com/stusynakowski/simple-steps-core.git"\n'
        "\nIf you are working from a checkout of this repo, point core at the\n"
        "submodule instead so the two cannot drift:\n"
        "  git submodule update --init external/simple-steps-core\n"
        "  pip install -e external/simple-steps-core"
    ) from exc

__all__ = [
    "ToolDocs",
    "parse_docstring",
    "tabular_output_form",
    "core_contract",
    "register_with_core",
    "simple_step_resource",
    "needs_whole_frame_shim",
]


# --------------------------------------------------------------------------- #
# Docstring parsing                                                           #
# --------------------------------------------------------------------------- #

@dataclass
class ToolDocs:
    """What a function's docstring says about itself."""

    summary: str = ""
    """The leading prose, before any Args:/Parameters: section."""

    params: Dict[str, str] = field(default_factory=dict)
    """Per-argument description, keyed by parameter name."""

    returns: str = ""
    """The Returns:/Yields: prose, if any."""


# Section headers we recognise, in either docstring dialect.
_ARG_HEADERS = ("args", "arguments", "parameters", "keyword args", "keyword arguments")
_RETURN_HEADERS = ("returns", "return", "yields", "yield")
_OTHER_HEADERS = ("raises", "examples", "example", "notes", "note", "see also",
                  "attributes", "warnings", "warning", "todo")

# Google style:  ``name: text``  or  ``name (str): text``
_GOOGLE_PARAM = re.compile(r"^(\*{0,2}\w+)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$")
# NumPy style:   ``name : str``  (description indented on the following lines)
_NUMPY_PARAM = re.compile(r"^(\*{0,2}\w+)\s*:\s*(.*)$")


def _header_kind(line: str) -> Optional[str]:
    """Classify a line as a section header: 'args', 'returns', 'other', or None."""
    bare = line.strip().rstrip(":").strip().lower()
    if not bare:
        return None
    if bare in _ARG_HEADERS:
        return "args"
    if bare in _RETURN_HEADERS:
        return "returns"
    if bare in _OTHER_HEADERS:
        return "other"
    return None


def parse_docstring(fn: Callable) -> ToolDocs:
    """
    Pull the summary, per-argument text and return text out of *fn*'s docstring.

    Handles both dialects used in this repo — Google (``Args:`` with
    ``name: text``) and NumPy (``Parameters`` underlined with ``---``, with the
    description on the following indented lines).

    **Never raises.** A malformed docstring yields empty strings, because tool
    registration happens at import time and a docstring typo must not take the
    server down. See proposal §B.
    """
    try:
        raw = inspect.getdoc(fn) or ""
        if not raw.strip():
            return ToolDocs()

        lines = raw.expandtabs().splitlines()
        summary: List[str] = []
        returns: List[str] = []
        params: Dict[str, List[str]] = {}

        section = "summary"
        current: Optional[str] = None   # parameter currently being described
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            # A NumPy header is a word followed by a line of dashes.
            if (i + 1 < len(lines)
                    and set(lines[i + 1].strip()) == {"-"}
                    and lines[i + 1].strip()):
                kind = _header_kind(stripped)
                if kind:
                    section, current = kind, None
                    i += 2
                    continue

            # A Google header is a recognised word ending in a colon.
            if stripped.endswith(":"):
                kind = _header_kind(stripped)
                if kind:
                    section, current = kind, None
                    i += 1
                    continue

            if section == "summary":
                summary.append(stripped)
            elif section == "returns":
                returns.append(stripped)
            elif section == "args":
                if not stripped:
                    i += 1
                    continue
                m = _GOOGLE_PARAM.match(stripped) or _NUMPY_PARAM.match(stripped)
                # A continuation line is indented further than the name it
                # belongs to and does not itself look like a new parameter.
                is_new_param = bool(m) and not (
                    current is not None
                    and m.group(1) == stripped.rstrip(":")
                    and not m.group(m.lastindex or 1)
                )
                if m and is_new_param:
                    current = m.group(1).lstrip("*")
                    tail = (m.group(3) if m.re is _GOOGLE_PARAM else "").strip()
                    params[current] = [tail] if tail else []
                elif current is not None:
                    params[current].append(stripped)
            elif section == "other":
                pass   # Raises:/Examples: are not part of the contract
            i += 1

        def _join(parts: List[str]) -> str:
            return " ".join(p for p in parts if p).strip()

        # The summary is the prose before the first blank line; anything after
        # it is elaboration that a tooltip does not want.
        first_para: List[str] = []
        for part in summary:
            if not part and first_para:
                break
            if part:
                first_para.append(part)

        return ToolDocs(
            summary=_join(first_para),
            params={k: _join(v) for k, v in params.items() if _join(v)},
            returns=_join(returns),
        )
    except Exception:
        # See the docstring: parsing must never break registration.
        return ToolDocs()


# --------------------------------------------------------------------------- #
# Output shape                                                                #
# --------------------------------------------------------------------------- #

def tabular_output_form(fn: Callable) -> Optional[str]:
    """
    Return core's cardinality word for *fn*'s return annotation — ``"grid"``,
    ``"column"``, or ``None`` when it is neither a DataFrame nor a Series.

    SHIM(core §E): core's ``output_schema`` is ``None`` for ``pd.DataFrame``
    and ``pd.Series``, which is most of a tabular product's tools. ``form`` is
    core's own vocabulary (``Output.form`` is ``"scalar" | "column" | "grid"``),
    so this reports a value core already defines.
    """
    try:
        hints = get_type_hints(fn)
    except Exception:
        return None
    ret = hints.get("return")
    if ret is pd.DataFrame:
        return "grid"
    if ret is pd.Series:
        return "column"
    return None


def _describe_return(fn: Callable) -> str:
    """A human-readable name for *fn*'s return annotation."""
    try:
        hints = get_type_hints(fn)
    except Exception:
        return "Any"
    ret = hints.get("return")
    if ret is None:
        return "Any"
    if ret is pd.DataFrame:
        return "DataFrame"
    if ret is pd.Series:
        return "Series"
    return getattr(ret, "__name__", None) or str(ret).replace("typing.", "")


# --------------------------------------------------------------------------- #
# The enriched contract                                                       #
# --------------------------------------------------------------------------- #

def literal_options(fn: Callable) -> Dict[str, List[Any]]:
    """
    The allowed values of every ``Literal``-annotated parameter of *fn*.

    Read from the function's own resolved annotations rather than from core's
    ``input_schema``, because that schema is unreliable here:

    SHIM(core §J): a single ``pd.DataFrame`` parameter empties the WHOLE
    ``input_schema`` — pydantic cannot model a DataFrame field, and core falls
    back to a bare ``{}`` for *every* property rather than just that one.
    Verified: a tool with ``(mode: Literal["a","b"], n: int)`` gets a complete
    schema; add ``df: pd.DataFrame`` and all three properties become ``{}``.
    Most of our table tools take a DataFrame, so for them the schema carries
    no types, no enums and no required flags.

    Resolving annotations directly is immune to that, and also handles
    ``Optional[Literal[...]]`` by dropping the ``None`` branch.

    Never raises: an unresolvable annotation yields no options rather than
    failing a registration.
    """
    import typing

    try:
        hints = get_type_hints(getattr(fn, "_raw_func", fn))
    except Exception:
        return {}

    found: Dict[str, List[Any]] = {}
    for name, hint in hints.items():
        if name == "return":
            continue
        values = _literal_values(hint)
        if values:
            found[name] = values
    return found


def annotation_type_names(fn: Callable) -> Dict[str, str]:
    """
    A readable type name per parameter, from *fn*'s resolved annotations.

    SHIM(core §J): for a tool that takes a ``pd.DataFrame``, core reports
    ``type_name='Any'`` for **every** parameter — the same failure that empties
    ``input_schema`` (see :func:`literal_options`). Without this, a DataFrame
    argument renders as a free-text box instead of a table picker, and an
    ``int`` argument loses its numeric widget.

    Never raises.
    """
    try:
        hints = get_type_hints(getattr(fn, "_raw_func", fn))
    except Exception:
        return {}

    names: Dict[str, str] = {}
    for key, hint in hints.items():
        if key == "return":
            continue
        name = getattr(hint, "__name__", None)
        if not name:
            # Literal[...], Optional[...] and friends have no __name__.
            name = str(hint).replace("typing.", "").split("[")[0]
        if name:
            names[key] = name
    return names


def _literal_values(hint: Any) -> Optional[List[Any]]:
    """Allowed values of a Literal, looking through Optional/Union wrappers."""
    import typing

    origin = typing.get_origin(hint)
    if origin is typing.Literal:
        return list(typing.get_args(hint))

    # Optional[Literal[...]] / Union[Literal[...], None]
    if origin is typing.Union:
        merged: List[Any] = []
        for arg in typing.get_args(hint):
            if arg is type(None):
                continue
            inner = _literal_values(arg)
            if inner:
                merged.extend(v for v in inner if v not in merged)
        return merged or None
    return None


def _type_of_options(values: Optional[List[Any]]) -> Optional[str]:
    """
    The JSON Schema type of a Literal's values, inferred from the values.

    Needed when core's schema is empty (see :func:`literal_options`), so the
    UI still knows that ``Literal[1, 2]`` is a number and ``Literal["a"]`` a
    string. ``bool`` is checked before ``int`` because it is a subclass.
    """
    if not values:
        return None
    first = values[0]
    if isinstance(first, bool):
        return "boolean"
    if isinstance(first, int):
        return "integer"
    if isinstance(first, float):
        return "number"
    if isinstance(first, str):
        return "string"
    return None


def _schema_options(prop: Dict[str, Any]) -> Optional[List[Any]]:
    """
    The allowed values of a parameter, from its JSON Schema fragment.

    Handles the two shapes pydantic emits for a ``Literal``: a direct ``enum``
    list, and a one-element ``const``. Also looks inside ``anyOf``, which is
    how ``Optional[Literal[...]]`` arrives — the ``None`` branch is dropped so
    the dropdown offers only real choices.

    Returns ``None`` (not ``[]``) when the parameter is unconstrained, so a
    caller can tell "no options" from "an empty enum".
    """
    if not isinstance(prop, dict):
        return None

    if isinstance(prop.get("enum"), list) and prop["enum"]:
        return list(prop["enum"])
    if "const" in prop:
        return [prop["const"]]

    merged: List[Any] = []
    for branch in prop.get("anyOf") or prop.get("oneOf") or []:
        if not isinstance(branch, dict) or branch.get("type") == "null":
            continue
        inner = _schema_options(branch)
        if inner:
            merged.extend(v for v in inner if v not in merged)
    return merged or None


@dataclass
class CoreContract:
    """A core :class:`ToolDefinition`, plus what core cannot yet carry."""

    tool_id: str
    description: str
    category: str
    type: str
    input_schema: Dict[str, Any] = field(default_factory=dict)
    output_schema: Optional[Dict[str, Any]] = None
    output_type: str = "Any"
    output_form: Optional[str] = None
    output_description: str = ""
    dependencies: List[str] = field(default_factory=list)
    resource: Optional[str] = None
    params: List[Dict[str, Any]] = field(default_factory=list)


def core_contract(
    fn: Callable,
    tool_id: str,
    *,
    category: str = "",
    operation_type: str = "raw_output",
    description: Optional[str] = None,
    resource: Optional[str] = None,
) -> CoreContract:
    """
    Register *fn* with core and return its contract, enriched with the fields
    core cannot express yet.

    Core supplies: ``params`` (name / type / required / default / kind),
    ``input_schema``, ``output_schema``, ``dependencies``, ``resource``.

    Shimmed here: the tool description when only a docstring exists
    (SHIM core §B), per-argument descriptions (SHIM core §A), and the output
    form for tabular returns (SHIM core §E).
    """
    docs = parse_docstring(fn)

    # SHIM(core §B): core takes only the decorator's `description=` and never
    # falls back to fn.__doc__. An explicit description still wins.
    resolved_description = description or docs.summary

    tool = register_with_core(
        fn,
        tool_id,
        description=resolved_description,
        category=category,
        operation_type=operation_type,
        resource=resource,
    )
    definition = REGISTRY.get_definition(getattr(tool, "operation_id", tool_id))

    params: List[Dict[str, Any]] = []
    # Core derives a correct JSON Schema for the data params, including `enum`
    # for a Literal annotation. ToolParam.type_name flattens that to the bare
    # word "Literal", so the allowed values are read off the schema instead —
    # they are the difference between a dropdown and a free-text box.
    schema_props = (definition.input_schema or {}).get("properties", {}) or {}
    # Annotations first: the schema is empty for any tool taking a DataFrame
    # (SHIM core §J, see literal_options).
    annotated_options = literal_options(fn)
    annotated_types = annotation_type_names(fn)

    for p in definition.params:
        prop = schema_props.get(p.name, {}) or {}
        params.append({
            "name": p.name,
            # Core's type_name is "Any" for every param of a DataFrame-taking
            # tool, so prefer the resolved annotation when core gives up.
            "type_name": (
                annotated_types.get(p.name, p.type_name)
                if p.type_name in ("Any", "", None) else p.type_name
            ),
            "required": p.required,
            "default": p.default,
            "kind": p.kind,
            "resource_name": p.resource_name,
            # SHIM(core §A): ToolParam has no `description` field, so the
            # docstring text is attached here instead of read off the param.
            "description": docs.params.get(p.name, ""),
            # The allowed values of a Literal, or None when unconstrained.
            "options": annotated_options.get(p.name) or _schema_options(prop),
            # The schema's own type, which resolves what "Literal" means:
            # Literal["a","b"] is a string, Literal[1,2] an integer. Falls back
            # to the type of the first allowed value when the schema is empty.
            "schema_type": prop.get("type") or _type_of_options(
                annotated_options.get(p.name)
            ),
        })

    form = tabular_output_form(fn)
    output_schema = definition.output_schema
    if output_schema is None and form is not None:
        # SHIM(core §E)
        output_schema = {
            "title": f"{tool_id}_Output",
            "type": "object",
            "x-form": form,
        }

    return CoreContract(
        tool_id=definition.operation_id,
        description=definition.description,
        category=definition.category,
        type=definition.type,
        input_schema=definition.input_schema,
        output_schema=output_schema,
        output_type=_describe_return(fn),
        output_form=form,
        output_description=docs.returns,
        dependencies=list(definition.dependencies),
        resource=definition.resource,
        params=params,
    )


# SHIM(core §G): core's ToolDefinition.type has no 'step' member, and this
# repo's v0.2 default operation type *is* 'step' — one call, one return value,
# no row iteration. Registering it raises a pydantic literal_error, so it is
# translated on the way into core and kept verbatim in the local
# OperationDefinition. 'raw_output' is the closest core member: a single raw
# value out, no tabular orchestration.
_CORE_TYPE_ALIASES = {
    "step": "raw_output",
    "rowmap": "map",
}


def core_operation_type(operation_type: str) -> str:
    """Translate one of this repo's operation types into a member core accepts."""
    return _CORE_TYPE_ALIASES.get(operation_type, operation_type)


def register_with_core(
    fn: Callable,
    tool_id: str,
    *,
    description: str = "",
    category: str = "",
    operation_type: str = "raw_output",
    resource: Optional[str] = None,
    aliases: Tuple[str, ...] = (),
):
    """
    Put *fn* into core's registry and return core's ``Tool``.

    ``operation_type`` is translated through :func:`core_operation_type` first
    — see SHIM(core §G) above. Core's ``register_tool`` also annotates ``type``
    as only ``source | dataframe | raw_output``, but every member of
    ``ToolDefinition.type`` works at runtime; that one is a wrong annotation,
    not a wrong behaviour (proposal §D).
    """
    operation_type = core_operation_type(operation_type)
    if resource is not None:
        return REGISTRY.register(
            tool_id, fn,
            description=description, category=category, type=operation_type,
            resource=resource, aliases=aliases,
        )
    return _core_register_tool(
        tool_id, description, category=category, type=operation_type,
    )(fn)


# --------------------------------------------------------------------------- #
# Resources                                                                   #
# --------------------------------------------------------------------------- #

def simple_step_resource(
    name: str,
    factory: Optional[Callable[[], Any]] = None,
    *,
    value: Any = None,
    check: Optional[Callable[[Any], Any]] = None,
    description: str = "",
) -> ResourceSpec:
    """
    Declare a resource — an object tools use — and get back core's
    :class:`ResourceSpec` to hang tools off.

    A spec with no ``factory`` and no ``value`` is **namespace-only**: it
    groups tools and injects nothing. That is how core models its own
    built-ins (the ``orchestration`` resource), and how this repo models its
    built-in tool groups::

        reshape = simple_step_resource("reshape", description="Table reshaping.")

        @reshape.tool("add_column", category="Data Reshaping", type="map")
        def add_column(df: pd.DataFrame, name: str, expression: str) -> pd.DataFrame:
            ...

    Bound tools register under a qualified id (``reshape-add_column``) with the
    bare name kept as an alias, so saved workflows keep resolving. A
    namespace-only spec becomes resource-backed later by adding ``factory=``
    to this same call — tool ids do not move, because they derive from *name*.
    """
    return ResourceSpec(
        name,
        factory=factory,
        value=value,
        check=check,
        description=description,
        registry=REGISTRY,
    )


# --------------------------------------------------------------------------- #
# Grid execution gaps                                                         #
# --------------------------------------------------------------------------- #

def needs_whole_frame_shim(verb: str, table_args: list, value_args: list) -> bool:
    """Whether a step must run on the legacy engine instead of core's grid.

    SHIM(core §K): every grid verb hands a tool one *row* (or a row and an
    accumulator); none hands it the whole table. Tools written as
    ``f(df: pd.DataFrame) -> pd.DataFrame`` — ``pivot``, ``unpivot``,
    ``pandas_eval``, ``merge_steps``, and any user tool of that shape — have
    no verb to run under, so they keep running on the legacy ``dataframe``
    orchestrator. Probe::

        piv[mod.collapse(over=w["r"])]  # failed: 'NoneType' has no 'groupby'
        piv[mod.map(over=w["r"])]       # invalid: piv() needs 'df', which 'r'
                                        #          does not have

    SHIM(core §L): a bound argument is a literal; nothing lets it be a value
    *from another step* — a single-call tool reading ``step1`` when ``step1``
    holds a dict, or ``values: list[float]`` reading a whole column
    (``=Step 1!COLA``). Core 004 §B6 plans this as P5. Until then the legacy
    path resolves the value and calls the tool.

    Delete this function, and its call in ``grid_runner.run_grid_step``, once
    core has a whole-table verb and P5.
    """
    return verb == "dataframe" or bool(table_args) or bool(value_args)
