# 118 — A console, and GUI ↔ console parity

*Date: 2026-10-05*
*Status: **plan, nothing agreed**. Companion to [`103`](./103-ui-as-formula-formulator.md) (the UI's brief) and [`117`](./117-referencing-previous-steps.md) (step references).*

## The ask

> "I want a console so the GUI reflects the actual interactive operations being
> sent to the backend and vice versa. If I make a change in the GUI I will see
> that operation in the console, and if I make a change in the console I will
> see it in the GUI."

That is a **parity** requirement, not a logging one. It is the Blender Info
panel / AutoCAD command line model: every click has a textual equivalent, the
textual equivalent is re-runnable, and typing it does what the click did.

> Claims marked ✓/✗ below were checked by reading the code at the named line or
> by running it. The counts in §1 come from the commands in the appendix.

---

## 1. What exists today

| Surface | Answers | Status |
|---|---|---|
| **Execution log** | *What did the pipeline do?* | Built — but every entry is **frontend-side narration**. `useWorkflow` logs its own HTTP calls: step started, N rows × M cols, failed with traceback |
| **Console** | *Why did it do that?* | **Missing.** 57 `print()` calls in `engine.py` (26), `pack_loader.py` (20), `orchestrators.py` (9) and `main.py` (2) go to the terminal and nowhere else. **Zero** stdout capture, **zero** logging handlers |
| **REPL** | *What is `step1["score"]` right now?* | **Missing as a surface.** [`eval_engine.py`](../../src/SIMPLE_STEPS/eval_engine.py) exists and is titled *"Interactive Python Session for the Formula Bar"*. It builds the whole namespace — `step1`/`step2`, step labels, `df_in`, `pd`, `np`, every registered op, `step()`, `result` — but has **no HTTP endpoint**. It is reachable only as a fallback inside `run_operation` when an operation is unregistered and `eval_mode` is on |

The terminal-only prints include the most useful diagnostic in the system:

```
↳ Resolved 'step1['score'][1]' → cell [1,score] = 75
⚠ Could not resolve reference 'step1[row=1]' (step_map keys: [...])
```

That is precisely the trace for the reference problems in [`117`](./117-referencing-previous-steps.md).
The log says *"Step 2 failed: KeyError"*; the line saying which reference
silently echoed itself back is invisible unless you launched from a terminal.

---

## 2. The thesis

> **Every state change has exactly one canonical textual form, and both the GUI
> and the console produce and consume that form.**

Everything below follows from that sentence. The project is already most of the
way there, because [`103`](./103-ui-as-formula-formulator.md) settled that a step
owns one expression and the formula is its source of truth — `process_type` and
`configuration` are *derived*, never set directly. Parity needs that same
discipline extended from "what a step is" to "what the user just did".

### The command vocabulary should be core's, not a new one

Core's own API is already shaped like the commands we need
(`wf["sample"] = identity[mod.select(index=[0,3])](wf["raw"])`). The console
should speak **that**, so it is the Python API rather than a parallel invention:

```python
wf["step2"] = '=score(url=step1["url"])'   # set a step's expression
wf.add(after="step1", name="step2")        # structural edits
wf.remove("step2")
wf.rename("step2", "scored")
wf.run("step2")                            # or wf.run() for the pipeline
```

This also closes a loop with core's decision that **selection is an operation,
not a reference** (status §4b, taken in `2f53f88`): a grid drag becomes a
*visible command* — `wf["step3"] = select(wf["step2"], ["name","score"])` —
which is exactly what parity demands, and is an argument *for* core's model
rather than against it.

---

## 3. Three streams, not one

The console is one panel with three tabs' worth of content. Collapsing them
loses the thing being asked for.

| Stream | Content | Why it is separate |
|---|---|---|
| **Commands** | The canonical form of each user action, in both directions | This is the parity stream. Re-runnable, copy-pasteable, the transcript of a session |
| **Wire** | The real `/api/run` request and response | **Must be tapped at `fetch`, not reconstructed.** A reconstruction is a *model* of what was sent; if it drifts, it reports parity that does not exist — defeating the entire purpose |
| **Engine** | The backend's own `print`/log output, streamed | The "why", including the reference-resolution trace |

**CN-01 — the Wire stream taps `services/api.ts` at the fetch boundary.**
Not `useWorkflow`, not a reconstruction from state. The user's words were "the
*actual* operations being sent"; only the fetch boundary can honour that.

---

## 4. The obstacle, stated plainly

**There is no mutation chokepoint.** `setWorkflow` is called from **11 distinct
sites** in `useWorkflow.ts`, mixing two different things:

- *user intent* — `updateStep`, `addStepAt`, `deleteStep`, `toggleStep`
- *result application* — writing `outputRefId`, `status`, `output_preview` back
  after a run

Only the first kind is a command. The second is a consequence and must **not**
echo to the console, or every run will spray noise that cannot be replayed.

Worse, the main mutator is untyped intent:

```ts
function updateStep(id: string, updates: Partial<Step>) {   // useWorkflow.ts:651
```

`Partial<Step>` is a diff, not a command. "Set the formula", "rename the step"
and "record the output ref" arrive through the same door, indistinguishable.

**CN-02 — split intent from consequence before anything else.**
Introduce a typed `WorkflowCommand` union and route user-intent mutations
through a single `dispatch(command)`. Result application keeps using the raw
setter. Nothing else in this note is buildable until this exists, and it is
worth doing on its own merits — it is also what would let the agent sidebar,
undo/redo and workflow diffing share one vocabulary.

---

## 5. Which way does state flow?

The decision that shapes everything else.

| | Client-authoritative | Server-authoritative |
|---|---|---|
| Workflow state lives in | React (`useWorkflow`) — where it is today | The session on the backend |
| Console → GUI | Console command is applied by the frontend | Both are clients of one truth; GUI subscribes |
| Cost | A command bus | A rewrite of `useWorkflow` and the persistence path |
| Risk | Two copies of truth if the REPL mutates server state directly | Latency on every keystroke-level edit |

**CN-03 — stay client-authoritative, and split commands from expressions.**

- **Commands** (`wf["step2"] = …`, `wf.add(…)`) are parsed and applied
  **client-side**, through the same `dispatch` the GUI uses. The GUI updates
  because the command went through the identical path a click does — which is
  what makes parity true by construction rather than by careful mirroring.
- **Expressions** (`step1["score"]`, `len(step1)`) are evaluated
  **server-side** by `eval_engine`, and the console prints the value.

This sidesteps state synchronisation entirely. The backend stays the authority
on *grammar and data* (as it already is — `/api/parse_formula`,
`/api/build_formula`), and the frontend stays the authority on *workflow shape*
(as it already is). Neither moves.

---

## 6. Session scoping — do not capture stdout

**CN-04 — convert the 57 `print()` calls to `logging`, with the session id on
the record.**

`print()` is process-global; the app is per-session. `DATA_STORE` and
`RAW_STORE` are already bucketed by a session token, and `session_id` resolves
from an HttpOnly `ss_session` cookie that the client deliberately cannot read
or spoof ([`models.py:264`](../../src/SIMPLE_STEPS/models.py)). Hijacking
stdout would leak one user's resolution trace — including their data values,
since the trace prints resolved cell contents — into another user's console.

This is mechanical, but far cheaper now than after a console exists.

**CN-05 — stream the Engine tab over SSE.** [`main.py:624`](../../src/SIMPLE_STEPS/main.py)
already has a working `StreamingResponse` / `text/event-stream` pattern for
per-step progress. Copy it for `/api/console` over a bounded ring buffer.

---

## 7. Safety

**CN-06 — the REPL stays behind `eval_mode`.** `eval_engine.py`'s own header:

> ⚠️ This is `exec()`/`eval()` — it can do anything. Only enable in trusted envs.

The gate already exists: `eval_mode` defaults to `False` in `settings.py:28`
and has a toggle in the Sidebar. A prompt in the GUI makes that gate far more
load-bearing than a formula-bar fallback did, so:

- the Commands and Wire tabs are **always** available (they mutate nothing new);
- the expression prompt is visibly disabled, with a reason, when `eval_mode` is
  off — never silently absent;
- expression evaluation stays read-only: no command may be smuggled in through
  an expression, or CN-03's single path is bypassed.

---

## 8. Build order

| # | Step | Depends on | Why here |
|---|---|---|---|
| 1 | **CN-02** typed `WorkflowCommand` + `dispatch` | — | Nothing else is buildable first; valuable alone |
| 2 | **CN-04** `print` → `logging` with session id | — | Independent, mechanical, and a data-leak fix |
| 3 | **CN-05** `/api/console` SSE + Engine tab | CN-04 | First visible win; surfaces the reference trace |
| 4 | **CN-01** Wire tab at the fetch boundary | — | Small, and directly answers "what was actually sent" |
| 5 | Commands tab (GUI → console) | CN-02 | Half of parity |
| 6 | `/api/eval` + expression prompt | CN-06 | Read-only; the interactive-session half |
| 7 | Console → GUI commands | 1, 5 | Completes parity; last because it is the only step that can corrupt workflow state |

Steps 2–4 are independent of 1 and can run in parallel.

### Where it lives

Tabs in the bottom panel, which already docks, resizes, collapses and pops out:

```
▾  Log | Commands | Wire | Engine | Python        3 ⚠           ⧉  ✕
```

This is VS Code's Problems / Output / Terminal / Debug Console split, and the
panel work is already done.

---

## 9. The test parity actually needs

**CN-07 — a round-trip assertion, not a screenshot.**

Parity is a property, so test it as one: for each command in the vocabulary,
drive the GUI action, capture the emitted command, apply that command to a
fresh session, and assert the resulting workflow state is identical.

```
gui_action ──► command ──► apply ──► state
     └────────────► state  ═══ must be equal
```

A console that merely *looks* right is the failure mode this note exists to
avoid — the project already has one class of silent-wrong-answer bug in
reference resolution ([`117`](./117-referencing-previous-steps.md) §1.2), and a
drifting command echo would be the same disease in a new place.

Note that `frontend/` currently has **no passing layout or workflow test** —
`MainLayout.test.tsx` and `App.test.tsx` both die in a `useEffect` on stale
`vi.mock` stubs before reaching any assertion. Those should be repaired as part
of step 1, or CN-07 has nowhere to live.

---

## Appendix — how §1 was measured

```bash
# Terminal-only output, by module
grep -c "print(" src/SIMPLE_STEPS/{engine,orchestrators,main,pack_loader}.py
#   engine 26 · orchestrators 9 · main 2 · pack_loader 20   → 57

# No capture of any kind
grep -rn "StringIO\|redirect_stdout\|logging.getLogger\|addHandler" src/SIMPLE_STEPS/*.py
#   (no matches)

# run_eval has no route; only an internal fallback
grep -rn "run_eval" src/SIMPLE_STEPS/*.py
#   eval_engine.py:40 (def) · engine.py:761,765,776,781 (fallback)

# Mutation sites: 12 lines match, one of which is the useState declaration
# on line 106, so 11 are call sites.
grep -n "setWorkflow" frontend/src/hooks/useWorkflow.ts
```

Baseline: core `2f53f88`, core suite 357 passed / 0 failed, app backend
159 passed / 1 failed (the known `test_select_cell`), frontend 4 passed /
2 failed (stale `vi.mock` stubs).
