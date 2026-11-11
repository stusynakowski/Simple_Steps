# Specification: The resource column

A workflow's resources (an LLM client, a database, a file system) belong to
the workflow, not to a step; steps only use them, with `res["name"]`. They
get a column of their own at the start of the step layout, before step 1,
in both the main and the detached (dev) layouts. It replaces the toolbar's
Resources menu (`ResourcesMenu.tsx`). It should be present but quiet: a
resource needs no references drawn, only which steps downstream use it.

Owner, 2026-11-10. Probed the same day: live objects are the app's
(`resources.py`, `live_resource`), built on a step's first use and kept per
session; core only checks declarations. So Load / Refresh / Clear need no
core change.

## The column

- **REQ-RES-001:** the column comes first in the step layout, ahead of
  step 1. It is one flat panel, flush to the top and bottom of the canvas,
  square-cornered. Its right edge is one vertical bar with **Resources**
  written down it, between the resources and the steps (REQ-RES-006)
  (owner, 2026-11-10).
- **REQ-RES-002:** the column's header, **Resources**, is a step header's
  height and width but not an arrow: a flat bar. It shows the number of
  resources and a dot when any of them needs attention (REQ-RES-012).
- **REQ-RES-002a:** each resource shows an icon for its kind, read from its
  type's name and bases: database, file system, compute, language model,
  service, or a generic one; its status dot sits on the icon's corner.
- **REQ-RES-003:** clicking the header opens the column downwards: one
  header per resource in the workflow, stacked vertically, each in the same
  flat-left shape, with its name and status dot (REQ-RES-011). Clicking
  again closes it back to the header alone.
- **REQ-RES-004:** clicking a resource's header opens that resource: it
  widens to a step's width and its panel drops down beneath it
  (REQ-RES-008). The column widens with it and the steps shift right; they
  are never covered.
- **REQ-RES-005:** several resources can be open at once. They stack
  vertically in the column, each with its own header and panel. Each can be
  closed on its own, back to its header.
- **REQ-RES-006:** the edge bar hides and shows the column. Its chevron
  and a hover highlight say it can be clicked. Clicking it hides the
  column down to the bar alone, which shows each resource's kind icon and
  status dot (clicking one opens that resource), or with no resources just
  the word. Dragging the bar sets the column's width, as a step's sides do;
  dragged far enough left, the column hides. Hiding, showing and opening
  slide (0.3s) as a step's do. The width is saved per user.

## Pinning

- **REQ-RES-007:** the Resources header has a pin, **off by default**. While
  pinned, scrolling the steps sideways leaves the hidden bar (REQ-RES-006)
  stuck to the left edge of the step layout, clickable to open the column. Scrolling all the way back to
  the left shows the full column again, in the state it was left in.
  Unpinned, the column scrolls away with the steps like step 0. Whether it
  is pinned is saved per user, not in the workflow.

## A resource's panel

The panel looks and behaves like a step's: header with hover controls,
then a toolbar, a formula bar, and panels that fold.

- **REQ-RES-008:** a resource's header carries its kind icon, name, status
  dot and type, and the same controls as a step's: notes, settings,
  minimize, maximize. Maximized, the resource is a box the size of the
  canvas, wide and tall, its browse area filling it; restore brings the
  column back. In settings the name and the colour can be changed; notes open
  under the header as a step's do (Markdown). Renaming a resource that steps
  use is refused, naming them, until each use is changed. (Open: whether a
  rename should rewrite the steps' `res["…"]`.)
- **REQ-RES-009:** where a step has Run, a resource has **Load**,
  **Refresh** and **Clear**:
  - **Load** builds the live object now, in this session, instead of on a
    step's first use;
  - **Clear** drops this resource's live object only, keeping its
    declaration; the next use or Load builds a new one;
  - **Refresh** is Clear, then Load.
  A failure to build shows on the resource, with core's or the type's
  message, and leaves it not loaded.
- **REQ-RES-010:** the formula bar holds the expression that defines the
  resource, `Type(setting=…)`, e.g. `FakeLLM(model="fake-1")`, and nothing
  else. Committing it saves the declaration through the same path the
  console's `res["x"] = Type(…)` uses, so the two can't drift; a bad setting
  is refused before it is saved. Settings the deployment locks or reads from
  the environment show as locked and can't be changed. Parsing rules are
  never written in the frontend. (Open: whether parsing moves from
  `resources.py`'s own `ast` reading to core's `formula()`; to be probed.)
- **REQ-RES-011:** the status dot says one of:
  - **not loaded** — declared, no live object in this session;
  - **loaded** — a live object exists in this session;
  - **error** — it could not be built, or its type isn't in this app;
  - **changed** — a ready-made resource whose deployment settings differ
    from those saved, with **Accept** to take them;
  - **missing** — a ready-made resource the deployment doesn't provide here.
  Connected / disconnected beyond "loaded" needs an optional check a
  resource type could define; out of scope here.
- **REQ-RES-012:** "needs attention" (REQ-RES-002, REQ-RES-006) means any
  resource is in error, changed or missing.
- **REQ-RES-013:** the panel lists the steps that use the resource, as chips
  in each step's colour. Hovering a chip, or the resource's header,
  highlights those steps in the layout. A resource no step uses says
  "not used yet".
- **REQ-RES-014:** a loaded resource has a browse panel under its formula
  bar (e.g. a file system's tree or a database's tables). For now it is a
  placeholder that says what it will hold; a not-loaded resource has none.

## Adding and removing

- **REQ-RES-015:** the column's last entry is **+ Resource**. It opens a new
  resource's panel with an empty name and formula bar, and the app's
  resource types as templates that fill the formula bar with their settings
  and defaults.
- **REQ-RES-016:** ready-made resources the deployment provides but the
  workflow doesn't use are listed under the column's resources, each with
  **Use**, which adds it to the workflow.
- **REQ-RES-017:** a resource can be removed from its settings. Removing one
  that steps use names them first.

## What it replaces

- **REQ-RES-018:** the toolbar's Resources menu is removed once every
  behaviour above that it had is in the column: listing, adding from type
  templates, Use, Accept, locked-setting notes, edit, remove. Each removal
  is confirmed by the owner first.
- **REQ-RES-019:** the workflow overview describes the column's current
  state instead of a bare count: how many resources, how many loaded, how
  many need attention.

## Storage

- **REQ-RES-020:** a resource's notes and colour are saved with its
  declaration, under a `meta` key as a step's are, and never change how it
  is built. (Open: whether the declaration format is the app's alone or also
  core's; to be checked by running core before this lands.)
