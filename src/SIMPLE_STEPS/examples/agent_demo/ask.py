"""
ask.py — try the agent with a real model, from the terminal.

    python examples/agent_demo/ask.py                    # the six requests in tasks.py
    python examples/agent_demo/ask.py "keep tea orders"  # one request of your own

With no request, it starts from the ``start`` workflow and sends each request
in ``tasks.py`` in turn, the way the chat pane does: the agent proposes, its
checks run, and a proposal with no problems is applied before the next
request. Then the workflow it built runs the way the UI runs it, and each
task's step is checked by its *output*. The workflow is saved as
``agent-built`` so you can open it in the UI.

With a request, it sends just that one, against the reference workflow, and
prints the proposal. Nothing is saved.

Needs a running Ollama with the model (``OLLAMA_MODEL``, default
``llama3.2:3b``). Exits 0 when every task passes, 1 when one doesn't, 2 when
there is no model to ask.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Dict, List

from SIMPLE_STEPS.example_check import Example

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

from SIMPLE_STEPS.agent.model import ModelError, resolve  # noqa: E402
from SIMPLE_STEPS.agent.proposals import propose  # noqa: E402
from tasks import START, TASKS  # noqa: E402

PROJECT = "agent_demo"
BUILT = "agent-built"


def show(result: dict) -> None:
    """A proposal, the way the chat pane lists it."""
    print(f"      agent: {result['summary'] or '(no summary)'}")
    for change in result["changes"]:
        where = f" after {change['after']}" if change.get("after") else ""
        what = change.get("formula") or change.get("definition") or ""
        print(f"      {change['kind']:7} {change['name']}{where}: {what}")
        if change.get("problem"):
            print(f"      ✗ {change['problem']}")
    if not result["changes"]:
        print("      (no changes proposed)")


def apply(steps: List[Dict[str, str]], changes: List[dict]) -> List[str]:
    """Apply the changes that have no problem, as the chat pane's Apply does;
    return what was skipped."""
    skipped = []
    for change in changes:
        if change.get("problem"):
            skipped.append(f"{change['name']}: {change['problem']}")
            continue
        names = [s["name"] for s in steps]
        if change["kind"] == "add":
            at = names.index(change["after"]) + 1 if change.get("after") in names else len(steps)
            steps.insert(at, {"name": change["name"], "formula": change["formula"]})
        elif change["kind"] == "change":
            steps[names.index(change["name"])]["formula"] = change["formula"]
        elif change["kind"] == "remove":
            steps.pop(names.index(change["name"]))
        else:
            skipped.append(f"{change['name']}: this example has no resources to add")
    return skipped


def save(steps: List[Dict[str, str]]) -> Path:
    """*steps* as a workflow file the UI opens."""
    path = example.workspace / "projects" / PROJECT / f"{BUILT}.simple-steps-workflow"
    path.write_text(json.dumps({
        "format_version": 2, "id": BUILT, "name": "Built by the agent (ask.py)",
        "steps": [{"name": s["name"], "expression": s["formula"].lstrip("="),
                   "meta": {"label": s["name"]}} for s in steps],
    }, indent=2) + "\n")
    return path


def run_tasks(agent) -> int:
    steps = [dict(s) for s in START]
    history: List[Dict[str, str]] = []
    for task in TASKS:
        print(f"── {task.name}: {task.request}")
        started = time.time()
        try:
            result = propose(agent, task.request, steps, {}, history, None)
        except ModelError as exc:
            print(f"      ✗ the model failed: {exc}\n")
            continue
        show(result)
        for line in apply(steps, result["changes"]):
            print(f"      not applied — {line}")
        print(f"      ({result['attempts']} attempt(s), {time.time() - started:.1f}s)\n")
        history += [{"role": "user", "content": task.request},
                    {"role": "assistant", "content": result["summary"]}]

    path = save(steps)
    print(f"Saved what the agent built: {path.relative_to(HERE)}\n")
    runs = example.run_saved(PROJECT, BUILT)
    passed = 0
    print("── does each task's step do the job?")
    for task in TASKS:
        run = runs.get(task.name)
        if run is None:
            verdict = f"no step called {task.name}"
        elif run.error:
            verdict = f"the step doesn't run: {run.error}"
        else:
            verdict = task.check(run.data)
        ok = verdict is True
        passed += ok
        shown = run.expression if run else ""
        print(f"{'PASS' if ok else 'FAIL'}  {task.name:10} {shown}")
        if not ok:
            print(f"      {verdict}")
    print(f"\n{passed}/{len(TASKS)} tasks done right by {agent.model}")
    return 0 if passed == len(TASKS) else 1


def ask_one(agent, request: str) -> int:
    reference = example.workflow(PROJECT, "reference")
    steps = [{"name": s["name"], "formula": "=" + s["expression"]} for s in reference["steps"]]
    print(f"── {request}\n      (against the reference workflow: {', '.join(s['name'] for s in steps)})")
    try:
        show(propose(agent, request, steps, {}, [], None))
    except ModelError as exc:
        print(f"      ✗ the model failed: {exc}")
        return 1
    return 0


def main(argv: List[str]) -> int:
    agent, why = resolve()
    if agent is None:
        print(f"The agent is off: {why}\n\n"
              "Install Ollama (https://ollama.com), then:\n"
              "    ollama pull llama3.2:3b\n"
              "or point at a model you have: OLLAMA_MODEL=qwen2.5:7b python ask.py")
        return 2
    print(f"Asking {agent.model} at {agent.base_url}\n")
    return ask_one(agent, " ".join(argv)) if argv else run_tasks(agent)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
