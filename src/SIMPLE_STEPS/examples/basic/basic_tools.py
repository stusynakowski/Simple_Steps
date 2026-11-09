"""
basic_tools.py — the basic example's tools: the core verbs, and data manipulation.

Two sets, both plain functions with a decorator:

- **Core verbs** — the nine tools of simple-steps-core's own
  ``all_orchestrations`` example, with the same bodies and annotations, because
  core infers a step's verb from them (``-> bool`` filters, ``-> list``
  expands, ``(acc, n)`` collapses). ``all-orchestrations`` runs every shape
  verb over them.
- **Data manipulation** — sources, per-row text and analysis tools, whole-table
  tools, and diagnostics (slow, sometimes failing). ``table-tools`` runs them.

Copy this file to start your own: everything a user can do in the UI comes
from functions like these.

    simple-steps run examples/basic/app.py     # this example alone, in the UI
    python examples/basic/runme.py             # run its workflows and check them
"""

from __future__ import annotations

import random
import statistics
import time
from typing import Literal

import pandas as pd

from SIMPLE_STEPS import simple_step_tool


# ──────────────────────────────────────────────────────────────────────────
# Core verbs — one tool per shape the grid can give a step.
# ──────────────────────────────────────────────────────────────────────────

@simple_step_tool(category="Basic: core verbs")
def scale(n, weight=1):
    """map: a value per row — the score.

    Args:
        n: the reading.
        weight: multiplies the score.
    """
    return n * 10 * weight


@simple_step_tool(category="Basic: core verbs")
def is_big(n) -> bool:
    """filter: a predicate — keep rows whose n is greater than one.

    Args:
        n: the reading.
    """
    return n > 1


@simple_step_tool(category="Basic: core verbs")
def label_city(city):
    """group: a key function — the bucket a row belongs to.

    Args:
        city: the row's city.
    """
    return city


@simple_step_tool(category="Basic: core verbs")
def add_n(acc, n):
    """collapse: a two-argument reducer — running sum of n.

    Args:
        acc: the running total.
        n: the reading to add.
    """
    return (acc or 0) + n


@simple_step_tool(category="Basic: core verbs")
def fan_out(n) -> list:
    """expand: each row yields a list — n copies of n.

    Args:
        n: how many copies, and their value.
    """
    return [n] * n


@simple_step_tool(category="Basic: core verbs")
def make_coords(n):
    """expand -> widen: each row yields a list of records to be spread wide.

    Args:
        n: the reading.
    """
    return [{"axis": "x", "val": n}, {"axis": "y", "val": n * 2}]


@simple_step_tool(category="Basic: core verbs")
def grid_cell(model, window):
    """sweep: run over the cross product of named parameter lists.

    Args:
        model: the model name.
        window: the window length.
    """
    return f"{model}:{window}"


@simple_step_tool(category="Basic: core verbs")
def risky(n):
    """failure: raises on a specific value so some rows fail and some pass.

    Args:
        n: the reading; 2 raises.
    """
    if n == 2:
        raise ValueError("twos are not allowed")
    return n * 100


@simple_step_tool(category="Basic: core verbs")
def make_pair(n):
    """tuple return — widen auto-names the positions var0, var1.

    Args:
        n: the reading.
    """
    return (n * 10, n * n)


# ──────────────────────────────────────────────────────────────────────────
# Sources — produce a table from nothing. These start a workflow.
# ──────────────────────────────────────────────────────────────────────────

@simple_step_tool(
    name="Make Range",
    category="Sources",
    operation_type="source",
    id="make_range",
)
def make_range(n: int = 10, start: int = 0) -> pd.DataFrame:
    """Produce a table of consecutive integers, one per row.

    The simplest possible source. Use it to check that a workflow runs at all.

        =make_range(n=5)
    """
    return pd.DataFrame({"n": list(range(start, start + n))})


@simple_step_tool(
    name="Sample People",
    category="Sources",
    operation_type="source",
    id="sample_people",
)
def sample_people(count: int = 8, seed: int = 0) -> pd.DataFrame:
    """A small fake dataset with mixed column types.

    Gives you strings, integers and floats in one table so downstream tools
    have something realistic to chew on.
    """
    rng = random.Random(seed)
    names = ["Ada", "Bao", "Chen", "Devi", "Eli", "Farah", "Gus", "Hana",
             "Ivo", "Jun", "Kai", "Lena"]
    cities = ["Lisbon", "Osaka", "Nairobi", "Quito", "Tallinn"]
    rows = []
    for i in range(count):
        rows.append({
            "name": names[i % len(names)],
            "age": rng.randint(19, 71),
            "city": rng.choice(cities),
            "score": round(rng.uniform(0, 100), 2),
        })
    return pd.DataFrame(rows)


@simple_step_tool(
    name="Split Text",
    category="Sources",
    operation_type="source",
    id="split_text",
)
def split_text(text: str = "alpha,beta,gamma", separator: str = ",") -> pd.DataFrame:
    """Split a string into one row per piece, in a ``text`` column — the
    name the text tools (``word_count``, ``to_upper``) read.

        split_text[mod.source()](text="a;b;c", separator=";")
    """
    parts = [p.strip() for p in text.split(separator) if p.strip()]
    return pd.DataFrame({"text": parts})


@simple_step_tool(
    name="Empty Table",
    category="Sources",
    operation_type="source",
    id="empty_table",
)
def empty_table(columns: str = "a,b,c") -> pd.DataFrame:
    """A table with columns but zero rows.

    Here to test the "empty in, empty out" rule: every downstream tool should
    return an empty result of the right shape rather than raising.
    """
    cols = [c.strip() for c in columns.split(",") if c.strip()]
    return pd.DataFrame({c: pd.Series(dtype="object") for c in cols})


# ──────────────────────────────────────────────────────────────────────────
# Per-cell tools — the engine runs these once per cell of an upstream column.
# ──────────────────────────────────────────────────────────────────────────

@simple_step_tool(
    name="Word Count",
    category="Text",
    operation_type="map",
    id="word_count",
)
def word_count(text: str) -> int:
    """Number of whitespace-separated tokens in one cell."""
    return len(str(text).split())


@simple_step_tool(
    name="To Upper",
    category="Text",
    operation_type="map",
    id="to_upper",
)
def to_upper(text: str) -> str:
    """Uppercase one cell."""
    return str(text).upper()


@simple_step_tool(
    name="Reverse Text",
    category="Text",
    operation_type="map",
    id="reverse_text",
)
def reverse_text(text: str) -> str:
    """Reverse the characters of one cell."""
    return str(text)[::-1]


@simple_step_tool(
    name="Classify Age",
    category="Analysis",
    operation_type="map",
    id="classify_age",
)
def classify_age(age: int) -> str:
    """Bucket an age into a life stage.

    Note the plain ``str`` return: the UI has no way to know the output is one
    of four fixed values. See the ``bucket_score`` tool below for the typed
    version of the same idea.
    """
    age = int(age)
    if age < 18:
        return "minor"
    if age < 40:
        return "young adult"
    if age < 65:
        return "adult"
    return "senior"


@simple_step_tool(
    name="Bucket Score",
    category="Analysis",
    operation_type="map",
    id="bucket_score",
)
def bucket_score(
    score: float,
    scheme: Literal["thirds", "halves", "pass_fail"] = "thirds",
) -> str:
    """Bucket a 0-100 score, using one of three named schemes.

    ``scheme`` is annotated with ``typing.Literal``, which is the right way to
    declare an enum argument: it tells the UI to render a dropdown and lets the
    engine reject a bad value before running. Today the decorator flattens it
    to a free-text field — this tool exists so that gap is visible in the UI.
    """
    value = float(score)
    if scheme == "pass_fail":
        return "pass" if value >= 50 else "fail"
    if scheme == "halves":
        return "upper" if value >= 50 else "lower"
    if value >= 66.7:
        return "high"
    if value >= 33.3:
        return "medium"
    return "low"


@simple_step_tool(
    name="Slow Double",
    category="Diagnostics",
    operation_type="map",
    id="slow_double",
)
def slow_double(n: int, delay_ms: int = 250) -> int:
    """Double a number, slowly.

    Use this to watch per-row progress reporting and to check that the UI stays
    responsive while a step is running. Ten rows at the default delay takes
    about 2.5 seconds.
    """
    time.sleep(max(0, int(delay_ms)) / 1000.0)
    return int(n) * 2


@simple_step_tool(
    name="Sometimes Fails",
    category="Diagnostics",
    operation_type="map",
    id="sometimes_fails",
)
def sometimes_fails(n: int, fail_on_multiples_of: int = 3) -> int:
    """Raise on some rows and succeed on others.

    Exercises partial failure: how the grid renders a per-row error, and
    whether a downstream step can still reference the rows that worked.
    """
    value = int(n)
    divisor = int(fail_on_multiples_of)
    if divisor and value != 0 and value % divisor == 0:
        raise ValueError(f"refusing to process {value}: a multiple of {divisor}")
    return value


# ──────────────────────────────────────────────────────────────────────────
# Whole-table tools — the engine passes the entire upstream table.
# ──────────────────────────────────────────────────────────────────────────

@simple_step_tool(
    name="Add Computed Column",
    category="Table",
    operation_type="dataframe",
    id="add_computed",
)
def add_computed(
    df: pd.DataFrame,
    source_column: str = "",
    new_column: str = "computed",
    operation: Literal["double", "square", "negate", "abs"] = "double",
) -> pd.DataFrame:
    """Derive a new numeric column from an existing one."""
    if source_column not in df.columns:
        raise ValueError(
            f"no column named {source_column!r}. Available: {list(df.columns)}"
        )
    out = df.copy()
    series = pd.to_numeric(out[source_column], errors="coerce")
    if operation == "square":
        out[new_column] = series ** 2
    elif operation == "negate":
        out[new_column] = -series
    elif operation == "abs":
        out[new_column] = series.abs()
    else:
        out[new_column] = series * 2
    return out


@simple_step_tool(
    name="Top N",
    category="Table",
    operation_type="dataframe",
    id="top_n",
)
def top_n(df: pd.DataFrame, column: str = "", n: int = 5,
          descending: bool = True) -> pd.DataFrame:
    """Keep the n highest (or lowest) rows by one column."""
    if df.empty:
        return df
    if column not in df.columns:
        raise ValueError(
            f"no column named {column!r}. Available: {list(df.columns)}"
        )
    return df.sort_values(column, ascending=not descending).head(int(n))


@simple_step_tool(
    name="Describe Table",
    category="Table",
    operation_type="dataframe",
    id="describe_table",
)
def describe_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per column: type, non-null count, and basic numeric stats.

    Handy as a last step to see what a workflow actually produced.
    """
    rows = []
    for col in df.columns:
        series = df[col]
        entry = {
            "column": col,
            "dtype": str(series.dtype),
            "non_null": int(series.notna().sum()),
            "unique": int(series.nunique(dropna=True)),
            "mean": None,
            "median": None,
        }
        numeric = pd.to_numeric(series, errors="coerce").dropna()
        if len(numeric):
            entry["mean"] = round(float(numeric.mean()), 4)
            entry["median"] = round(float(statistics.median(numeric)), 4)
        rows.append(entry)
    return pd.DataFrame(rows)


@simple_step_tool(
    name="Count By",
    category="Table",
    operation_type="dataframe",
    id="count_by",
)
def count_by(df: pd.DataFrame, column: str = "") -> pd.DataFrame:
    """Group by one column and count rows in each group."""
    if df.empty:
        return pd.DataFrame({"value": [], "count": []})
    if column not in df.columns:
        raise ValueError(
            f"no column named {column!r}. Available: {list(df.columns)}"
        )
    counts = df[column].value_counts(dropna=False).reset_index()
    counts.columns = ["value", "count"]
    return counts


# ──────────────────────────────────────────────────────────────────────────
# Non-tabular payloads — a cell holding something that is not a scalar.
# ──────────────────────────────────────────────────────────────────────────

@simple_step_tool(
    name="Build Record",
    category="Shapes",
    operation_type="map",
    id="build_record",
)
def build_record(value: str) -> dict:
    """Wrap a cell in a dict, so a cell holds a nested object.

    Tests that the grid can render a structured payload and that a later step
    can still address it.
    """
    text = str(value)
    return {
        "original": text,
        "length": len(text),
        "upper": text.upper(),
        "tokens": text.split(),
    }


@simple_step_tool(
    name="Make Series",
    category="Shapes",
    operation_type="map",
    id="make_series",
)
def make_series(n: int, length: int = 4) -> list:
    """Turn one cell into a list, so a later Expand has something to unpack."""
    base = int(n)
    return [base + i for i in range(int(length))]
