# Design Notes: Traceable Agentic Development

## Goal

An agent helps build workflows, and the user always knows exactly what it is doing. Traceability is **how the agent works**, not a logging extension added afterwards.

**Guiding principle:** *The agent's only output is the same thing a user writes: one-line step expressions over the catalog.* What the agent produces is therefore the readable record of what it did. There is no hidden scratch code, no side channel and no action the user can't see.

## 1. Traceability by Construction

| Property | How it holds |
| --- | --- |
| **The agent writes only steps** | A proposal is a list of add / change / remove / reorder, each a formula in the grammar, plus a reply in plain language |
| **The user applies** | Nothing changes until the user accepts. Changes can be unticked one by one |
| **Every proposal is a diff** | Because a step is one expression ([one step, one expression](one_step_one_expression.md)), a proposal reads like a code diff: these lines added, this line changed |
| **Checked before it is shown** | Every formula is read by core: it parses, reads only earlier steps, and uses only catalog tools and the workflow's resources. Failures go back to the model, and anything still wrong is shown with its problem |
| **Same artifact in Python** | An accepted proposal is lines of a script ([UI ⇄ Python](ui_python_equivalence.md)), so it can be reviewed and versioned like code |
| **The agent does not run steps** (for now) | Running is the user's action. If agents run steps later, they stay within the same scope and every run is shown |

### What the user should always be able to answer

- **What did the agent change?** The proposal's diff, step by step.
- **Why?** The reply, and a stated purpose for each step.
- **What will it produce?** Core's plan and preview of the output's shape, before running.
- **Who wrote this step?** Each step records its author (user, or agent + proposal), kept in the step's `extras`.
- **How did we get here?** The history of proposals, accepted and rejected, as part of the session.

## 2. The Safety Claim

> **If every tool and resource in the catalog is safe, then every workflow built from them is safe**, whoever writes it, user or agent.

"Safe" means: no call can do anything nefarious, **for every possible value of its arguments**. This is the developer's responsibility; the platform guarantees *which* code runs, not what that code does.

The claim follows because a workflow adds no new code. A workflow is only:

1. calls to catalog entries,
2. with literal arguments, resources, or the outputs of earlier steps,
3. arranged in order, each reading only earlier steps.

Since each call is safe for **every** argument, it is also safe for any argument another step produced. Composition only moves data between safe calls.

### The constraints the claim depends on

The claim is true **only under these implementation constraints**. Each is a design rule, and breaking any one breaks the claim.

| # | Constraint | What breaks without it | How it's held |
| --- | --- | --- | --- |
| 1 | **Closed grammar.** A formula contains only catalog names, literals and references. No computed arguments, no other names, no eval | `os.remove`, `pd.read_csv` or any expression becomes reachable | Core's `formula()` reads the text; eval mode is removed |
| 2 | **Code enters one way.** Tools come only from the catalog, fixed at server boot. Nothing in the workspace is imported while running | A user or agent adds a tool, and the catalog is no longer what was reviewed | `app.py` read once; catalog frozen |
| 3 | **Safe over the whole argument domain.** Safety is checked against any value of each parameter's type, including adversarial strings | Data from one step becomes an attack on the next: a path, a SQL string, a prompt | Developer's responsibility. A tool that interprets its argument (SQL, shell, templates, an LLM with tools) is only safe if it is safe for *every* such argument |
| 4 | **No hidden state between calls.** A tool's effect doesn't depend on module-level state left by another call | Two individually safe calls combine through a shared global | Core: no mutable state at module level (K24); resources are explicit and per kernel |
| 5 | **Bounded repetition.** Per-call safety holds under volume: `map` over many rows, `sweep`, `retry` | One email is fine, ten thousand are spam; one API call is fine, a million is a bill | Limits in the catalog: row caps, rate limits, cost budgets per tool |
| 6 | **Controlled information flow.** Reading something sensitive and sending something out are each safe, but **together they leak** | Exfiltration: step A reads a secret, step B posts it to a URL | Mark egress tools (network, email, writing outside the workspace) as **sinks**. A workflow that routes sensitive data to a sink is flagged, or the sink needs explicit user approval. The maintainer can withhold sinks from the agent |
| 7 | **A trusted platform.** The server, its endpoints and the file editor sit outside the grammar | A safe workflow on an unsafe server is unsafe | Keep the server's surface small; nothing it offers runs user-supplied Python |

**Status (2026-11-15).** Constraints 1, 2 and 7 are held today. Constraint 4 is core's rule (K24). Constraint 3 is the developer's job. Constraints 5 and 6, along with step authorship and proposal history (§1), are design rules that aren't built yet.

**Constraint 6 is the important one.** Per-tool safety ("this call does nothing bad with any argument") cannot express confidentiality, because a leak only exists across two calls. The claim therefore needs either a definition of safety that includes flow (no tool sends data out), or a flow rule at the workflow level. The workflow is a linear list of steps with explicit references, so the flow is visible and checkable: core already knows which step reads which.

### What this means for the agent

The agent's text, and the data samples it is shown, may be manipulated (prompt injection). Under the constraints above, the worst it can do is **propose a composition of safe calls**, which:

- passes the same checks as a user's formula;
- is shown to the user as a readable diff;
- is applied only by the user;
- is flagged if it routes sensitive data to a sink.

The safety of agent-built workflows therefore reduces to the safety of the catalog plus these constraints. It does not depend on trusting the model.

## 3. Design Rules

1. **The agent's output is always steps.** Never code, files or settings.
2. **Show before apply.** Every change is a visible, reversible diff, checked by core.
3. **Record authorship** on each step, and keep the history of proposals.
4. **Keep the grammar closed.** Any new expressive power is a catalog entry, never a hole in the grammar.
5. **Treat egress as special.** Sinks are labelled, and data flowing into them is visible.
6. **Bound volume** for tools with real-world side effects.

## Core Takeaway

1. **Traceability is the medium, not a log.** The agent writes the same readable lines a user would.
2. **Safe tools compose into safe workflows,** under a closed grammar, a fixed catalog, no shared state, bounded repetition and controlled information flow.
3. **Information flow is the constraint per-tool safety can't capture**, and the linear, explicit structure of a workflow is what makes it checkable.
