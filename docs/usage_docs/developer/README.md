# Developer guide

For Python developers who want to put their functions in front of people who
will never read the code. You write **tools** (plain functions) and
**resources** (connections, models, clients), bundle them as an **app**, and
your users build workflows from them in the UI — see the
[User guide](../user/01-concepts.md) for what they see.

| page | read it when |
|---|---|
| [01 — Build an application](01-build-an-app.md) | you have Python functions and want them in the UI |
| [02 — Set up the agent](02-the-agent.md) | you want the chat pane on, with your model, and your tools easy for it |

The formula syntax your users write is in the User guide:
[04 — Expressions](../user/04-expressions.md). It is valid Python, so the same
lines run in a script (see *The same workflow in Python* in
[01 — Build an application](01-build-an-app.md)).

The shipped examples are the fuller reference, and they check themselves:
[`src/SIMPLE_STEPS/examples/README.md`](../../../src/SIMPLE_STEPS/examples/README.md).

## What is stable, and what isn't yet

Simple Steps is early. Some ideas are settled and you can build on them;
some details are still moving. As a rough estimate:

**Expect these to stay**

- **Tools are plain Python functions** with a decorator, `@simple_step_tool`.
  A tool's signature and docstring *are* its contract: parameter names,
  type hints, defaults and the `Args:` section are what the UI shows.
- **A workflow is a list of named steps; each step is one formula.** The
  formula is the single source of truth — the UI's forms only edit it.
- **The formula is simple-steps-core's operation syntax, and it is valid
  Python:** `tool[mod.verb(...)](wf["step"], arg=...)`. The same line runs in
  the UI and in a Python script.
- **`wf["name"]` is the only way to refer to another step.**
- **The shape verbs** — `map`, `filter`, `collapse`, `expand`, `group`,
  `select`, `sort`, `table`, `source`, `sweep`, … — and the idea that a
  verb decides the *shape* of a step's output while the tool decides the
  *values*.
- **Per-row tools read columns by name.** A parameter called `price` reads
  the input's `price` column.
- **Resources** (databases, models, clients) are separate from data: declared
  with `simple_step_resource`, referred to as `res["name"]`.
- **The agent proposes, you apply.** It writes checked formulas; it never
  runs a step or edits the workflow by itself.
- **An application is an `App(...)`** in an `app.py`, run with
  `simple-steps run app.py`.

**Expect these to change**

- The UI's layout, panels and button names.
- The on-disk workflow format (`format_version` in `.simple-steps-workflow`
  files) — save and load through the app rather than hand-writing it.
- Decorator keyword arguments beyond `category` (for example
  `operation_type=` and `id=`), and how fully type hints such as `Literal`
  are turned into UI controls.
- The built-in tool list, and the exact wording of error messages.
- Legacy CLI flags (`--ops`, `--packs`) and the deprecated `@simple_step`
  alias — don't start new work on them.
