# 138 — Runs that never block the app, and big data on disk

**Status:** proposed (2026-11-16), app at `4375715`, core pinned at 1.0.2
(`dbaf4c7`). **Revised the same day against core's work under way**
(`simple-steps-core` branch `core-handover` at `73933ba`, plus its
uncommitted `saving.py`), reviewed and run, §2.

Owner's asks: **"when we call it, it shouldn't disrupt our usage of the app
while it's running a process"**; processes over big files need each step's
output stored to disk, and images loaded only when needed. Dev plan
[136](./136-consolidation-plan.md) P4a and part of P4b.

**The rule, for everything below:** a run in progress never stops anyone
from using the app. Editing, scrolling, opening other workflows and
reading other steps all answer at once while it runs, and so do other users.

**Decided (owner, 2026-11-16): the app is always async: submit and
observe.** Running never waits on a tool: Run starts a background job and
returns at once; the UI keeps showing what has already run, and results
appear as each step (later, each row) completes; saving happens in the
background too. Tools stay plain functions and core stays synchronous: the
app runs core in a worker (a thread now; a process per workflow later if
heavy pure-Python tools or hard stops need it, 129). One run at a time per
workflow, queued and shown as queued; different workflows and users run side
by side. N0–N2 below are how it's built.

---

## 1. Today (run 2026-11-16 unless marked *read*)

| # | Problem | Evidence |
|---|---|---|
| **P1** | **A run freezes the whole server.** `/api/run` runs in a thread, but `kernels.run_step` holds the kernel's lock for the entire run. `/api/workflow/sync` and `/api/view` are `async def` handlers that take the same lock **on the event loop**. An edit during a run (the UI syncs 300 ms after every edit) blocks the loop until the run ends, and with it **every request from every user** | `scripts/probes/probe_async_freeze.py`: a 6 s run; a sync sent at 0.5 s waited **5.5 s**; a `/api/settings` request from **another user**, which touches no kernel, waited **5.2 s** |
| **P2** | **Other blocking handlers on the loop.** Loading a resource, `/api/cell`, `/api/data`, file reads and writes and pipeline saves all run blocking code inside `async def` | *read*: `main.py` |
| **P3** | **`async def` tools give wrong results silently**: cells hold un-awaited coroutines, the step says `completed` | `scripts/core_probes/probe_async_tool.py`, on 1.0.2 **and on `core-handover`** (008 C48) |
| **P4** | **Progress never shows**: `/api/progress` streams a tracker nothing creates | *read*: `start_progress` has no caller |
| **P5** | **No cancel** | *read* |
| **P6** | **Every output is kept twice, and never freed** (`engine.DATA_STORE` beside the kernel) | *read*: `kernels.run_step`; how-simple-steps-works §5 item 6 |
| **P7** | **Image outputs are lost when a workflow is put away**, so every step re-runs when it comes back | `scripts/probes/probe_image_save.py`: `save_with_outputs` raises on a numpy image array (008 C29) |
| **P8** | **A full image is sent as base64 inside JSON**, at full size, encoded on every open | *read*: `cell_types._image_view` |
| **P9** | **`k.view` crashes on a step holding arrays** (the app's C37 shim covers it) | run: still reproduces on `core-handover` |

## 2. What core is building (reviewed 2026-11-16)

Core's plan (`docs/design/plan.md` on `core-handover`) and its saving design
(`docs/design/saving.md`) take on most of the big-data half. Run against the
branch:

| Core piece | What it gives the app | State (run) |
|---|---|---|
| **P1c layer 1**: `k.save(folder)` / `Kernel.load(folder, catalog)`; data assigned to a step saved as `data/<step>.parquet`, checked by reading back; a report of anything not kept exactly | entered and uploaded data survives a save | **in progress, uncommitted.** Its 32 tests pass. A plain data step round-trips exactly and re-runs; a column of numpy arrays is **reported** (`"pic": "a ndarray can't be saved"`), not lost silently, and loads `invalid` until media files land |
| **P1c layer 2**: `k.save(folder, outputs=True)`: `outputs/<step>/data.parquet`, `states.parquet`, `meta.json`; arrays, images, figures as `media/<hash>.{npy,png,tiff,json}`, no pickle; a loaded step `completed` only if its run key still matches | **P7 ends**: a workflow reopens with its outputs, no re-run; closes the app's C32 shim | designed (saving.md), not built |
| **P1 shims**: C37 (arrays in `k.view`), C45, C33, C34, C18, C36 | the app's `core_bridge` shims go | C37, C45 reproduced; B-collapse-arg fixed (1.0.3) |
| **P7d**: progress and `cancel()` as a callback (K14, K23) | N2 | after core's P2 and P3 (a large restructure) |
| **P7d layer 3**: rows saved as a run goes; resume; a store interface with memory and folder backends, which the app may extend | resuming long runs; freeing one step's memory | after P2 and P3 |
| **L6**, lazy rows (P7d) | reading a big step a page at a time | after P2 and P3 |
| **Not in core's plan** | `async def` tools (C48); saving only what changed, loading lazily (C49) | to raise |

Core's plan also **confirms the split**: locks, hosting, eviction, memory
budgets, the `running` state, and where and when files are saved are the
app's (core plan §4).

## 3. Not blocking the app (app)

### N0. Nothing blocks the event loop · hours

Every handler that does blocking work becomes a plain `def` (FastAPI runs
those in its thread pool): sync, view, cell, data, data-meta, resources
load/status/clear, file read/write/upload, pipeline save/load. **Ends P1's
cross-user freeze and P2.**

**Done when:** `scripts/probes/probe_async_freeze.py` shows another
session's request answering in < 100 ms during a run.

### N1. A running kernel doesn't hold the UI hostage

While a step runs, its workflow is **busy**, and requests about it answer at
once:

| Request during a run | Answer |
|---|---|
| **sync** (after an edit) | at once: `{busy: true, running: [steps], steps: <last summary>}`; the edit is queued (latest wins) and applied when the run ends, then a fresh summary is pushed. Editing the running step marks it "changed while running" |
| **view** of a step not in the run | from the last page the app served for it (kept per step and view key), never waiting on the kernel |
| **view** of the running step | its last output, marked `running`, with progress (N2) |
| other workflows, files, the agent | unaffected |

**Probe first:** can `k.view` and step states be read from another thread
while `k.run` runs, consistently? If yes, reads just skip the lock.

**Frontend:** the running step shows `running`; every other step stays
editable; Run becomes Stop (N2).

### N2. Runs as jobs: progress and cancel

`POST /api/run` returns a **job id** at once (202); progress and the result
come on the existing SSE stream, wired up for the first time;
`POST /api/run/{job}/cancel` stops it.

Core's callback (P7d) comes after its P2 and P3, which are large. So, **if
the owner wants progress before then**, an interim shim: `core_bridge` wraps
each catalog tool to count its calls against the input's row count
(`SHIM(core §K14)`), and to raise a stop on its next call for cancel
(`SHIM(core §K23)`, after a probe of what core does with it). A call that
never returns can't be stopped in a thread; that needs a subprocess kernel
(129). Both are deleted when core's callback lands.

### N3. `async def` tools

Not in core's plan. **Raise C48 as a core P1 item** (it's a silent wrong
answer, like B-collapse-arg): refuse an `async def` tool at declaration now,
await it later. Until core refuses it, the app's `@simple_step_tool` refuses
it with a clear message (`SHIM(core §C48)`), so nobody gets coroutines in
cells.

## 4. Big data on disk

### B1. One copy of each output · app · needs the owner's confirmation

Stop copying outputs into `engine.DATA_STORE`; `/api/data`, `/api/cell` and
`/api/data-meta` read the kernel, as `/api/view` already does. **Halves
memory and ends the leak (P6).** A legacy removal: inventory first (what
each piece of `engine.py` does, who calls it, what replaces it), confirmed
before it goes.

### B2. Save each workflow as core's session folder · app, on core's P1c

The app **doesn't write its own files**: it calls `k.save(folder, outputs=True)`
and `Kernel.load(folder, catalog)`. What the app decides (core plan §4):

- **Where:** beside the workflow, `<workflow>.simple-steps/` in its project
  folder, so a saved workflow carries its data.
- **When:** after each run finishes (in the background, off the event loop),
  when a kernel is put away, and when the server stops. This replaces
  `kernels._save` / `_restore` and the C32 shim.
- **The report:** shown by the save status (*"Saved. 1 step will need a
  re-run: `fig` (3 cells: Model can't be saved)"*, saving.md §7).
- **The setting:** `result_store` = `disk` (the default: outputs are saved)
  or `memory` (never written). The `auto` size threshold from 136 P4a
  becomes a **memory** setting, used once core's store can free a single
  step (P7d layer 3): above it, a finished step's output leaves memory and
  is read back from its folder when needed. Until then, memory is freed a
  workflow at a time, by putting kernels away, as today.

**Asks from this review**, raised with core (008 C49):
1. **A save writes only what changed.** "Saving again into the same folder
   replaces it" rewrites every step; for big files, saving after each run
   must skip steps whose data version is already on disk.
2. **A load doesn't read every output into memory** (L6), so opening a big
   workflow is quick and a page reads only its rows.

**Before layer 2 lands:** layer 1 already saves entered data; outputs still
go through the C32 shim, with P7 as it is.

### B3. Images when needed · app

- `GET /api/cell/{…}/image?max=<px>` returns **binary PNG**, scaled to the
  size the viewer asks for, with an `ETag`. Once outputs are in core's
  folder, a full-size image is **its `media/<hash>.png` file**, served as is,
  with the hash as its ETag, so the browser caches it for good.
- Scaled copies and thumbnails are made once and kept in an app cache beside
  the session folder (not in core's files).
- The grid shows only the summary text (owner, 2026-10-30); an image is drawn
  only when inspected, and the inspector's images load as they scroll into
  view.

### B4. Big tables a page at a time · on core's L6

Waits for core's lazy rows. Until then, a step's page comes from memory, as
today.

## 5. Order

| Phase | What | Needs | When |
|---|---|---|---|
| **N0** | Off the event loop | nothing | now (hours) |
| **N1** | Busy kernels answer at once | N0; the thread-safety probe | now |
| **B1** | One copy | owner confirms the removal | now |
| **N3** | Refuse `async def` tools | nothing (app); C48 for core | now (small) |
| **B3** | Images on demand | nothing; uses core's media files once they land | now |
| **B2** | Core's session folder | core P1c: layer 1 for entered data, layer 2 for outputs | as core lands it |
| **N2** | Jobs, progress, cancel | core P7d, or the interim shim | owner's choice |
| **B4** | Paged reads from disk | core L6 | later |

## Progress

**2026-11-19: N0 and N1 built, and N2's cancel.** Owner's answers: yes to
N0/N1; while a step runs you can still explore what doesn't interfere
(look at its data, any step's cells) and cancel it; losing a cancelled step's
partial results is accepted. Progress is core's, as an execution modifier
(008 K23, restated); no interim progress shim.

| Piece | What was done | Where |
|---|---|---|
| N0 | Every handler that doesn't await is a plain `def` (FastAPI's thread pool). `/api/session` stays `async`, so the connection check answers even when the pool is busy. This also ends the "Disconnected" badge while a table loads: the 4 s connection check was starved by blocking handlers on the loop | `main.py` |
| N1 | A run marks its kernel `running`. Views read without the lock during it (safe: 008 K23 evidence), and report `running` for the running step. A sync during a run answers at once (`busy`, `running`, the current states) and is queued, latest wins, then applied when the run ends, before its states are reported | `kernels.py` (`_hold`, `_apply_pending`) |
| N2, cancel | `POST /api/run/cancel {workflow_key}` stops the run (`SHIM(core §K23)`). The run's request answers 409 `RunCancelled`. A first run's step goes back to staged; a re-run keeps its previous result. In the UI, Run on a running step is its Stop (it used to start a second run), and the pipeline's Stop cancels too; a stopped step shows `stopped` and logs it, not an error | `core_bridge.interrupt`, `kernels.cancel`, `useWorkflow.ts` |

Checked with `scripts/probes/probe_run_nonblocking.py`, a 6 s run: another
user's request 2 ms; the connection check 1 ms; a sync, a view of a finished
step and a view of the running step about 60 ms each. The queued edit was
applied; both cancel cases passed. Backend 283 passed, frontend 138 passed.

**Still open here:** N2's progress (waits on core K23), N3, B1–B4. One run
at a time per workflow: a second Run on another step of the same workflow
waits for the first.

## 6. Decisions for the owner

1. **Progress before core's P7d** (N2): build the interim shim now, or wait
   for core's callback?
2. **Edits during a run** (N1): queued and applied after (recommended), or
   refused with "running" until it ends?
3. **C48 and C49 into core's P1** (recommended: C48 is a silent wrong
   answer; C49 is what makes saving after each run cheap with big files)?
4. **B1's removal of `engine.DATA_STORE`:** confirm, after its inventory.
