# 02 — Use the app

For someone running an app built by someone else. The UI is still changing,
so this describes what you do rather than exactly where every button is.

## Start it

```bash
simple-steps run app.py          # the app file you were given
```

A browser tab opens. If port 8000 is busy, the next free port is used and
printed. `--no-browser` and `--port 9000` do what they say.

No app file? `simple-steps --load-examples` copies the examples to
`./examples`; `simple-steps run examples/basic/app.py` is a good first one.

## Find your way around

From top to bottom, the middle of the window is:

| area | what it's for |
|---|---|
| **File menu** and **tabs** | new, save, save as, rename; one tab per open workflow |
| **Workflow toolbar** | the workflow's **Overview** and **Resources** menus; **Run** (the whole workflow), pause and stop; the console button (terminal icon) |
| **Steps** | one column per step, left to right — scroll sideways when there are many |
| **Steps bar** | the bottom edge of the steps (see below) |
| **Console** | the run log, and a command line for the workflow |

The **Steps bar** sits under the steps. Drag it up or down to share the
height between the steps and the console; double-click it to fit it back
under the tallest step. Its **⌃ / ⌄** collapse the steps up to the toolbar,
or push the bar to the bottom to give the steps all the room. The console's
title bar has the same pair: **⌃** rolls the console up to its title bar,
**⌄** opens it out again.

The icons down the left edge open the side panels:

| panel | what it's for |
|---|---|
| **Explorer** | the workspace's files: projects and their workflows |
| **Environment** | every tool and resource this app gives you — click one for its details |
| **User Docs** | these pages |
| **Settings** (bottom) | where results are kept (**Result Storage**), and the **Step colours**: the palette that colours the steps — colours used in turn, or a gradient from the first step to the last. The app sets the starting palette (and may add its own); a choice here lasts until the server restarts. |

The chat pane on the right is the [agent](05-the-agent.md). Any side panel
can be dragged narrower, or closed with the small tab on its edge.

## Open a workflow

The **Explorer** lists projects and their workflows. Open one and it gets
its own tab — opening it again goes back to that tab rather than opening a
second copy. Press **Run** to run every step; each step's output appears in
its column.

## See what you can use

The **Environment** panel lists everything a step can use:

- **Tools**, grouped by category, with the built-ins (`identity`, `count`,
  `gather`, …) at the end.
- **Resources**: the ones in this workflow, the ready-made ones the app
  provides, and the resource *types* you can create more of.

Click a **tool** to see its description, every input with its type and
default (or *required*), what it returns, and a formula to start from with
a **Copy** button. An input that takes a resource lists the resource types
that fit it. Click a **resource** or a type to see its settings and its own
tools, which open the same way. The filter box at the top searches all of it.

## Build a workflow

A workflow is steps, one after another. How to make each one — the formula
bar, the Formula panel, running and checking it — is the next page,
[03 — Define a step](03-define-a-step.md).

## Save and share

**File → Save** (⌘S) saves the workflow; the first time, it asks for a name
and a project folder. A new workflow starts as *Untitled-1*, *Untitled-2*, …
If the name you choose is already used in that folder, you're asked before
anything is replaced — and the dialog suggests a free name (`name-2`, …).

Workflows are saved as `.simple-steps-workflow` files under
`projects/<project>/` in the app's workspace. Send the file to someone with
the same app and they can open and run it. Each step's formula, name, colour
and notes are saved; so are resources' *settings*, but not secrets.

---

Next: [define a step](03-define-a-step.md).
