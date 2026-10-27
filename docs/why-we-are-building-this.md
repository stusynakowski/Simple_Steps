# Why we are building Simple Steps

> Consolidated from `WHY_WE ARE_BUILDING_THIS.md` (root) on 2026-10-23, with
> the owner's answers to two rounds of questions.

## In one sentence

Simple Steps enables people who think in spreadsheets to use Python tools
that developers write, by chaining them as one-line steps in a grid they can
see. An AI agent helps them write those steps, but it can't do anything
outside the tools it was given.

## What success means

1. **Python functions and classes, democratized.** A function or class a
   developer writes becomes something a non-programmer can find, apply to
   their data and trust, without installing Python packages by hand, reading
   the code, or writing a server.
2. **Details consolidated; what matters to the user is exposed.** Running per
   row, batching, retries, progress, long-running work, servers, sessions
   and storage are handled once, by the platform. What the user does need to
   see goes into a single expression they can read:
   `tool[modifiers](input, arguments)`. That covers which tool runs, on what
   data, how, and with which resources. The agent can help get that line
   right, for example by inferring the modifiers or fixing the syntax. Either
   way, the user can see exactly what the line does and edit it.
3. **Agentic work that is secure by construction.** An agent can only write
   steps, and a step is a one-line call to a registered tool or resource. So
   nothing an agent does can reach outside the scope that the developer and
   maintainer chose. Any argument to those tools and resources is assumed
   to be acceptable.

   This is what lets developers and maintainers trust the agent. It can't
   write its own code to reach a goal, so it can't reach one by doing the
   work in some way nobody intended. Whatever it proposes is done with the
   developers' own tools and resources, used the way they were designed to
   be used.

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

## The idea

**A workflow is a chain of one-line Python expressions that you can watch.**

- A **step** is a single expression, like a spreadsheet formula: one tool
  applied to some input, with arguments and, optionally, modifiers that say
  *how* to apply it (to each row, with retries, in batches). For example,
  `load_image[mod.map()](wf["files"])`.

  The general form is **`tool[modifiers](args)`**. It is how steps are
  usually written, not a rule without exceptions. The exceptions will be
  covered in a separate design doc on step expressions.
- A step's **output** is always a table of cells. A cell can hold anything:
  a number, a file path, an image, a figure.
- **A step's inputs are references and literals, nothing else.**
  - A **reference** is the output of an **earlier** step, `wf["files"]`, or a
    selection of it (a column, a row, a cell). Any earlier step can be
    referenced, and a step can reference several, as `join` does below.
  - Selections are a convenience: a user can pick part of a step by hand
    instead of making a separate step for it. A selection has to keep
    pointing at the same data when that data shifts (rows re-sorted, added
    or removed), and give the same result when the workflow is run again.
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
| **Reference forms** | `wf["step"]`, and selections of part of a step | the grammar; the user's manual selections write them |
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
| **step** | one entry in that list: a name and an expression. **Its position in the list is its id**. A step has several forms (the line you type, the operation it parses to, the saved recipe, the live step with its data). They are different things, but they all point to the same output ([one step, several forms](system_design/12-core-and-app.md#one-step-several-forms)) | — |
| **expression**, or **formula** | what's written in the formula bar: the right-hand side of `wf["name"] = …` in Python. The two words mean the same thing; scientists tend to say *formula*, programmers *expression* | — |
| **tool** | a function from the catalog | — |
| **operation** | what is actually executed: a tool with its modifiers, its arguments, and the data it runs on | *operation* for a plain tool |
| **modifier** | how a tool is applied: a shape verb (`map`, `filter`, …) or an execution modifier (`retry`, …) | — |
| **reference** | `wf["name"]`, or a selection of part of a step's output | `step1.col` |
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

- A general spreadsheet. Cells hold the outputs of tools, not free-typed
  values and arbitrary formulas.
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
