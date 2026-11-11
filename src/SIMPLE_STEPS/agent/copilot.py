"""
copilot.py — the copilot's session loop: plan, ask, build, validate, one turn
at a time (plan 128 A1–A3, A5; spec 018).

A session (``sessions.py``) moves through three phases:

``plan``
    The copilot reads the goal and everything it can use, and either **asks**
    up to three clarifying questions or **proposes a plan**: the resources and
    steps the workflow needs, and a dev plan of small **milestones**, each
    with a check that says when it is done. The plan is checked (real tools,
    usable resources, unique names) before the user sees it. The user answers,
    asks for changes, or **accepts** the plan.

``build``
    Each turn works on the first milestone that isn't done, and does one thing:

    - its steps are missing or failed → **propose** them (the checked
      proposal of ``proposals.py``), with the goal, plan, notes and templates
      as context; the user applies the changes and runs the steps;
    - its steps are there but haven't run → **wait**, saying which to run;
    - its steps ran → **validate**: each must have output, then the model
      judges the output against the milestone's check. Passed: the milestone
      is done and the next becomes active. Failed: propose a fix, in the same
      turn.

``done``
    Every milestone passed. Requests are still answered with proposals.

The copilot never applies or runs anything itself: it proposes, the user
disposes. Every turn appends one record to the session's ``trace``.

Any model works (``model.py``): the loop asks for text and finds the JSON.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Dict, List, Mapping, Optional, Tuple

from . import sessions
from .model import Agent, ModelError, chat_json

_NAME = re.compile(r"^[A-Za-z_][\w-]*$")
#: Tools a plan may name that aren't in the catalog: built in, or combines.
BUILT_IN = {"identity", "count", "gather", "total", "first", "last", "join", "stack", "zip_", "to_rows"}
#: Turns of conversation the model sees.
HISTORY = 8
MAX_QUESTIONS = 3

PLAN_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {"summary": {"type": "string"},
                   "questions": {"type": "array", "items": {"type": "string"}}},
    "required": ["summary"],
}

VALIDATE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {"done": {"type": "boolean"}, "reason": {"type": "string"}},
    "required": ["done", "reason"],
}

PLAN_PROMPT = """\
You are the Simple Steps copilot, PLANNING a workflow with the user. A \
workflow is an ordered list of named steps; each step applies one tool to \
earlier steps (like rows of formulas in a spreadsheet). You plan; later, you \
build the plan one milestone at a time and the user checks each one.

First decide: can you plan this goal with the tools and resources listed? \
If something essential is unclear (which data, which column, what "done" \
looks like), ask at most 3 short questions and set "plan" to null. Otherwise \
plan; don't ask about what you can reasonably assume.

A plan has:
- "resources": the resources the steps need, only from those listed: \
[{"name": "...", "why": "..."}] (usually none);
- "steps": every step in order, existing ones included if kept: \
[{"name": "short_snake_case", "tool": "a listed tool, or identity/join/stack/zip_", \
"purpose": "one sentence"}];
- "milestones": the dev plan, small increments in order, each building one \
or two steps, with a check on the OUTPUT that shows it works: \
[{"title": "...", "steps": ["step names"], "check": "what the output must show"}].

Answer with JSON only:
{"summary": "one or two sentences for the user",
 "questions": [],
 "plan": {"resources": [], "steps": [], "milestones": []}}
"""

VALIDATE_PROMPT = """\
You check one milestone of a workflow the user is building. You see the \
milestone, what it must show, and the output of its steps. Judge only what \
the check asks; be strict about it, lenient about everything else (column \
names, order of columns).
Answer with JSON only: {"done": true or false, "reason": "one sentence"}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Context: what the copilot reads, in layers, each measured for the trace
# ─────────────────────────────────────────────────────────────────────────────

def session_text(session: Mapping[str, Any]) -> str:
    """The goal, and the plan with each milestone's status."""
    lines = [f"GOAL: {session.get('goal') or '(not given yet)'}"]
    plan = session.get("plan")
    if plan:
        lines.append("THE PLAN (steps):")
        lines += [f"- {s['name']} ({s.get('tool') or '?'}): {s.get('purpose', '')}" for s in plan["steps"]]
        lines.append("THE DEV PLAN (milestones):")
        for i, m in enumerate(plan["milestones"], 1):
            lines.append(f"{i}. [{m['status']}] {m['title']} — steps {', '.join(m['steps'])}; "
                         f"done when: {m['check']}")
    return "\n".join(lines)


def context(session: Mapping[str, Any], steps: List[Mapping[str, Any]],
            resources: Mapping[str, Any], session_id: Optional[str]) -> Dict[str, str]:
    """Every layer the copilot reads, by name (the trace records their sizes)."""
    from .scope import catalog_text, resources_text, workflow_text
    return {
        "session": session_text(session),
        "tools": catalog_text(),
        "resources": resources_text(resources),
        "notes": sessions.notes_text(session),
        "templates": sessions.templates_text((session.get("context") or {}).get("templates") or []),
        "workflow": workflow_text(list(steps), session_id),
    }


def _history(session: Mapping[str, Any]) -> List[Dict[str, str]]:
    """The last turns of the conversation, as the model sees them (the
    questions it asked included, so it reads the user's answers in context)."""
    out = []
    for m in session["messages"]:
        if m.get("role") not in ("user", "assistant") or not m.get("content") or m.get("kind") == "error":
            continue
        content = str(m["content"])
        if m.get("questions"):
            content += "\n" + "\n".join(f"- {q}" for q in m["questions"])
        out.append({"role": m["role"], "content": content[:2000]})
    return out[-HISTORY:]


# ─────────────────────────────────────────────────────────────────────────────
# Checking a plan
# ─────────────────────────────────────────────────────────────────────────────

def check_plan(raw: Any, existing: List[str], resources: Mapping[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """The plan, normalised, and its problems (empty when it's usable).

    Every step needs a usable, unique name and a real tool (``res.method`` is
    a resource's tool); every resource must be one the workflow can use; every
    milestone names planned steps; a step no milestone builds gets a milestone
    of its own, and a plan without milestones gets one per step.
    """
    from ..catalog import catalog
    from .proposals import _usable_resources

    raw = raw if isinstance(raw, dict) else {}
    problems: List[str] = []
    usable = _usable_resources(resources)
    tools = set(catalog().functions) | BUILT_IN

    plan_resources = []
    for r in raw.get("resources") or []:
        name = str((r or {}).get("name", "") if isinstance(r, dict) else r).strip()
        if not name:
            continue
        if name not in usable:
            shown = ", ".join(usable) or "none"
            problems.append(f'resource {name!r} isn\'t one this workflow can use (it can use: {shown})')
        plan_resources.append({"name": name, "why": str((r or {}).get("why", "")) if isinstance(r, dict) else ""})

    plan_steps, seen = [], set()
    for s in raw.get("steps") or []:
        if not isinstance(s, dict):
            continue
        name, tool = str(s.get("name", "")).strip(), str(s.get("tool", "")).strip()
        if not _NAME.match(name) and name not in existing:
            problems.append(f"{name!r} isn't a usable step name (letters, digits and _)")
        if name in seen:
            problems.append(f"the plan lists step {name!r} twice")
        seen.add(name)
        bare = tool.split("(")[0].split("[")[0]
        if bare and "." not in bare and bare not in tools and name not in existing:
            problems.append(f"step {name!r} uses {bare!r}, which isn't a tool here")
        plan_steps.append({"name": name, "tool": tool, "purpose": str(s.get("purpose", ""))})
    if not plan_steps:
        problems.append("the plan has no steps")

    names = [s["name"] for s in plan_steps]
    milestones = []
    for m in raw.get("milestones") or []:
        if not isinstance(m, dict):
            continue
        listed = [str(n).strip() for n in m.get("steps") or [] if str(n).strip()]
        unknown = [n for n in listed if n not in names]
        if unknown:
            problems.append(f"milestone {m.get('title')!r} names steps the plan doesn't have: {', '.join(unknown)}")
        listed = [n for n in listed if n in names]
        if listed:
            milestones.append({"title": str(m.get("title") or f"Build {', '.join(listed)}"),
                               "steps": listed, "status": "todo",
                               "check": str(m.get("check") or "each step runs and has output")})
    covered = {n for m in milestones for n in m["steps"]}
    for name in names:
        if name not in covered:
            milestones.append({"title": f"Build {name}", "steps": [name], "status": "todo",
                               "check": "the step runs and has output"})
    # A milestone is listed in the order its last step appears in the plan.
    milestones.sort(key=lambda m: max(names.index(n) for n in m["steps"]))
    return {"resources": plan_resources, "steps": plan_steps, "milestones": milestones}, problems


# ─────────────────────────────────────────────────────────────────────────────
# One turn
# ─────────────────────────────────────────────────────────────────────────────

class _Turn:
    """Collects one turn's trace record and its reply."""

    def __init__(self, session: Dict[str, Any], agent: Optional[Agent], layers: Dict[str, str]):
        self.session, self.started = session, time.time()
        self.record: Dict[str, Any] = {
            "turn": len(session["trace"]) + 1, "at": sessions.now(), "phase": session["phase"],
            "action": "", "model": agent.model if agent else "", "model_calls": 0,
            "context": {k: len(v) for k, v in layers.items()}, "outcome": "", "problems": [],
            "milestone": _active_index(session) + 1 if session.get("plan") else None,
        }

    def reply(self, content: str, kind: str, **extra: Any) -> Dict[str, Any]:
        message = {"id": f"m{len(self.session['messages']) + 1}", "role": "assistant",
                   "kind": kind, "content": content, "at": sessions.now(), **extra}
        self.session["messages"].append(message)
        return message

    def finish(self, action: str, outcome: str, problems: Optional[List[str]] = None) -> None:
        self.record.update(action=action, outcome=outcome, problems=problems or [],
                           seconds=round(time.time() - self.started, 2))
        self.session["trace"].append(self.record)


def turn(agent: Optional[Agent], session: Dict[str, Any], *, message: str = "",
         action: str = "continue", steps: Optional[List[Mapping[str, Any]]] = None,
         resources: Optional[Mapping[str, Any]] = None,
         session_id: Optional[str] = None, off_reason: str = "") -> Dict[str, Any]:
    """Run one turn of *session* and return it (changed in place; not saved).

    *action*: ``continue`` (the next thing for the phase, with *message* as the
    user's words, if any), ``accept`` (the plan: start building), ``replan``
    (back to planning, with *message* as what to change). *steps*: the
    workflow as the UI holds it, ``[{name, formula, status, error,
    output_ref}]``; *resources*: its ``resources`` section.
    """
    steps, resources = list(steps or []), dict(resources or {})
    message = (message or "").strip()
    if message:
        session["messages"].append({"id": f"m{len(session['messages']) + 1}", "role": "user",
                                    "content": message, "at": sessions.now()})
        if not session.get("goal"):
            session["goal"] = message
    layers = context(session, steps, resources, session_id)
    t = _Turn(session, agent, layers)

    if action == "accept":
        return _accept(t)
    if agent is None:
        why = off_reason or "no model is set"
        t.reply(f"The copilot is off: {why}. Choose a model in the copilot's settings.", "error")
        t.finish("off", why)
        return session
    try:
        if action == "replan" or session["phase"] == "plan":
            session["phase"] = "plan"
            return _plan(t, agent, layers, steps, resources)
        if session["phase"] == "build":
            return _build(t, agent, layers, message, steps, resources, session_id)
        if not message:
            t.reply("Every milestone is done. Ask for a change, or Replan to extend the goal.", "status")
            t.finish("idle", "nothing left in the plan")
            return session
        return _propose(t, agent, layers, message, steps, resources, session_id, action="answer")
    except ModelError as exc:
        t.reply(f"The model failed: {exc}", "error")
        t.finish("error", str(exc)[:200], [str(exc)])
        return session


def _plan(t: _Turn, agent: Agent, layers: Dict[str, str], steps, resources) -> Dict[str, Any]:
    session = t.session
    existing = [str(s.get("name")) for s in steps if s.get("name")]
    scope = "\n\n".join(v for k, v in layers.items() if v)
    messages = [{"role": "system", "content": PLAN_PROMPT},
                {"role": "user", "content": f"Here is what you can use and the workflow so far.\n\n{scope}"},
                {"role": "assistant", "content": '{"summary": "Understood.", "questions": [], "plan": null}'},
                *_history(session)]
    if not session["messages"] or session["messages"][-1]["role"] != "user":
        messages.append({"role": "user", "content": "Plan the goal."})
    plan, problems, answer = None, [], {}
    for _ in range(agent.retries + 1):
        t.record["model_calls"] += 1
        answer = chat_json(agent, messages, PLAN_SCHEMA)
        questions = [str(q) for q in answer.get("questions") or [] if str(q).strip()][:MAX_QUESTIONS]
        if questions and not answer.get("plan"):
            session["questions"] = questions
            t.reply(str(answer.get("summary") or "A few questions first."), "questions", questions=questions)
            t.finish("ask", f"{len(questions)} question(s)")
            return session
        plan, problems = check_plan(answer.get("plan"), existing, resources)
        if not problems:
            break
        messages += [{"role": "assistant", "content": json.dumps(answer)},
                     {"role": "user", "content": "The plan can't be used:\n" +
                      "\n".join(f"- {p}" for p in problems) + "\nFix it and answer with the complete JSON again."}]
    session["questions"] = []
    session["plan"] = {**plan, "problems": problems}
    t.reply(str(answer.get("summary") or "Here is a plan."), "plan", plan=session["plan"])
    t.finish("plan", f"{len(plan['steps'])} steps, {len(plan['milestones'])} milestones", problems)
    return session


def _accept(t: _Turn) -> Dict[str, Any]:
    session, plan = t.session, t.session.get("plan")
    if not plan or not plan.get("milestones"):
        t.reply("There's no plan to accept yet: tell me the goal first.", "error")
        t.finish("accept", "no plan")
        return session
    if plan.get("problems"):
        t.reply("This plan still has problems; ask me to fix them before accepting it.", "error")
        t.finish("accept", "refused: the plan has problems", plan["problems"])
        return session
    session["phase"] = "build"
    first = plan["milestones"][_active_index(session)]
    first["status"] = "active"
    t.reply(f"Plan accepted. Milestone 1 of {len(plan['milestones'])}: {first['title']}. "
            "Press Continue and I'll propose its steps.", "status")
    t.finish("accept", f"building: {first['title']}")
    return session


def _active_index(session: Mapping[str, Any]) -> int:
    milestones = (session.get("plan") or {}).get("milestones") or []
    for i, m in enumerate(milestones):
        if m["status"] != "done":
            return i
    return len(milestones)


def milestone_state(milestone: Mapping[str, Any], steps: List[Mapping[str, Any]],
                    session_id: Optional[str]) -> Dict[str, Any]:
    """Where a milestone's steps stand: ``missing``, ``errors`` ({name: error}),
    ``not_run``, ``empty`` (ran with no rows) and ``outputs`` ({name: value})."""
    from ..engine import get_value
    by_name = {str(s.get("name")): s for s in steps}
    state: Dict[str, Any] = {"missing": [], "errors": {}, "not_run": [], "empty": [], "outputs": {}}
    for name in milestone["steps"]:
        step = by_name.get(name)
        if step is None or not str(step.get("formula") or "").strip():
            state["missing"].append(name)
        elif step.get("status") == "error":
            state["errors"][name] = str(step.get("error") or "the step failed")[:300]
        elif step.get("status") != "completed":
            state["not_run"].append(name)
        else:
            value = None
            if step.get("output_ref"):
                try:
                    value = get_value(step["output_ref"], session_id=session_id)
                except Exception:   # noqa: BLE001 — a gone output reads as no output
                    value = None
            if value is not None and getattr(value, "empty", False):
                state["empty"].append(name)
            state["outputs"][name] = value
    return state


def _build(t: _Turn, agent: Agent, layers, message: str, steps, resources, session_id) -> Dict[str, Any]:
    session = t.session
    plan = session["plan"]
    i = _active_index(session)
    if i >= len(plan["milestones"]):
        session["phase"] = "done"
        return _propose(t, agent, layers, message or "Is anything left to do?", steps, resources,
                        session_id, action="answer")
    m = plan["milestones"][i]
    m["status"] = "active"
    state = milestone_state(m, steps, session_id)
    where = f"Milestone {i + 1} of {len(plan['milestones'])}: {m['title']}"

    if message or state["missing"] or state["errors"]:
        feedback = [f"The user says: {message}"] if message else []
        feedback += [f'Step {n} failed: {e}' for n, e in state["errors"].items()]
        return _propose(t, agent, layers, _milestone_request(m, plan, feedback), steps, resources,
                        session_id, action="propose", milestone=m, where=where)
    if state["not_run"]:
        names = ", ".join(state["not_run"])
        t.reply(f"{where}. Run {names}, then press Continue and I'll check the output.", "status")
        t.finish("wait", f"waiting for a run of {names}")
        return session

    passed, reason = _validate(t, agent, m, state)
    m["last_check"] = reason
    if passed:
        m["status"] = "done"
        nxt = _active_index(session)
        if nxt >= len(plan["milestones"]):
            session["phase"] = "done"
            t.reply(f"{where} — passed: {reason} Every milestone is done; the workflow meets the plan.",
                    "validation", passed=True)
        else:
            plan["milestones"][nxt]["status"] = "active"
            t.reply(f"{where} — passed: {reason} Next: {plan['milestones'][nxt]['title']}. "
                    "Press Continue for its steps.", "validation", passed=True)
        t.finish("validate", f"passed: {m['title']}")
        return session
    t.reply(f"{where} — not yet: {reason}", "validation", passed=False)
    return _propose(t, agent, layers, _milestone_request(m, plan, [f"The check failed: {reason}"]),
                    steps, resources, session_id, action="validate+fix", milestone=m, where=where)


def _milestone_request(m: Mapping[str, Any], plan: Mapping[str, Any], feedback: List[str]) -> str:
    planned = {s["name"]: s for s in plan["steps"]}
    lines = [f"Build this milestone: {m['title']}.", "Its steps:"]
    for name in m["steps"]:
        s = planned.get(name, {"tool": "", "purpose": ""})
        lines.append(f"- {name}: {s['purpose']} (tool: {s['tool'] or 'your choice'})")
    lines.append(f"It is done when: {m['check']}")
    lines += feedback
    lines.append("Propose only these steps (add, or change if they exist). Use exactly these step names.")
    return "\n".join(lines)


def _validate(t: _Turn, agent: Agent, m: Mapping[str, Any], state: Mapping[str, Any]) -> Tuple[bool, str]:
    """The milestone's check: every step has output (no model needed), then
    the model judges the output against the check."""
    from .scope import _sample
    if state["empty"]:
        return False, f"{', '.join(state['empty'])} ran but has no rows."
    shown = "\n".join(f"- {n}: {_sample(v) if v is not None else '(output not available)'}"
                      for n, v in state["outputs"].items())
    messages = [{"role": "system", "content": VALIDATE_PROMPT},
                {"role": "user", "content": f"Milestone: {m['title']}\nIt is done when: {m['check']}\n"
                                            f"The output of its steps:\n{shown}"}]
    t.record["model_calls"] += 1
    answer = chat_json(agent, messages, VALIDATE_SCHEMA)
    return bool(answer["done"]), str(answer.get("reason") or "").strip() or "(no reason given)"


def _propose(t: _Turn, agent: Agent, layers, request: str, steps, resources, session_id, *,
             action: str, milestone: Optional[Dict[str, Any]] = None, where: str = "") -> Dict[str, Any]:
    from .proposals import propose
    extra = "\n\n".join(layers[k] for k in ("session", "notes", "templates") if layers.get(k))
    history = _history(t.session)
    if history and history[-1]["role"] == "user":
        history = history[:-1]                      # the request carries the user's words
    result = propose(agent, request, steps, resources, history, session_id, extra=extra)
    t.record["model_calls"] += result["attempts"]
    t.record["attempts"] = result["attempts"]
    problems = [f"{c['name']}: {c['problem']}" for c in result["changes"] if c.get("problem")]
    if milestone is not None:
        # The milestone tracks the steps actually proposed for it.
        named = [c["name"] for c in result["changes"] if c["kind"] in ("add", "change") and not c.get("problem")]
        extra_names = [n for n in named if n not in milestone["steps"]]
        if extra_names and set(milestone["steps"]).isdisjoint(named):
            milestone["steps"] = named
    summary = result["summary"] or "(no summary)"
    if result["changes"] and not problems:
        summary += " Apply the changes, run the steps, then press Continue."
    t.reply(f"{where}. {summary}" if where else summary, "proposal",
            proposal={k: result[k] for k in ("summary", "changes", "model", "attempts")})
    t.finish(action, f"{len(result['changes'])} change(s)" + (f", {len(problems)} with problems" if problems else ""),
             problems)
    return t.session


__all__ = ["turn", "check_plan", "milestone_state", "context", "PLAN_PROMPT", "VALIDATE_PROMPT"]
