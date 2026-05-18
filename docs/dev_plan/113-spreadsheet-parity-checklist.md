# Spreadsheet-parity checklist for the core pack

> Section §1.10 — the ops every spreadsheet user will reach for.
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

### 1.10 — Spreadsheet-parity checklist (core pack must-haves)

> **Goal.** A user familiar with Excel / Google Sheets should be able to do
> the 90% of tabular work they're used to *without* opening Python.  Each
> bullet below is a registered op in the **core pack**, with the
> spreadsheet-equivalent listed for orientation.

#### Filter / sort / select

| Bar form | Spreadsheet equivalent | Notes |
|---|---|---|
| `=filter(step1, step1.score > 0)` | AutoFilter / FILTER() | also: `=step1[step1.score > 0]` |
| `=sort(step1, by=["score"], desc=True)` | Sort dialog | multi-col: `by=["a","b"]`, `desc=[True,False]` |
| `=select(step1, ["url","score"])` | Hide/show columns | also `=step1[["url","score"]]` |
| `=rename(step1, {"old":"new"})` | Rename column | dict-style |
| `=drop(step1, ["junk"])` | Delete column | accepts list or single string |
| `=distinct(step1, by=["url"])` | Remove Duplicates | `by=None` = all columns |
| `=head(step1, n=10)` / `=tail(step1, n=10)` | Top/bottom N | |
| `=sample(step1, n=100, seed=42)` | RANDBETWEEN / sample | seedable for reproducibility |

#### Conditional logic per row

| Bar form | Spreadsheet equivalent |
|---|---|
| `=when(step1.score > 0.5, "high", "low")` | `IF(score>0.5, "high", "low")` |
| `=when_chain([(step1.x>0,"pos"),(step1.x<0,"neg")], default="zero")` | nested `IF` / `IFS` |
| `=case(step1.country, {"US":"NA","CA":"NA","DE":"EU"}, default="other")` | `SWITCH` / `LOOKUP` table |
| `=coalesce(step1.a, step1.b, 0)` | `IFNA` / `IFERROR` chain |

#### Joining two steps (VLOOKUP equivalent)

| Bar form | Spreadsheet equivalent |
|---|---|
| `=join(step1, step2, on="url")` | `VLOOKUP` / `INDEX-MATCH` (inner join by default) |
| `=join(step1, step2, on="url", how="left")` | left/right/outer joins |
| `=join(step1, step2, left_on="url", right_on="link")` | different col names |
| `=lookup(step1, step2, key="url", value="title")` | single-col VLOOKUP shorthand |

#### Stacking / concatenation

| Bar form | Spreadsheet equivalent |
|---|---|
| `=stack(step1, step2)` *(rows)* | append rows (same schema) |
| `=stack(step1, step2, fill_missing=True)` | rows with column union (NaN-fill) |
| `=hstack(step1, step2)` | side-by-side columns (must have same n rows) |

#### Window / running calculations

| Bar form | Spreadsheet equivalent |
|---|---|
| `=running_total(step1.score)` | running SUM in a helper column |
| `=running(step1.score, op="mean", window=7)` | moving average |
| `=rank(step1.score, desc=True)` | `RANK.EQ` |
| `=lag(step1.score, n=1)` | `=A2` looking back |
| `=lead(step1.score, n=1)` | look forward |
| `=cumsum(step1.score)` / `=cummax(step1.score)` | running statistics |

#### Type & null handling

| Bar form | Equivalent |
|---|---|
| `=cast(step1.x, to="int")` | `VALUE()` / `INT()` |
| `=cast(step1.t, to="date", fmt="%Y-%m-%d")` | `DATEVALUE` |
| `=fill_null(step1, value=0)` | `IFERROR(.., 0)` over the sheet |
| `=fill_null(step1.score, method="forward")` | drag-down fill |
| `=drop_null(step1, cols=["score"])` | filter blanks |

#### String + date helpers

| Bar form | Equivalent |
|---|---|
| `=upper(step1.name)` / `=lower(...)` / `=title(...)` | `UPPER` / `LOWER` / `PROPER` |
| `=trim(step1.name)` | `TRIM` |
| `=replace(step1.name, find="-", with="_")` | `SUBSTITUTE` |
| `=regex_extract(step1.url, pattern="//([^/]+)")` | regex helper |
| `=split(step1.fullname, sep=" ", into=["first","last"])` | text-to-columns |
| `=concat(step1.first, " ", step1.last, name="full")` | `&` concatenation |
| `=parse_date(step1.t, fmt="%Y-%m-%d")` | `DATEVALUE` |
| `=date_part(step1.t, part="year")` | `YEAR()` / `MONTH()` / `DAY()` |
| `=date_add(step1.t, days=7)` | date math |

#### Reductions (return a 1×k Cell/Row)

| Bar form | Equivalent |
|---|---|
| `=summary(step1, agg={"views":"sum","score":"mean"})` | bottom-of-column formulas |
| `=count_rows(step1)` | `COUNTA` |
| `=count_distinct(step1.url)` | `COUNTUNIQUE` |

> All of the above are *operations* (regular `=OP(...)` syntax), not new
> grammar — so the parser doesn't grow.  The work is in the **core pack**.


