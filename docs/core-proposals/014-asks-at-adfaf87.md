# 014 — The app's asks of core at `adfaf87` (v1.0.3): big sessions

> **For simple-steps-core.** From the Simple Steps app, 2026-11-17, while
> planning the move to 1.0.3 for working with large files. (Core's plan
> keeps 013 for its own list of the app's shims, P-D5.) Every number below
> was produced by running core alone, at the v1.0.3 tag (`adfaf87`,
> code identical to `5dcdac2`), Python 3.13, pandas 3.1.1, pyarrow 26.0.1:
>
> ```bash
> python scripts/core_probes/probe_big_session.py 300000 1000000
> ```
>
> The workflow: `src`, a DataFrame of `n` floats; `d = double[mod.map()](wf["src"])`;
> `small`, three rows; `pics = img[mod.map()](wf["small"])`, a 256×256×3 array
> per row. Durable entries are in [008](008-core-changes.md) under the same IDs.

**1.0.3 itself is fine to pin.** The app's 283 backend tests pass against it
unchanged; saving with outputs reads back exactly and reopens with nothing to
run; spilled cells (`MediaHandle`, `k.value`) work. The asks below are about
what happens when a step is big.

## Summary

| # | Ask | Kind | Priority |
|---|---|---|---|
| **C50** | A page view costs the page, not the step | 13.5 s for 50 rows of a 1M-row step | **1, as 1.0.4** |
| C49 | A save writes only what changed | every table rewritten on every save | 2 |
| C51 | A load converts columns, not cells | 3 s per million rows, one Python call per cell | 3 |
| C52 | Run-state reads after an edit don't scan rows | ~0.9 s per million rows, after every edit | 3 |
| C48 | `async def` tools | a silent wrong answer, still | 2 |
| — | Housekeeping: the tag, the guide | — | now |

---

## C50. A page view costs the page, not the step

**Run:**

| Rows in `d` | `k.view("d", (0, 50))` | `k.view("src", (0, 50))` | `k.cell("d", 5)` |
|---|---|---|---|
| 300,000 | 4.01 s | 3.84 s | 4.02 s |
| 1,000,000 | **13.56 s** | 13.01 s | 13.61 s |

No store and no save are involved: the kernel is in memory. On 1.0.2
(`dbaf4c7`, no pyarrow) the same 300k view took 2.64 s, so it was linear in
the step's size then too; it's ~50% slower now because pyarrow makes pandas
back every string column with `ArrowStringArray`, and single-cell `.at` reads
on it are slower.

**Why:** `Workflow._preview_rows` loops over `out.data.index` (every row) and
reads each cell with `out.states.at[...]` and `out.data.at[...]`, then the
window is cut afterwards. A profile of one 50-row page on 300k rows: 600,000
`DataFrame._get_value` calls, 1.2 M `ArrowExtensionArray.__getitem__`, 11.8 s
under the profiler.

**Why it matters to the app:** the app holds the workflow's lock while it
calls `k.view` (`kernels.py:430`), so every scroll or cell click on a big step
blocks that workflow for the whole time (app plan 138 P1/N1).

**Ask:** slice `data`, `states`, the stale rows and the notes to the requested
window **before** the loop, so `k.view` and `k.cell` cost what they return.
The `window` total comes from `len(out.data)`.

**Test:** `k.view` of a 1M-row step returns in under 50 ms, and returns
exactly what it returns today for the same window (first, middle and last
pages; a stale step; a step with failed rows).

## C49. A save writes only what changed (still open)

**Run:** `k.save(folder, outputs=True)`, then again with nothing changed:

| Rows | First save | Second save, nothing changed | Files rewritten |
|---|---|---|---|
| 300,000 | 0.77 s | 0.73 s | 10 of 13 |
| 1,000,000 | 2.40 s | 2.37 s | 10 of 13 |

Every `table.parquet`, `states.parquet` and `meta.json` is written again;
only the content-named `files/*.npy` are skipped.

**Ask:** as in 008 C49: a save into an existing session folder skips a step
whose data version matches what's recorded there. The app can work around it
for now by saving when a workflow is put away, not after every run, so this
can come with P7d.

## C51. A load converts columns, not cells

**Run:** `Kernel.load(folder, catalog)`: 0.83 s at 300k rows, 2.97 s at 1M,
correct, nothing to re-run. A profile at 1M rows: `saving.untag` called
3,000,047 times (once per cell), `Output._from_records` 1.85 s.

**Ask:** a column Parquet read back exactly (plain numbers, strings,
booleans) needs no per-cell untagging; untag only the tagged-JSON columns.
Reading lazily (L6) is still the longer-term answer.

## C52. Run-state reads after an edit don't scan rows

**Run**, 1M rows: `needs_run()` 0.89 s; the states of four steps 0.59 s;
`run("d")` when `d` is current (a no-op) 0.59 s. At 300k: 0.26, 0.18,
0.17 s.

The app reads these after every edit (its sync, 300 ms after a keystroke), so
on a big workflow each edit pays about a second, past core's own goal 5
(100–200 ms). **Ask:** a step's state and whether it needs a run come from its
recorded versions, not a pass over its rows; this may simply fall out of P2
(states only from the store). A speed test on a 1M-row step would pin it.

## C48. `async def` tools (still open)

**Run:** `async def slow(x: float) -> float` under `map`: the step is
`completed`, its cell holds a `coroutine`. Unchanged since 008 C48. The app
will refuse such tools in `@simple_step_tool` until core does
(`SHIM(core §C48)`, app plan 138 N3).

## Housekeeping

1. **The v1.0.3 tag is only on `core-handover`**, not `main`. The app's update
   steps (`docs/context.md`) check out `origin/main`, which still gives 1.0.2.
   Please merge `core-handover` into `main` (or say if the app should track
   tags instead).
2. **`docs/design/app-update-1.0.3.md` §2 pins `5dcdac2`.** The app will pin
   the tag, `adfaf87`: at `5dcdac2` the package still reports version 1.0.2,
   and `pip install` on a machine with 1.0.2 then does nothing.
3. **The app's plan for this move will be renumbered**: `137` is already
   taken by `137-ui-components.md`. The guide's link to
   `137-core-1.0.3.md` will need the new name, which the app will send.
4. **For your information, not an ask:** with pyarrow installed, pandas 3
   stores every string column as `ArrowStringArray`, in core and in the app.
   Any loop that reads cells one at a time with `.at` or `.iloc` got slower
   in 1.0.3; C50 is the worst case found.
