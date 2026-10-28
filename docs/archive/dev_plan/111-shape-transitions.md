# Shape transitions: expand, collapse, pivot, unpivot

> Section §1.8.
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

### 1.8 — Shape-changing operations (expand / collapse / pivot)

**This is the part you asked for help on.**  Proposal: four primitives,
all live in the core pack, all share a consistent `df_in → df_out`
shape contract.  Names chosen to avoid pandas jargon.

#### 1.8.1 — `Expand` (one row → many rows **or** one col → many cols)

```
=Expand(step1, column="tags" [, into="tag"] [, axis="rows"] [, sep=None])
```

`Expand` turns a column of *containers* into more rows or more columns,
depending on the container type.  **The default is chosen from the data**,
so most users never specify `axis=`.

##### Defaults — inferred from cell type

| Cell type in `column=` | Default `axis` | Result | Override |
|---|---|---|---|
| `list` / `tuple` / `set` | `"rows"` | n rows → Σ\|cells\| rows; other cols duplicated | `axis="cols"` → splits into N new columns (`col_0..col_N`); ragged → NaN-fill |
| `dict` (str→scalar) | `"cols"` | n rows × 1 col → n rows × k cols (dict keys become column names); original col dropped | `axis="rows"` → 2-col long format (`key`, `value`) — same shape as `Unpivot` |
| `str` with `sep=` provided | `"rows"` | string split into list, then row-expanded | `axis="cols"` → split into N new columns |
| scalar (int/float/str without `sep`) | ❌ error | "Cannot expand scalar column `x`. Did you mean `sep=`?" | |

##### Argument reference

| Arg | Default | Meaning |
|---|---|---|
| `column=` | — *(required if step has >1 col)* | which column to expand.  If step has exactly 1 col, may be omitted. |
| `into=` | source col name *(rows)* or `None` *(cols)* | name of the new column(s).  For `axis="cols"` from a list, accepts a list of names or a prefix string (`into="part_"` → `part_0, part_1, …`). |
| `axis=` | inferred (see table) | `"rows"` or `"cols"`; explicit override always wins. |
| `sep=` | `None` | if set, split string cells on `sep` first, then expand. |
| `keep_empty=` | `False` | if a cell is `[]` / `{}` / empty string, `False` drops the row; `True` keeps it with NaN. |

##### Examples

| Input | Output |
|---|---|
| `=Expand(step1, column="tags")` *(tags is list-valued)* | row-expand, `tags` column now scalar |
| `=Expand(step1, column="tags", into="tag")` | row-expand, new col `tag`, original `tags` dropped |
| `=Expand(step1, column="tags", axis="cols")` | one column per list position |
| `=Expand(step1, column="tags", axis="cols", into=["a","b","c"])` | named output columns |
| `=Expand(step1, column="props")` *(props is dict-valued)* | col-expand: dict keys → new columns |
| `=Expand(step1, column="props", axis="rows")` | long format: `key`, `value` |
| `=Expand(step1, column="csv_tags", sep=",")` | splits string → row-expand |
| `=Expand(step1.tags)` *(column-shorthand)* | 1-col table → row-expand of single col |

##### Mental model

`Expand` answers: "I have a column that holds *more than one value per row*.
Unpack it.  By default, lists grow rows; dicts grow columns; strings need
to be split first."  Everything else is an explicit override.

**Inverse:**  `Collapse(..., agg={...: "list"})` for the row-expand case;
`Pivot` / `Unpivot` for the col-expand case (those are stricter and
documented separately in §1.8.3 / §1.8.4).

#### 1.8.2 — `Collapse` (many rows → one row, by key)

```
=Collapse(step1, by=["channel"], agg={"views":"sum","tags":"list"})
```

Groups by `by`-columns; produces one row per group.  `agg` maps each
remaining column to a reducer:

| Reducer | Result |
|---|---|
| `"sum"`, `"mean"`, `"min"`, `"max"`, `"count"`, `"first"`, `"last"` | scalar per group |
| `"list"`, `"set"`, `"unique"` | list per group (inverse of `Expand`) |
| `"concat"` (strings only) | joined with `sep` (default `", "`) |
| any registered operation name | applied to the group's column as a series |

Columns not in `by` and not in `agg` → dropped *with* a warning chip
(`"3 columns dropped: a, b, c"`).

#### 1.8.3 — `Pivot` (long → wide)

```
=Pivot(step1, rows="channel", cols="month", values="views" [, agg="sum"])
```

Equivalent to pandas `pivot_table`.  Default agg is `"sum"`.  Missing
cells filled with `NaN` (or with `fill=` kwarg).

#### 1.8.4 — `Unpivot` (wide → long)  *(inverse of Pivot)*

```
=Unpivot(step1, keep=["channel"], into=("month","views"))
```

Every column **not** in `keep` becomes a row.  `into=(name_col, value_col)`
names the two emitted columns.

#### 1.8.5 — Mental model

| Direction | Op |
|---|---|
| rows ⤴ more rows | `Expand` |
| rows ⤵ fewer rows | `Collapse` |
| long ⟶ wide | `Pivot` |
| wide ⟶ long | `Unpivot` |

`Expand` and `Collapse` should be **inverses** for any list-aggregator
choice — that's a property test (§3 below).

#### 1.8.6 — Status

| # | Input | Expected | Status |
|---|---|---|---|
| 1.8a | `=Expand(step1, column="tags")` | n→Σ\|tags\| rows | ⬜ |
| 1.8b | `=Collapse(step1, by=["channel"], agg={"views":"sum"})` | one row per channel | ⬜ |
| 1.8c | `=Pivot(step1, rows="channel", cols="month", values="views")` | wide table | ⬜ |
| 1.8d | `=Unpivot(step1, keep=["channel"], into=("month","views"))` | long table | ⬜ |
| 1.8e | round-trip: `Collapse(Expand(x))` returns x (up to row order) | property | ⬜ |
| 1.8f | round-trip: `Unpivot(Pivot(x))` returns x (up to row order) | property | ⬜ |


