"""
tools.py — the registry from simple-steps-core's ``all_orchestrations`` example.

The same nine tools as core's ``examples/all_orchestrations/pipeline.py``,
declared for the app. Bodies and annotations match core's on purpose: core
infers a step's verb from them (``-> bool`` filters, ``-> list`` expands,
``(acc, n)`` collapses), so the same signals have to be here.

    simple-steps --workspace examples/all_orchestrations

The app imports this file from the workspace. (Running ``python tools.py``
would import it twice — once as the script, once from the workspace scan —
and list every tool twice.)

Then open ``projects/demo/all-orchestrations.simple-steps-workflow`` and run
it. ``check.py`` runs the same workflow headlessly and compares every step
with core's own output.
"""

from __future__ import annotations

from SIMPLE_STEPS import simple_step_loaded, simple_step_resource, simple_step_tool


@simple_step_tool(category="All orchestrations")
def scale(n, weight=1):
    """map: a value per row — the score.

    Args:
        n: the reading.
        weight: multiplies the score.
    """
    return n * 10 * weight


@simple_step_tool(category="All orchestrations")
def is_big(n) -> bool:
    """filter: a predicate — keep rows whose n is greater than one.

    Args:
        n: the reading.
    """
    return n > 1


@simple_step_tool(category="All orchestrations")
def label_city(city):
    """group: a key function — the bucket a row belongs to.

    Args:
        city: the row's city.
    """
    return city


@simple_step_tool(category="All orchestrations")
def add_n(acc, n):
    """collapse: a two-argument reducer — running sum of n.

    Args:
        acc: the running total.
        n: the reading to add.
    """
    return (acc or 0) + n


@simple_step_tool(category="All orchestrations")
def fan_out(n) -> list:
    """expand: each row yields a list — n copies of n.

    Args:
        n: how many copies, and their value.
    """
    return [n] * n


@simple_step_tool(category="All orchestrations")
def make_coords(n):
    """expand -> widen: each row yields a list of records to be spread wide.

    Args:
        n: the reading.
    """
    return [{"axis": "x", "val": n}, {"axis": "y", "val": n * 2}]


@simple_step_tool(category="All orchestrations")
def grid_cell(model, window):
    """sweep: run over the cross product of named parameter lists.

    Args:
        model: the model name.
        window: the window length.
    """
    return f"{model}:{window}"


@simple_step_tool(category="All orchestrations")
def risky(n):
    """failure: raises on a specific value so some rows fail and some pass.

    Args:
        n: the reading; 2 raises.
    """
    if n == 2:
        raise ValueError("twos are not allowed")
    return n * 100


@simple_step_tool(category="All orchestrations")
def make_pair(n):
    """tuple return — widen auto-names the positions c0, c1.

    Args:
        n: the reading.
    """
    return (n * 10, n * n)


# ─────────────────────────────────────────────────────────────────────────
# Resources — core's ``build_resources()`` example (core-proposals/007).
#
#   @simple_step_resource  on a class: a resource type, built from literal
#                          settings (core's @resource).
#   @simple_step_tool      on one of its methods: a BOUND tool, written
#                          res["db"].lookup[mod.map()](wf["keys"]). The method
#                          stays an ordinary method (core's @bound_tool).
#   @simple_step_tool      on a function with a resource-typed parameter: an
#                          UNBOUND tool, written
#                          enrich[mod.map()](wf["readings"], db=res["db"]).
#
# An unmarked method (FakeDB.reset) is never a tool, though tool code may call
# it. The workflow declares which instances exist in its `resources` section
# (projects/demo/resources.simple-steps-workflow); the app builds each one on
# first use, once per session.
# ─────────────────────────────────────────────────────────────────────────


@simple_step_resource
class FakeDB:
    """An in-memory table: city -> region."""

    def __init__(self, table: dict | None = None):
        self.table = dict(table or {"SF": "west", "NYC": "east", "LA": "west"})
        self.reads = 0

    @simple_step_tool
    def lookup(self, key: str) -> str | None:
        """The region stored for a key, or None.

        Args:
            key: the city to look up.
        """
        self.reads += 1
        return self.table.get(key)

    def reset(self) -> None:                      # unmarked: never a tool
        self.reads = 0


@simple_step_resource
class FakeLLM:
    """Answers deterministically: the model name, then the prompt upper-cased."""

    def __init__(self, model: str = "fake-1"):
        self.model = model
        self.calls = 0

    @simple_step_tool
    def complete(self, prompt: str) -> str:
        """One completion for a prompt.

        Args:
            prompt: the text to complete.
        """
        self.calls += 1
        return f"[{self.model}] {prompt.upper()}"


@simple_step_resource
class TinyLLM(FakeLLM):
    """A smaller FakeLLM — fits anywhere a FakeLLM is asked for."""


@simple_step_tool(category="Resources")
def enrich(city: str, db: FakeDB) -> str:
    """unbound: the region for a city, read from the database.

    Args:
        city: the city to look up.
        db: the database to read.
    """
    return db.lookup(city) or "unknown"


@simple_step_tool(category="Resources")
def summarize(text: str, llm: FakeLLM) -> str:
    """unbound: one line from the model.

    Args:
        text: the text to summarize.
        llm: the model to ask.
    """
    return llm.complete(text)


# ── A ready-made resource: provided by the deployment, not the workflow ──────
# Every workflow in this workspace can use res["house_llm"]. A workflow that
# changes a setting saves only the change (its `overrides`); the deployment's
# settings apply underneath. A real deployment reads credentials with
# env("NAME"), which a workflow can never see or change.
simple_step_loaded("house_llm", FakeLLM, model="house-1")
