"""
core_pack_v2_preview.py — Stage 3e placeholder operations.
==========================================================

These are **non-functional placeholders** that exist only so the frontend
``/api/operations`` introspection can see the proposed shape of the
Stage 3e core pack. The UI engineer can browse them in the operation
sidebar, hover over them to see the docstring, click "fx" to see the
parameter list — *exactly* the same path as for a real op — to confirm
that everything the UI needs is present before we ship implementations.

**None of these will run.** Each body raises ``NotImplementedError``
with a pointer back to the spec in
``dev_notes/stage3_formula_grammar_and_shape_vocabulary.md`` (§11).

ID suffix
---------
Every preview op uses the suffix ``_preview`` (e.g. ``literal_preview``,
``expand_preview``) so it cannot collide with the real op of the same
name in ``operations.py`` or in mock projects. When Stage 3e ships,
each placeholder is renamed by dropping the suffix and the old op
(``filter_rows``, ``select_*``, ``define_variable``, ``expand_cell``)
is deleted in the same commit.

Category
--------
All preview ops sit in ``"Core (preview · Stage 3e)"`` so they show up
in their own sidebar group — easy to find, easy to ignore once
promoted.

Shape contract (the key thing the UI must convey)
-------------------------------------------------
The Stage 3 principle is *the formula bar carries data references and
op calls — that's it*. How an op iterates (row-wise vs. whole-frame) is
decided at runtime by ``_auto_broadcast`` based on the **declared
parameter type** vs. the **actual argument shape**. Therefore every
placeholder below has **fully annotated parameters** — the annotation
is the contract. The UI should surface the annotation so the user can
predict what calling the op will do.

  *  param annotated ``pd.DataFrame``  → expects a whole frame
  *  param annotated ``pd.Series``     → expects a column
  *  param annotated a scalar          → broadcast row-wise if a column
                                          is passed in
  *  param annotated ``Callable``      → predicate (row → bool)
  *  param annotated ``Any``           → opaque cell (literals, JSON)
"""

from __future__ import annotations

from typing import Any, Callable, List, Optional, Union

import pandas as pd

from .decorators import simple_step


_NOT_IMPL_MSG = (
    "This op is a Stage 3e placeholder — see "
    "dev_notes/stage3_formula_grammar_and_shape_vocabulary.md §11 for the spec."
)

_CATEGORY = "Core (preview · Stage 3e)"


# ---------------------------------------------------------------------------
# 1. literal — single-cell step from any Python value
# ---------------------------------------------------------------------------

@simple_step(
    name="Literal (preview)",
    category=_CATEGORY,
    operation_type="source",
    id="literal_preview",
)
def literal_preview(value: Any = None) -> pd.DataFrame:
    """
    Wrap any Python value as a 1×1 step (column ``"value"``).

    **Replaces**: today's ``literal`` (string-eval) + ``define_variable
    (value="...", type="json")``. After Stage 3, dict and list *literals*
    are first-class in the formula bar — ``={"name":"alice"}`` and
    ``=[1,2,3]`` parse directly via ``ast.literal_eval`` and call this op
    with the *parsed* Python value, not a string to re-parse.

    Shape
    -----
    Input  : a single Python value (any type)
    Output : 1 row × 1 column (``"value"``) holding that value verbatim.
             Nested dicts/lists stay opaque — call ``expand`` to unfold.

    Examples
    --------
        =literal(value=42)
        =literal(value="hello")
        =literal(value={"name":"alice","age":30})
        =literal(value=[1,2,3])

    Or, more commonly, just write the literal — the bare-literal form
    desugars to this op:

        =42                                  # → literal(value=42)
        ={"name":"alice","age":30}           # → literal(value={...})
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


# ---------------------------------------------------------------------------
# 2. make_table — frame constructor from row records
# ---------------------------------------------------------------------------

@simple_step(
    name="Make Table (preview)",
    category=_CATEGORY,
    operation_type="source",
    id="make_table_preview",
)
def make_table_preview(rows: List[dict] = None) -> pd.DataFrame:
    """
    Build a DataFrame from a list of row records.

    **Replaces**: today's ``make_table(rows="<json string>")``. The JSON
    re-parsing dance goes away because ``rows`` is now annotated
    ``List[dict]`` — the bar's literal-list syntax produces a real
    Python list, no string-in-the-middle.

    Shape
    -----
    Input  : ``List[dict]`` — each dict becomes one row
    Output : N rows × M columns (union of dict keys, NaN for missing)

    Examples
    --------
        =make_table(rows=[{"name":"alice","score":90},
                          {"name":"bob","score":75}])

        =make_table(rows=[{"product":"apple","qty":10,"price":1.5},
                          {"product":"banana","qty":6,"price":0.75}])

    For columnar input (``{"col": [values]}``) or list-of-scalars, see
    ``to_rows`` — kept in the core pack for that purpose.
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


# ---------------------------------------------------------------------------
# 3. expand — unnest a column of dicts/lists into more rows or columns
# ---------------------------------------------------------------------------

@simple_step(
    name="Expand (preview)",
    category=_CATEGORY,
    operation_type="dataframe",
    id="expand_preview",
)
def expand_preview(
    df: pd.DataFrame,
    column: Optional[str] = None,
    sep: str = ".",
) -> pd.DataFrame:
    """
    Unnest dict/list cells into a proper table.

    **Replaces**: today's ``expand_cell()`` (which only handled the
    first cell of a 1×1 frame). The new op is column-aware and works on
    any-shape frame, picking the right behaviour from the cell value.

    Parameters
    ----------
    df : DataFrame
        Input — whole frame.
    column : str, optional
        Which column to unnest. If ``None`` and ``df`` is 1×1, unnests
        the single cell (preserves today's ``expand_cell`` behaviour for
        ``=literal({...})`` chains).
    sep : str
        Separator for flattened nested keys (``"a.b"``).

    Shape rules
    -----------
    ┌──────────────────────────────────┬───────────────────────────────────┐
    │ cell value (in target column)    │ output                            │
    ├──────────────────────────────────┼───────────────────────────────────┤
    │ list of dicts                    │ explode rows; dict keys → columns │
    │ list of scalars                  │ explode rows; one ``"value"`` col │
    │ dict (flat)                      │ keys → columns on this row        │
    │ dict (nested)                    │ keys → ``"a.sep.b"`` columns      │
    │ scalar                           │ pass-through                      │
    └──────────────────────────────────┴───────────────────────────────────┘

    Examples
    --------
        =expand(df=step1)                       # 1×1 cell → table
        =expand(df=step1, column="metadata")    # column of dicts → cols
        =expand(df=step1, column="tags")        # column of lists → rows

    Or chain off a literal:

        ={"user":{"name":"alice","age":30}}     # → 1×1 dict
        =expand(df=step1)                       # → user.name, user.age
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


# ---------------------------------------------------------------------------
# 4. filter — predicate-based row filter
# ---------------------------------------------------------------------------

@simple_step(
    name="Filter (preview)",
    category=_CATEGORY,
    operation_type="dataframe",
    id="filter_preview",
)
def filter_preview(
    df: pd.DataFrame,
    predicate: str = "",
) -> pd.DataFrame:
    """
    Keep rows where a predicate expression is true.

    **Replaces**: today's ``filter_rows(column=..., value=..., mode=...)``
    — a constrained API that only handles equality and substring match
    on a single column. The new op takes a **Python expression** with
    column names in scope, so the full power of pandas comparison +
    boolean composition is available with no extra syntax.

    Parameters
    ----------
    df : DataFrame
        Input frame.
    predicate : str
        A Python boolean expression. Column names are bound to the
        corresponding ``pd.Series`` of the frame (vectorised). Supports
        ``&`` / ``|`` / ``~`` and parentheses; behaves like ``df.query``
        but with full Python operators.

    Shape
    -----
    Input  : N rows × M columns
    Output : K rows × M columns, K ≤ N. Row order preserved; index reset.

    Examples
    --------
        =filter(df=step1, predicate="score > 80")
        =filter(df=step1, predicate="age >= 18 & city == 'NYC'")
        =filter(df=step1, predicate="name.str.startswith('a')")

    Two-step composition (filter on a derived column):

        Step 2 : =add_column(df=step1, name="pass", expr="score >= 60")
        Step 3 : =filter(df=step2, predicate="pass")

    UI affordance
    -------------
    The predicate text box should autocomplete column names from
    ``step1.columns`` — the upstream step's columns are already exposed
    to the formula picker, so reuse that source.
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


# ---------------------------------------------------------------------------
# Future reshape verbs (registered as placeholders so the sidebar shows
# the *intent* of where the core pack is heading — these will be filled
# in after Stage 3 ships).
# ---------------------------------------------------------------------------

@simple_step(
    name="Pivot (preview)",
    category=_CATEGORY,
    operation_type="dataframe",
    id="pivot_preview",
)
def pivot_preview(
    df: pd.DataFrame,
    index: str = "",
    columns: str = "",
    values: str = "",
    aggfunc: str = "first",
) -> pd.DataFrame:
    """
    Long → wide reshape. Spec mirrors ``pd.pivot_table``.

    Placeholder only — see §11 of the Stage 3 dev note.
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


@simple_step(
    name="Melt (preview)",
    category=_CATEGORY,
    operation_type="dataframe",
    id="melt_preview",
)
def melt_preview(
    df: pd.DataFrame,
    id_vars: List[str] = None,
    value_vars: List[str] = None,
    var_name: str = "variable",
    value_name: str = "value",
) -> pd.DataFrame:
    """
    Wide → long reshape. Spec mirrors ``pd.melt``.

    Placeholder only — see §11 of the Stage 3 dev note.
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


@simple_step(
    name="Group-By + Aggregate (preview)",
    category=_CATEGORY,
    operation_type="dataframe",
    id="groupby_agg_preview",
)
def groupby_agg_preview(
    df: pd.DataFrame,
    by: List[str] = None,
    agg: dict = None,
) -> pd.DataFrame:
    """
    Collapse rows by group, applying named aggregations per column.

    Parameters
    ----------
    by : list of column names to group on.
    agg : dict mapping ``{column: aggfunc}`` (e.g. ``{"score": "mean",
          "count": "sum"}``).

    Placeholder only — see §11 of the Stage 3 dev note.
    """
    raise NotImplementedError(_NOT_IMPL_MSG)


@simple_step(
    name="Cross-Join (preview)",
    category=_CATEGORY,
    operation_type="dataframe",
    id="cross_join_preview",
)
def cross_join_preview(
    a: pd.DataFrame,
    b: pd.DataFrame,
) -> pd.DataFrame:
    """
    Cartesian product of two frames. Every row of ``a`` paired with
    every row of ``b``. Required because the default multi-step
    broadcasting rule (§8.5) is zip-by-index, *not* cross-product.

    Placeholder only — see §11 of the Stage 3 dev note.
    """
    raise NotImplementedError(_NOT_IMPL_MSG)
