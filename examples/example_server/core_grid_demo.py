"""
core_grid_demo.py — the simple-steps-core grid model, end to end, in one file.

This is the *target* model. It is a standalone prototype inside
``simple-steps-core`` that the app has not adopted yet, so nothing here goes
through the Simple Steps server — it runs on its own:

    python core_grid_demo.py

Run it beside ``tools.py`` (which uses the model the app ships today) to see
where the two differ. The vocabulary here is the one in
``simple-steps-core/docs/grid-model.md``:

    Tool       a plain function declaring the values it needs
    Operation  tool_id + ordered modifiers + bound literals
    Output     data + ledger + meta
    Step       an Operation and an Output, always both
    Workflow   ordered Steps, nothing else

Two properties are worth watching for, because they are what the app has to
grow into:

1. **Declaring a step is not running it.** Assigning into the workflow stages
   the step — you get its shape, its predicted cell count and any problems
   with nothing executed.
2. **The ledger is per unit of work**, beside the grid rather than merged into
   it. Progress, per-row errors and retry counts all read off it, so no
   separate progress channel is needed.
"""

from __future__ import annotations

import pandas as pd

from simple_steps_core import grid
from simple_steps_core.grid import mod, tool


# ──────────────────────────────────────────────────────────────────────────
# Tools — plain functions. A parameter is filled from a column of the
# upstream grid, or bound to a literal at the call site.
# ──────────────────────────────────────────────────────────────────────────

@tool
def score(n: int, weight: int = 1) -> int:
    """Weight a count. ``n`` comes from a column; ``weight`` is a literal."""
    return n * 10 * weight


@tool
def keep_odd(n: int) -> bool:
    """A predicate — returns a bool, so it reads as a filter."""
    return n % 2 == 1


@tool
def total(acc: int, value: int) -> int:
    """A reducer. ``acc`` is not a column, which is how it reads as a collapse."""
    return acc + value


@tool
def label(n: int) -> str:
    """Per-row transform producing a string."""
    return f"row-{n}"


def show(wf: grid.Workflow, step_id: str) -> None:
    """Print one step's operation, staged meta, and — if run — its frames."""
    step = wf.step(step_id)
    print(f"\n── {step_id} " + "─" * (66 - len(step_id)))
    print(f"  operation : {step.operation}")
    meta = getattr(step.output, "meta", None)
    if meta:
        print(f"  meta      : {meta}")
    data = getattr(step.output, "data", None)
    if data is not None and isinstance(data, pd.DataFrame) and not data.empty:
        print("  data      :")
        for line in data.to_string(index=True).splitlines():
            print(f"              {line}")
    ledger = getattr(step.output, "ledger", None)
    if ledger is not None and isinstance(ledger, pd.DataFrame) and not ledger.empty:
        print("  ledger    :")
        for line in ledger.to_string(index=True).splitlines():
            print(f"              {line}")


def main() -> None:
    wf = grid.Workflow()

    # A source step: its data arrives with its declaration, so it is born
    # complete. There is no separate "inputs" concept — a literal is just a
    # step's output.
    wf["raw"] = pd.DataFrame({"n": [1, 2, 3, 4, 5]})

    # ── the grammar ──────────────────────────────────────────────────────
    # Square brackets carry modifiers; round brackets carry the call.
    # Omit the modifier and the iteration is inferred from the signature.

    # 1. inferred — `n` is a column, so this reads as a map
    wf["scored"] = score(wf["raw"])

    # 2. a bound literal alongside the column
    wf["doubled"] = score(wf["raw"], weight=2)

    # 3. the same thing, stated explicitly
    wf["scored_explicit"] = score[mod.map()](wf["raw"])

    # 4. a modifier stack. Stored innermost-first: [map, retry] means retry
    #    wraps the whole fan-out; [retry, map] would retry per item. Order is
    #    semantics, not style.
    wf["resilient"] = score[mod.map(), mod.retry(times=2)](wf["raw"])

    # 5. a predicate reads as a filter — the ledger keeps the dropped rows
    wf["odds"] = keep_odd[mod.filter()](wf["raw"])

    # 6. `acc` is not a column, so this reads as a reducer
    wf["sum"] = total(wf["raw"])

    # 7. a plain per-row transform
    wf["labels"] = label(wf["raw"])

    print("=" * 72)
    print("DECLARED — nothing has executed yet")
    print("=" * 72)
    print("Each step already knows its shape and predicted cell count. This is")
    print("what lets a UI lay out a whole workflow before computing anything.")
    for step_id in ("scored", "doubled", "resilient", "odds", "sum"):
        show(wf, step_id)

    print("\n" + "=" * 72)
    print("RUN — the same steps, now holding data and a ledger")
    print("=" * 72)
    wf.run_all()
    for step_id in ("scored", "doubled", "odds", "sum", "labels"):
        show(wf, step_id)

    # ── the light export: the recipe, without any data ───────────────────
    # This is what a UI would autosave on every keystroke. Staging is derived,
    # so it is never stored; cardinality comes back as unknown on reload,
    # which is correct rather than a bug.
    print("\n" + "=" * 72)
    print("LIGHT EXPORT — the chain of Operations, no payloads")
    print("=" * 72)
    light = wf.to_json()
    print(f"  wf.to_json()          {len(light)} bytes — the recipe, autosave-cheap")
    full = wf.to_session_json()
    print(f"  wf.to_session_json()  {len(full)} bytes — same chain, plus payloads")
    print()
    print("  light export:")
    print(f"    {light[:400]}{'...' if len(light) > 400 else ''}")


if __name__ == "__main__":
    main()
