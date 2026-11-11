"""
runme.py — check the agent example without a model.

    python examples/agent_demo/runme.py

A model's answers can't be predicted, so this checks everything around it:

1. **the reference workflow** — the steps a good agent adds for each request
   in ``tasks.py`` — runs through the app, matches its Python twin, and
   passes each task's check;
2. **the agent's checks** accept every reference step, and refuse the
   mistakes a small model makes, in so many words;
3. **one agent turn, with a scripted model** in place of Ollama: a wrong
   first answer is sent back with its problem, and the corrected answer comes
   out as a clean change to apply;
4. **a whole copilot session** (``copilot.py``, scripted model): goal,
   question, plan, then each milestone proposed, applied, run and validated.

To try a real model, run ``ask.py``. Exits non-zero if any check fails.
"""

import sys
from pathlib import Path

from SIMPLE_STEPS.example_check import Example, StepRun

HERE = Path(__file__).resolve().parent
example = Example(HERE / "app.py")

import order_pipeline as pipeline  # noqa: E402
from tasks import START, TASKS, as_expectation  # noqa: E402

from SIMPLE_STEPS.agent import proposals  # noqa: E402
from SIMPLE_STEPS.agent.model import Agent  # noqa: E402

# 1 ── the reference answers run, and pass their tasks' checks
example.check("agent_demo", "reference", twin=pipeline.build_reference,
              expect={task.name: as_expectation(task) for task in TASKS})

# 2 ── the agent's checks: every reference step accepted, mistakes refused
print("── the agent's checks")
names = [s["name"] for s in START]
for task in TASKS:
    problem = proposals.check_step({"name": task.name, "formula": task.formula}, names, {})
    example._report(StepRun(task.name, f"accepted: {task.formula}"),
                    [f"refused: {problem}"] if problem else [])
    names.append(task.name)

MISTAKES = [  # (what a model writes, what the check must say)
    ('=line_total[mod.map()](orders)', "orders is not defined"),
    ('=order_total[mod.map()](wf["orders"])', "there's no tool named order_total"),
    ('=is_large_order[mod.filter()](wf["totals"])', 'reads wf["totals"], which isn\'t an earlier step'),
    ('=summarize[mod.map()](wf["orders"], llm=res["llm"])', 'uses res["llm"], which this workflow doesn\'t have'),
]
for formula, says in MISTAKES:
    problem = proposals.check_step({"name": "attempt", "formula": formula}, ["orders"], {}) or ""
    example._report(StepRun("mistake", f"refused: {formula}"),
                    [] if says in problem else [f"want a refusal saying {says!r}; got {problem or 'accepted'!r}"])
print()

# 3 ── one turn of the agent, with a scripted model in place of Ollama
print("── one agent turn, scripted model")
answers = iter([
    {"summary": "Adds totals.", "steps": [{"name": "totals", "formula": '=order_total[mod.map()](wf["orders"])'}]},
    {"summary": "Adds totals.", "steps": [{"name": "totals", "formula": TASKS[0].formula}]},
])
sent = []


def scripted(agent, messages, schema):
    sent.append(messages[-1]["content"])
    return next(answers)


proposals.chat_json = scripted  # what propose() calls to ask the model
result = proposals.propose(Agent(retries=2), TASKS[0].request, START, {}, [], None)
change = result["changes"][0] if result["changes"] else {}
problems = []
if result["attempts"] != 2:
    problems.append(f"took {result['attempts']} attempt(s), not 2")
if not any("there's no tool named order_total" in m for m in sent[1:]):
    problems.append("the first answer's problem wasn't sent back to the model")
if (change.get("kind"), change.get("formula"), change.get("problem")) != ("add", TASKS[0].formula, None):
    problems.append(f"the proposal isn't one clean add of totals: {result['changes']}")
example._report(StepRun("totals", "wrong answer → told why → corrected"), problems,
                note=f"{change.get('kind')} {change.get('name')} after {change.get('after')}: {change.get('formula')}")
print()

# 4 ── a whole copilot session (plan, ask, build, validate), scripted model
print("── a whole copilot session, scripted model (copilot.py)")
import subprocess  # noqa: E402 — copilot.py builds its own App, so it runs apart
done = subprocess.run([sys.executable, str(HERE / "copilot.py")], cwd=HERE, capture_output=True, text=True)
tail = (done.stdout.strip().splitlines() or [""])[-1]
example._report(StepRun("copilot", "goal → question → plan → 4 milestones validated"),
                [] if done.returncode == 0 else [f"copilot.py failed: {tail or done.stderr[-300:]}"], note=tail.strip())
print()

sys.exit(example.finish())
