# Why we are building Simple Steps

> Consolidated from `WHY_WE ARE_BUILDING_THIS.md` (root) on 2026-10-23, with
> the owner's answers to two rounds of questions. Opening rewritten
> 2026-11-16 to say what Simple Steps does with data (linear workflows of
> tidy tables, cells meaningful to their user), alongside what it does for
> people.

**Anything a computer does can be broken into simple steps anyone can understand.**

Simple Steps is a framework that puts a team's latest software developments
in everyone's hands. It's meant to be quick, easy and robust.

## The problem

Data work happens in one of two places, and neither serves everyone.

- **Spreadsheets** are open to anyone: you see your data and what each
  formula did to it. But they can't hold real tools (an image model, an LLM,
  a database). Slow work breaks them, and a value's history disappears once
  it's pasted or overwritten.
- **Code and notebooks** hold any tool, but only programmers can read them.
  State is hidden, results depend on the order cells ran, and code an AI
  writes for an analyst is code the analyst can't check.

**Analysts** know the goal but get stuck on the implementation. An AI agent
can do that part for them, but there's no real way to check that it did it
correctly. **Developers** write tools they know are correct, but can't hand
them over without building interfaces, servers, APIs and pipelines that have
nothing to do with those tools. They can't simply share the codebase either,
because an agent helping an analyst might change working code and break it.
**Results nobody can trace are results nobody can trust.**

## The idea: a linear workflow of tables

Simple Steps organizes data work into **linear workflows that everyone can
follow**:

- **A workflow is an ordered list of steps.** You read it from start to
  finish. The data can branch and merge, but the steps form one line, with
  no graph to untangle.
- **A step is one line:** a tool applied to earlier steps' data,
  `measure[mod.map()](wf["images"])`. That line is everything the step does.
- **Every step holds one table.** **Rows are samples** and **columns are
  variables**. What counts as a sample can change from step to step (an
  image, a ward, an item of a list), but only through a step the user can
  see. Each table keeps a reference back to the rows it came from.
- **A cell is a container of data, in the terms that make sense to its
  user.** It holds what its step produced: a tool's output, data typed in,
  or data packed together for the next step. That might be a number, a
  document, an image, a chart, or a set of measurements: whatever unit the
  person thinks in. Packing data into cells and unpacking it again is how a
  user shapes it for the next step.

## What it promises

1. **Everyone can understand it.** One line per step, a table after every
   step, cells in the user's own terms.
2. **Every value can be traced.** Click a cell to see the tool, the literal
   arguments and the earlier cells that produced it. The same steps, tools
   and data give the same result, and a saved workflow reopens with its data.
3. **It never guesses.** Rows are matched only through a link core recorded.
   Nothing is lost silently, a shape it can't know yet says why, and a
   failure stays in its own cells.
4. **It stays live, even for slow work.** As in a spreadsheet, an edit shows
   at once what is out of date. Before a long run, it shows what will come
   back. While it runs, cells fill in. Afterwards, only what changed needs
   running again.
5. **Developers' tools reach everyone.** A developer writes an ordinary
   Python function or class; Simple Steps provides the interface, the
   running (per row, batching, retries, progress, long jobs), the storage and
   the server, once for every tool.
6. **Everyone can check the AI's help, and it is secure by construction.**
   The assistant can only propose steps built from the team's registered
   tools and resources, as lines a person reads, then accepts or rejects. It
   can't write code, so nothing it does can reach outside the scope the
   developer and maintainer chose, and it can't reach a goal by a route
   nobody intended.
7. **One workflow, two notations.** What's built in the app is a Python
   script, line for line, and the reverse
   ([UI ⇄ Python](design_principles/ui_python_equivalence.md)).

## The four characters

### 1. The user

**Who they are.** They're good with Excel. They know a little Python and can
follow it, but they don't write it. They understand `function(input) → output`.
They know that some formulas are fast and some are slow, and that some need
special resources, like an LLM or a database.

**Their mission.** Above all, they have a **goal** to reach, and they know it
can be broken down into steps, each one a single line of Python using the
tools and resources they have. They trust that those tools and resources are
enough for the goal. If they aren't, a developer can add the missing tool or
resource.

**What they need.**

- A grid of cells where they can always see **what data they have** and what
  each step did to it.
- Tools that are clearly named and well abstracted, applied to their data
  with a formula. The **formula bar is the primary way to define a step**.
  A tool's own controls help the user write that formula; they don't replace
  it.
- To build a **workflow**: a chain of steps that, together, reach the goal.
- To see a step before it runs (what it will produce), watch its progress
  while it runs, and inspect any cell afterwards: an image, a chart, a table.
- To save, reopen and export workflows and their results.
- Help from an agent whose work they can **read, change and reject**.

**What they must never have to do.** Run `pip install`, read a traceback, or
trust work they can't see.

### 2. The developer

**Who they are.** They know Python well and write good tools (functions) and
resources (classes: an LLM client, a database connection, a model). They don't
know exactly what data users will bring, or how users will need to run and
combine their tools.

**What they build.** An ordinary **Python library in a repo**, with:

- **Tools and resources:** functions decorated with `@simple_step_tool` and
  classes declared with `simple_step_resource`. A tool's signature and
  docstring are its contract, which means its inputs, outputs and help text.
- **Optionally, a small Simple Steps app:** a few lines that boot Simple
  Steps with their tools loaded, so anyone can try them out. It works like a
  notebook or a Streamlit app, except that every step is a one-line
  expression, `tool[modifier](args)`.
- **Optionally, example workflows** that show how the tools achieve real
  goals.

**What they must never have to do.** Write FastAPI routes, manage a server,
sessions or users, build UI, or decide how each user will orchestrate their
tools. That is the platform's job.

### 3. The maintainer

The person who puts Simple Steps in front of real users and keeps it running.
They import developers' packages, configure which tools and resources each
kind of user gets, deploy the app, manage users, and know where all user data
is stored.

Their role is small, but they depend completely on Simple Steps itself being
**robust and airtight**. That means:

- one clear object model, with each term meaning one thing everywhere;
- one way to do each thing: one syntax, one parser, one registry, one
  execution path;
- firm boundaries between users and sessions, and between engine and app.

That is the standard this codebase has to meet.

### 4. The agent

**What it is.** An assistant that chats with the user and helps build the
workflow.

**What it can see.** The task, the tools and resources available, the
current workflow and its data.

**What it can do.** Converse with the user, and **propose** changes to the
workflow: add steps, edit a step's tool, modifiers or arguments, and
remove or reorder steps. Every proposal is made of one-line expressions over
registered tools and resources.

**What it can't do.** Write code outside that scope, call anything that isn't
a registered tool or resource, or change the workflow without the user
accepting the change. **For now, it doesn't run steps either.** Agents that
can run and test steps may come later. They would still be limited to the
same scope.

**Why this is secure.** The only thing an agent can produce is a step, and a
step can only call what the developer registered and the maintainer enabled.
The user can read every step as a single line and correct it.

## A step, in detail

**A workflow is a chain of one-line Python expressions that you can watch.**

- A **step** is a single expression, like a spreadsheet formula: one tool
  applied to some input, with arguments and, optionally, modifiers that say
  *how* to apply it (to each row, with retries, in batches). For example,
  `load_image[mod.map()](wf["files"])`.

  The general form is **`tool[modifiers](args)`**. It is how steps are
  usually written, not a rule without exceptions. The exceptions will be
  covered in a separate design doc on step expressions.
- A step's **output** is always a table: rows are samples, columns are
  variables, and each cell holds what the step produced there: a number, a
  file path, an image, a figure, a packed structure.
- **A step's inputs are picks and literals, nothing else.**
  - A **pick** is an **earlier** step's table, `wf["files"]`, or part of it
    (a column, a row, a cell, a block), which is a smaller table. Any earlier
    step can be picked, and a step can read several, as `join` does below.
  - Picks are a convenience: a user selects part of a step by hand instead
    of making a separate step for it, and the app writes the pick. A pick
    has to keep pointing at the same data when that data shifts (rows
    re-sorted, added or removed), and give the same result when the workflow
    is run again. That is why core keeps a hidden identity for every row:
    a row you pick is saved as that row, not as its position.
  - A step can never reference itself or a later step. As in a notebook, you
    can't use what a cell further down will produce.
  - Everything else in the expression is a **literal**: a number, a string,
    a list.
  - There is no hidden state, so a step can't read globals, files a step
    left behind, or anything that isn't a step's output.
- **The workflow is always one linear chain.** The data can branch: two
  steps can read the same earlier step, and one step can combine several
  earlier ones. But the steps themselves always form a single ordered list.
  There are no parallel tracks, no if/else and no graph editor.
- Like a spreadsheet, it is **reactive**: change a step and the steps that
  reference it show that they are out of date.

### Worked example: images for a clinical study

| Step | Expression (sketch) | Output the user sees |
|---|---|---|
| `files` | `list_files("/study/images")` | one row per image: name and path |
| `images` | `load_image[mod.map()](wf["files"])` | the images; click a cell to view one |
| `metrics` | `measure[mod.map()](wf["images"])` | one row of measurements per image |
| `with_meta` | `join(wf["metrics"], wf["metadata"])` | measurements paired with patient metadata |
| `stats` | `summarize(wf["with_meta"])` | the statistical results |
| `plot` | `plot(wf["stats"])` | a chart |
| `save` | `export(wf["stats"], wf["plot"])` | the saved files |

Every step can be inspected, edited and re-run on its own. From "analyse
these images against the metadata", an agent could propose this whole chain.
The user would see each line, fix any that are wrong, and run them.

## What is acceptable

Decided by the owner on 2026-10-23.

**The rule: code enters only one way.** It comes in through the developer's
package, loaded by the maintainer's `app.py` when the server starts.
Everything a user or an agent sends while the app runs is data:
- formulas, in the grammar;
- literal arguments;
- resource settings;
- workflow files;
- the files in the workspace.

**Everything a step can use is in one catalog, fixed when the server
boots.** The catalog is the single list of what exists for this app. It's
used for running steps, for the palette and Environment panel, for checking
formulas, and for the agent. It holds:

| Part of the catalog | Examples | Who defines it |
|---|---|---|
| **System tools** | `identity`, `count`, `to_rows`, `load_csv` | the platform. They're on by default, and the maintainer can remove any of them |
| **Modifiers** | `mod.map()`, `mod.filter()`, `mod.retry()` | core. They're on by default, and the maintainer can remove any of them |
| **Combines** | `join`, `stack`, `zip_` | core. They're on by default, and the maintainer can remove any of them |
| **Literal types** | numbers, strings, lists, dicts, `True`/`None` | standard Python data types; the grammar allows them |
| **Picks** | `wf["step"]`, and picks of part of a step (`wf["s"][1]["n"]`) | the grammar; selecting cells in the app writes them |
| **Developer tools and resource types** | whole modules of decorated tools, single tools, `@simple_step_resource` classes | the maintainer's `app.py` |
| **Ready-made resources** | `Loaded(ClinicalDB, url=env("DB_URL"), locked=["url"])` | the maintainer's `app.py` |

Each entry also says **whether the agent may use it**. The default is yes;
the maintainer can withhold any entry. Changing the catalog should take one
line in `app.py`. ("Packs" was the old name for a module of tools. The idea
stays; the word is retired.)

**The workspace is the folder the app serves, for convenience.** It is
where `app.py` sits, or whatever folder the server was started in, or
`App(workspace=…)`. It holds:
- workflows, and their saved sessions;
- the examples the app ships;
- files users load, and files tools write, such as an output folder.

Users may read, load and edit everything there. **It is the maintainer's
responsibility not to expose a folder they don't want seen.** Finding files
in a folder is the job of a **resource** a step uses (like
`image_directory`), not a way of loading tools.

`app.py` is read once, at boot. While the server runs, **nothing in the
workspace is imported as code**, even if it's a `.py` file.

**The UI never executes Python.** All it can run is workflows (steps over the
registered tools) and resources.

| Who | Acceptable | Not acceptable |
|---|---|---|
| **User** | Write and edit formulas within the grammar, including its exceptions. Pass any literal argument. Create resources from the types the app offers, but not change locked settings. Run steps. Read, load and edit workspace files. Save, open and export workflows. Look at any cell. Accept or reject what the agent proposes | Run Python by any route: formula, console, settings, or a file the server imports. Add or change tools. Configure the agent. Change settings that affect other users |
| **Agent** | Read the tools, the resources, the workflow and its data. Propose adding, changing or removing steps, as formulas that have passed the checks | Apply its own changes, run steps, call anything that isn't a registered tool, or see tools the user can't use |
| **Developer** | Write any Python inside their tools and resources. They are trusted code, and they decide what each tool does with any argument | Reach into the server, the sessions or the storage, except through the decorators and `App` |
| **Maintainer** | Choose the libraries, the resource types, the ready-made resources with locked settings, the agent (model, temperature, prompt), where data is stored, and who can reach the server. All of it lives in `app.py` | — |

Decisions behind the table:

- **No eval mode.** No runtime path runs Python a user typed. The console
  stays, limited to calls to registered tools.
- **Tools come only from the catalog,** fixed at boot: the system set,
  minus whatever the maintainer removes, plus `App(tools=…)`. There is no
  loading tools from the workspace or from project folders while the server
  runs.
- **The workspace is chosen at boot**: `app.py`'s folder, the start-up
  folder, or `App(workspace=…)`. Exposing only what should be seen is the
  maintainer's job.
- **Users, groups and sessions will be completely isolated.** This isn't
  built yet, and building it is deployment work for the maintainer (for
  example, an extension that gives each user their own workspace). New code
  should assume it is coming: nothing global that should be per user or per
  session.
- **The agent is configured by the maintainer only, in `app.py`.** Users can
  see which model is in use, but not change it or the prompt.
- **Any argument is acceptable; what a tool does with it is the
  developer's responsibility.** The platform guarantees *which* code runs,
  not what that code does. For example, `list_files(folder)` can read any
  folder the server can. The maintainer's only lever is locking resource
  settings. A tool that should only see certain folders is written that way.

## Words and what they mean

Decided by the owner on 2026-10-24. One meaning each, used everywhere: in
the code, the API and the docs.

| Word | Means | Retired words |
|---|---|---|
| **workflow** | a list of steps | *pipeline* |
| **step** | one entry in that list: a name and an expression. **Its name is its identity** (references and hashes use it); its position is a lookup, and changes with `insert` and `move`. A step is read by its name, `wf["name"]`; `wf[0]` is refused, *wf[…] takes a step name in quotes* (core D5; run 2026-11-16. It replaced 2026-10-27's "both `wf["name"]` and `wf[index]` work"). A step has several forms (the line you type, the operation it parses to, the saved recipe, the live step with its data). They are different things, but they all point to the same output ([one step, several forms](system_design/12-core-and-app.md#one-step-several-forms)) | — |
| **expression**, or **formula** | what's written in the formula bar: the right-hand side of `wf["name"] = …` in Python. The two words mean the same thing; scientists tend to say *formula*, programmers *expression* | — |
| **tool** | a function from the catalog | — |
| **operation** | what is actually executed: a tool with its modifiers, its arguments, and the data it runs on | *operation* for a plain tool |
| **modifier** | how a tool is applied: a shape verb (`map`, `filter`, …) or an execution modifier (`retry`, …) | — |
| **pick** | `wf["name"]`, or part of a step's table (a column, a row, a cell, a block), itself a table. **Selecting** is what you do in the app; a **pick** is what it saves. They mean the same part of the table, but a pick remembers *which rows* it chose: a row you click is saved as that row's identity (core keeps one, hidden, for every row), so it still means the same row after an upstream sort, filter or edit. A range (`[0:10]`) stays positional, like `head` | *reference* for a part of a step; *selection* as the saved thing; `step1.col` |
| **kernel** | the live workflow on the server: every step as if it were a line of Python, run, with its output. **The kernel is the truth** about a workflow; the file is a saved copy of it, and the browser shows it. Its **`kernel.spec`** is the structure needed to reproduce the workflow with a particular set of tools: the workflow spec plus the catalog spec (2026-10-26) | — |
| **session** | an active construction of a workflow in the UI. The user adds steps, runs them, sees the data they produce, passes in new data, and sees what changes. Later it may include the chat with the agent, which will come as a layer on top | *session* for a browser connection |
| **workspace** | the folder the app serves | — |
| **spec** | the saved form of any object: everything needed to produce the same output, assuming what it references holds the same data. It never contains output data. Every object has one: `wf.spec`, `step.spec`, a resource's `ResourceSpec` (what's needed to load the right resource). The line `wf["x"] = …` is a step's spec written as text. Decided 2026-10-26. (`docs/spec/` is a different context: spec-driven development's requirements docs) | *saved step*, *declaration* |
| **status** | what is live about an object: a step's output, state and problems; a resource's loaded instance. A live object is its spec plus its status | — |
| **catalog** | everything a step can use (see [What is acceptable](#what-is-acceptable)) | *registry*, *pack* |

## How the pieces split

| Piece | Who makes it | Owns |
|---|---|---|
| **Engine:** [`simple-steps-core`](https://github.com/stusynakowski/simple-steps-core) | Simple Steps (separate repo) | What a step *means* and how it *runs*: tools, modifiers (map, expand, filter, group, retry, batch, async), references, cell states, staleness, previews, the save format |
| **Platform:** this repo, `pip install simple-steps` | Simple Steps | The server, sessions, storage, the grid UI, cell viewers, the agent, the developer decorators, app configuration |
| **Tool libraries** | Developers | Tools, resources, optionally a small showcase app, and example workflows |
| **Deployed apps** | Maintainers | Which libraries, tools and resources each kind of user gets; users; hosting; where data lives |

The test between the first two: if a different front end (a notebook, a
script) would need it to get the same **results**, it belongs in core. If
it's about how this app **shows, stores or edits** them, it belongs here.

## Not goals

- A general spreadsheet. A cell holds what its step produced (a tool's
  output, data typed in, data packed for the next step), never a formula of
  its own: every cell comes from its step's one expression, and typed-in
  data is a step too.
- A general Python notebook. Users and agents compose registered tools in
  one-line expressions; they don't write arbitrary code.
- An autonomous agent. It proposes; people decide and run.
- A branching or graph-shaped workflow. The data can branch; the chain of
  steps can't.

## Topics each needing its own design doc

Step expressions: `tool[modifiers](args)` and its exceptions · Resources · the developer's library and showcase app · app configuration and
deployment for maintainers · the UI · chaining and orchestration · saving
and exporting workflows and data · the agent · sessions, users and where
data is stored.
