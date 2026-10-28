# Execution model, cross-cutting invariants, source ops

> Sections §1.12 (invariants), §1.13 (sequential/async), §1.14 (source ops).
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

### 1.12 — Cross-cutting concerns (must hold across every formula)

Easy to forget; nasty bugs when violated.

1. **Reactivity / dependency graph.**  If step 5 references `step1.url`
   and step 1 re-runs, step 5's "stale" pill turns on; running step 5
   uses the new step1 output, not the old.  The graph is built from
   the parsed formula (string-match `stepN` tokens).
2. **Error propagation.**  If step 1 errors, `step1.url` in step 5
   surfaces as `ERROR(step1)` cells in the grid (not a Python exception);
   step 5's pill goes red with "Upstream failure in step 1" and the
   banner deep-links to step 1's traceback.
3. **Empty input — "empty in, empty out".**  Every op must handle empty
   inputs the same way Python handles an empty iterable: by returning
   the *identity element* of its output shape, not by crashing.

   | Input | Op category | Expected output |
   |---|---|---|
   | empty `Table` (0 rows, k cols) | row-wise (`filter`, `sort`, `apply`, `Expand`) | empty Table with same k cols + dtypes |
   | empty `Column` (0 rows) | per-cell (`upper`, `cast`, arithmetic) | empty Column with same dtype |
   | empty `Column` | reduction (`sum`, `mean`, `count`, `max`) | **empty `Cell`** — `Cell(None, name=<src>)`; pill stays green, not red |
   | empty `Column` | `count` specifically | `Cell(0)` (count of nothing is 0, not None) |
   | empty `Table` | reduction-to-row (`summary`) | 1-row Table where every value is `None` (or `0` for counts) |
   | empty `Table` | `Collapse` | empty Table with `by=` cols only |
   | empty `Table` | `Pivot` / `Unpivot` | empty Table (no synthesized cells) |
   | empty `Table` | `join` | empty Table with the join's column union |
   | empty `Table` | `stack(empty, step2)` | `step2` (identity element of stacking) |

   The mental model is `sum([]) == 0`, `max([])` → empty Cell rather than
   ValueError, `[x.upper() for x in []] == []`.  An empty result is a
   *valid* result, never an error.

   **Empty `Cell` rendering.**  An empty Cell shows as a single grid cell
   with grey italic text `∅` (`U+2205 EMPTY SET`).  Hover tooltip:
   "Empty value — upstream produced no rows."  It is *not* the same as
   `Cell(None)`, which renders as `null` and means "explicitly null".

   **Empty `Cell()` constructor.**  `=Cell()` (zero args) is the literal
   way to make one.  Legal everywhere a `Cell[T]` is expected.  Open
   question: does `=Cell()` produce `Cell(None)` or `Cell(∅)`?  Proposal:
   `Cell(∅)` — they're distinct, and "no value yet" is a useful sentinel
   distinct from "explicitly null".  (§4.12 below.)
4. **Caching.**  Re-running a step whose formula + upstream outputs are
   unchanged returns the cached frame (grey pill + `(cached)` chip).
   Invalidation is triggered by *any* upstream output hash changing.
5. **Determinism.**  Two runs of the same formula on the same inputs
   produce identical outputs.  Ops that aren't deterministic (e.g.
   `sample()` without a `seed=`) must declare it via
   `@op(deterministic=False)` — those skip the cache.
6. **Serialization.**  Every formula round-trips through the workflow
   `.json`: parse → AST → re-emit string yields the same string.
   Property test in `tests/test_safe_formula.py`.
7. **Renaming a step.**  Steps are referenced by **position** (`step1`,
   `step2`, …), not by user-given title.  Drag-reordering a step
   rewrites every formula that mentions it (Phase C UI; backend support
   first — `=rewrite_refs(workflow, {2:3, 3:2})`).
8. **Output preview limit.**  The grid renders at most 1000 rows by
   default; a banner says "showing 1000 of N rows" and offers
   "Show all" + "Export CSV".  Reductions/`Cell`s never truncate.
9. **Unicode + non-ASCII column names.**  `step1["café"]` works;
   `step1.café` works in Python ≥3 identifiers; column names with
   spaces require bracket form: `step1["my col"]`.
10. **Workspace-relative paths.**  Anywhere a path is accepted
    (`Table("data.csv")`, `=export(step1, to="out.csv")`), it's resolved
    relative to `WORKSPACE_ROOT`; absolute paths and `..` traversal are
    rejected with a banner.

---

### 1.13 — Execution model: sequential between steps, async within

The spreadsheet mental model says step N runs *after* step N-1.  That
must hold even when individual ops are concurrent internally.

| Scope | Rule |
|---|---|
| Between steps | **Strictly sequential.**  Step N+1 doesn't start until step N has produced a frame (or errored). |
| Within a step | **Async-capable.**  An `async def` op marked `async_=True` may issue up to `max_concurrency` in-flight tasks; the engine awaits the whole step before moving on. |
| Run All | Walks the dependency graph in topological order; sequential at the step level even if multiple steps are eligible. |
| Stop button | Cancels the in-flight step via `cancel_token`; downstream steps never start. |

**Why not auto-parallelize independent steps?**  Three reasons:
(1) Predictable order is what makes the spreadsheet feel sane —
"I see step 4 turn green, then step 5" is more debuggable than a
shimmering blur.  (2) Resource budgets (`max_concurrency`, rate
limits) are per-resource, not per-step, so cross-step parallelism
would silently violate them.  (3) Cancellation is much simpler with a
single in-flight step.  If a power user wants cross-step parallelism
later, the escape hatch is a single op that fans out internally.

**Engine sketch.**

```python
# pseudo-code
for step in workflow.steps:
    op = registry[step.op_name]
    kwargs = build_kwargs(step, resources, progress, cancel_token)
    if op.async_:
        result = await op(**kwargs)          # may use asyncio.gather internally
    else:
        result = await loop.run_in_executor(None, op, **kwargs)
    cache.put(step.id, hash(step, upstream_hashes), result)
```

### 1.14 — Source ops: side-effects, incremental updates, persistence

A *source op* fetches data from outside the workflow (HTTP, LLM, DB,
filesystem watch).  These ops are different from pure transforms in
three ways that matter to the engine:

1. They cost real money / time / rate-limit budget — re-running on every
   downstream change is wrong.
2. The right "update" semantics depend on the data — sometimes you want
   to refresh everything, sometimes only fill in new keys.
3. The output must survive Restart (otherwise re-running the workflow
   on a fresh kernel re-pays the cost).

**Declaration.**

```python
@op(
    name="fetch_videos",
    source=True,
    key="video_id",
    default_mode="upsert",
    network=True,
)
def fetch_videos(channel: str, *, http) -> "Table":
    return list_videos(http, channel)
```

**Four update modes** (selectable per-call via a chip on the step
header, defaulting to `default_mode`):

| Mode | Behaviour | Use case |
|---|---|---|
| `replace` | Discard cached output, run op, write fresh. | Daily snapshot, full refresh. |
| `append` | Run op, concat output to cached frame; no dedup. | Append-only event log. |
| `upsert` | Run op, merge on `key`; new keys appended, existing keys overwritten. | "Re-fetch latest stats for the same videos." |
| `fill_missing` | Run op only for keys *not already in cache*; never overwrite existing. | LLM enrichment that's expensive — only fill in what we haven't summarized yet. |

**Persistence.**  Each source-step's output is materialized to
`~/.simple_steps/cache/<workflow_id>/<step_id>.parquet` (plus a tiny
`.json` sidecar with hash + last-run timestamp).  On workflow load,
source steps hydrate from disk; the pill shows `(cached · 3 days ago)`
until the user clicks Run or Refresh.

**`fill_missing` semantics — worked example.**

Step 3 is `=fetch_videos(step1.channel_id)` with `mode=fill_missing`,
`key="video_id"`.  First run: 200 videos fetched, cached.  Two weeks
later the channel has 210 videos; user hits Refresh.

- Engine reads cached `video_id` set (200 keys).
- Calls `fetch_videos` — it returns 210 rows.
- Engine drops the 200 rows whose `video_id` is already cached,
  appends the 10 new ones, writes the union back.
- Step pill: `green · +10 rows`.

For ops where deciding "which keys are missing" requires a remote
listing (e.g., LLM summaries keyed by `video_id`), the op itself can
accept an injected `existing_keys: set` parameter — engine pre-computes
it from the cache and passes it in, so the op only does the expensive
work for the diff.

```python
@op(name="summarize_videos", source=True, key="video_id",
    default_mode="fill_missing", needs=["openai"])
async def summarize_videos(videos: "Table", *, openai, existing_keys):
    todo = videos[~videos.video_id.isin(existing_keys)]
    # ... only summarize todo
```

**Collision policy (`upsert`).**  If the op returns the same `key` twice
in one run, that's an op bug — engine raises with a "duplicate key in
upsert output" banner.  (Open question §4.16.)

**Source ops + caching layer (§1.12.4) interaction.**  Regular caching
keys on `(formula, upstream_hashes)` and is opaque to the user.
Source-op persistence keys on `(workflow_id, step_id)` and is
*addressable*: the user sees "cached · N rows · M minutes ago" and can
explicitly Refresh.  The two layers compose: a downstream pure transform
above a source step caches normally; its cache invalidates iff the
source's output hash changes.

---


