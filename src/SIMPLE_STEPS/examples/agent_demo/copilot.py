"""
copilot.py — one whole copilot session, from goal to a validated workflow.

    python examples/agent_demo/copilot.py            # a scripted model: no LLM needed
    python examples/agent_demo/copilot.py --live     # the model you configured (settings, Ollama)
    python examples/agent_demo/copilot.py --save     # also save it, to open in the UI

It plays the user's part the way the chat pane does, one turn at a time:

1. gives the goal; the copilot asks a clarifying question; it answers;
2. the copilot proposes a plan (resources, steps, milestones); it accepts it;
3. presses **Continue** until the plan is done: the copilot proposes a
   milestone's steps, the script applies them and runs them (as Apply and
   Run do), and the next Continue validates the milestone's output.

Then it prints the trace, one line per turn, and checks the result:
revenue per city, highest first. Exits 0 when the session finished and the
result is right.

``--save`` writes the workflow (``copilot-built``) and its session to the
example's workspace: open ``copilot-built`` in the UI, then the chat pane, to
see the plan, the conversation and the trace.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from ask import apply, example  # noqa: E402 — builds the example's App first
from tasks import START

from SIMPLE_STEPS.agent import copilot, sessions
from SIMPLE_STEPS.agent.model import Agent, resolve
from SIMPLE_STEPS.engine import get_value, run_operation
from SIMPLE_STEPS.example_check import SESSION

HERE = Path(__file__).resolve().parent
WORKFLOW = "copilot-built"
GOAL = "Total revenue for each city from the orders."
ANSWER = "Yes: sort the cities by revenue, highest first. Revenue is price times quantity."
WANT = ["Nairobi", "Quito", "Osaka", "Lisbon"]
MAX_TURNS = 16


# ─────────────────────────────────────────────────────────────────────────────
# A scripted model: what a good LLM answers, so the example runs anywhere.
# It is a plain function from messages to text, which is how any model you
# like plugs in: Agent(generate=your_function).
# ─────────────────────────────────────────────────────────────────────────────

FORMULAS = {
    "totals": 'line_total[mod.map(), mod.name("total")](wf["orders"])',
    "with_totals": 'zip_(wf["orders"], wf["totals"])',
    "per_city": 'sum_totals[mod.collapse(by="city", initial=0)](wf["with_totals"])',
    "ranked_cities": 'identity[mod.sort(by="per_city", ascending=False)](wf["per_city"])',
}
PLAN = {
    "resources": [],
    "steps": [
        {"name": "orders", "tool": "sample_orders", "purpose": "the orders (already there)"},
        {"name": "totals", "tool": "line_total", "purpose": "price × quantity for each order"},
        {"name": "with_totals", "tool": "zip_", "purpose": "each order beside its total"},
        {"name": "per_city", "tool": "sum_totals", "purpose": "revenue summed per city"},
        {"name": "ranked_cities", "tool": "identity", "purpose": "cities sorted, highest revenue first"},
    ],
    "milestones": [
        {"title": "The orders are there", "steps": ["orders"], "check": "12 orders with price and quantity"},
        {"title": "Every order has its total", "steps": ["totals", "with_totals"],
         "check": "each order has a total column, price × quantity"},
        {"title": "Revenue per city", "steps": ["per_city"], "check": "one row per city with its revenue"},
        {"title": "Highest first", "steps": ["ranked_cities"], "check": "the cities sorted by revenue, highest first"},
    ],
}


def scripted(messages: List[Dict[str, str]]) -> str:
    system, last = messages[0]["content"], messages[-1]["content"]
    if system == copilot.PLAN_PROMPT:
        answered = any(m["role"] == "user" and "highest first" in m["content"] for m in messages)
        if not answered:
            return json.dumps({"summary": "One question before I plan.", "plan": None,
                               "questions": ["Should the cities be sorted by revenue, highest first?"]})
        return "Here's my plan:\n```json\n" + json.dumps(
            {"summary": "Four steps after orders, in four milestones.", "questions": [], "plan": PLAN}) + "\n```"
    if system == copilot.VALIDATE_PROMPT:
        return json.dumps({"done": True, "reason": "The output shows what the check asks for."})
    if "can't be used" in last:              # the checks sent a mistake back: correct it
        return json.dumps({"summary": "Fixed the tool name.",
                           "steps": [{"name": "totals", "formula": "=" + FORMULAS["totals"]},
                                     {"name": "with_totals", "formula": "=" + FORMULAS["with_totals"]}]})
    names = [n for n in FORMULAS if f"- {n}:" in last]
    if names == ["totals", "with_totals"]:   # a typical small-model slip, to show the repair
        return json.dumps({"summary": "Adds the totals.", "steps": [
            {"name": "totals", "formula": '=order_total[mod.map()](wf["orders"])'},
            {"name": "with_totals", "formula": "=" + FORMULAS["with_totals"]}]})
    return json.dumps({"summary": f"Adds {', '.join(names)}.",
                       "steps": [{"name": n, "formula": "=" + FORMULAS[n]} for n in names]})


# ─────────────────────────────────────────────────────────────────────────────
# The user's side: apply and run, as the UI does
# ─────────────────────────────────────────────────────────────────────────────

def run(steps: List[Dict[str, Any]]) -> None:
    """Run every step in order, setting status, error and output_ref as the grid does."""
    whole = [{"name": s["name"], "formula": s["formula"], "ref": s.get("output_ref")} for s in steps]
    for step, entry in zip(steps, whole):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                ref, _ = run_operation(step["formula"], step_id=step["name"], session_id=SESSION,
                                       workflow_key=f"agent_demo/{WORKFLOW}", workflow_steps=whole)
            step.update(status="completed", output_ref=ref, error=None)
            entry["ref"] = ref
        except Exception as exc:  # noqa: BLE001 — a failed step is shown, as in the grid
            step.update(status="error", error=str(exc), output_ref=None)


def say(message: Dict[str, Any]) -> None:
    print(f"  copilot [{message['kind']}]: {message['content']}")
    for q in message.get("questions") or []:
        print(f"      ? {q}")
    if message.get("plan"):
        for i, m in enumerate(message["plan"]["milestones"], 1):
            print(f"      {i}. {m['title']}  ({', '.join(m['steps'])}) — done when: {m['check']}")
    for c in (message.get("proposal") or {}).get("changes", []):
        print(f"      {c['kind']:7} {c['name']}: {c.get('formula') or c.get('definition') or ''}"
              + (f"   ✗ {c['problem']}" if c.get("problem") else ""))


def main(argv: List[str]) -> int:
    live, keep = "--live" in argv, "--save" in argv
    if live:
        agent, why = resolve()
        if agent is None:
            print(f"The copilot is off: {why}")
            return 2
    else:
        agent = Agent(generate=scripted)
    if not keep:
        os.environ["SIMPLE_STEPS_AGENT_SESSIONS"] = tempfile.mkdtemp(prefix="copilot-")
    print(f"Model: {agent.model or 'a scripted function'} ({agent.provider})\n")

    session = sessions.new_session(WORKFLOW, "Revenue per city (copilot example)")
    steps: List[Dict[str, Any]] = [dict(s) for s in START]
    run(steps)

    def do(action: str = "continue", message: str = "") -> Dict[str, Any]:
        if message:
            print(f"  you: {message}")
        before = len(session["messages"])
        copilot.turn(agent, session, message=message, action=action, steps=steps, session_id=SESSION)
        for m in session["messages"][before:]:
            if m["role"] == "assistant":
                say(m)
        return session["messages"][-1]

    print("── plan")
    reply = do(message=GOAL)
    if reply["kind"] == "questions":
        reply = do(message=ANSWER)
    if reply["kind"] != "plan" or session["plan"].get("problems"):
        print("\nNo usable plan; stopping.")
        return 1
    do("accept")

    print("\n── build, one turn at a time")
    for _ in range(MAX_TURNS):
        if session["phase"] == "done":
            break
        reply = do()
        if reply["kind"] == "proposal":
            skipped = apply(steps, reply["proposal"]["changes"])
            for line in skipped:
                print(f"      not applied — {line}")
            run(steps)
            print("  you: (applied and ran the steps)")
        elif reply["kind"] == "error":
            break

    print("\n── trace")
    for r in session["trace"]:
        print(f"  {r['turn']:2}. {r['phase']:5} {r['action']:12} calls={r['model_calls']} "
              f"{r.get('seconds', 0):5.2f}s  {r['outcome']}")
    milestones = session["plan"]["milestones"]
    print(f"\n  milestones: {sum(m['status'] == 'done' for m in milestones)}/{len(milestones)} done; "
          f"phase: {session['phase']}")

    last = next((s for s in reversed(steps) if s.get("output_ref")), None)
    data = get_value(last["output_ref"], session_id=SESSION) if last else None
    cities = [str(c) for c in data["city"]] if data is not None and "city" in data else []
    ok = session["phase"] == "done" and cities == WANT
    print(f"  result ({last['name'] if last else '-'}): {cities}  want {WANT}  → {'PASS' if ok else 'FAIL'}")

    if keep:
        sessions.save(session)
        path = example.workspace / "projects" / "agent_demo" / f"{WORKFLOW}.simple-steps-workflow"
        path.write_text(json.dumps({
            "format_version": 2, "id": WORKFLOW, "name": session["title"],
            "steps": [{"name": s["name"], "expression": s["formula"].lstrip("="),
                       "meta": {"label": s["name"]}} for s in steps]}, indent=2) + "\n")
        print(f"\nSaved {path.relative_to(HERE)} and its session in {sessions.sessions_dir()}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
