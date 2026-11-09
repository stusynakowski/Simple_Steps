# 03 — Define a step

A step is one formula. The app gives you several ways to write it — type it,
build it from a form, or click to pick another step — but they all edit that
same formula, and **the formula bar is the truth**: whatever it says is what
runs and what gets saved. The full syntax is in
[04 — Expressions](04-expressions.md); this page is the how-to.

## Add a step

**+ Add Step**, at the end of the row of steps, adds one after the last. It
starts empty and named *Step N*; give it a better name in its
[Settings](#name-colour-and-notes).

## The parts of a step

From the top of a step's column down:

| part | what it does |
|---|---|
| **Header** | the step's name and status (*pending*, *running*, *completed*, *error*). Click it to open or close the step. Hover for **minimize** and **maximize**; drag it out to float the step in its own window. |
| **Toolbar** | **Analytics** (chart icon), **Data** (table icon), **Settings** (gear) open panels below. On the right: **Lock** and **Delete**. |
| **Formula row** | **▶** runs this step; **fx** opens the Formula panel; then the **formula bar**. |
| **Panels** | whichever you've opened, always in the order Analytics, Settings, Formula, Data. Click a panel's title to fold it to just the title. |

## Write the formula

Every step's formula starts with `=`. A typical one:

```
=with_tax[mod.map(name="total")](wf["items"], rate=0.1)
```

*tool* `with_tax`, *how to apply it* `[mod.map(name="total")]` — once per row,
answer in a column called `total` — *what to apply it to* `wf["items"]`, and
*settings* `rate=0.1`. [04 — Expressions](04-expressions.md) explains each
part.

### With the Formula panel (fx)

The easiest way to start. Press **fx**:

- **Tool** — choose one from the list, grouped by category. The formula is
  written for you, already reading the previous step (a *source* tool, which
  reads nothing, gets no input).
- **Inputs** — which step the tool reads, a field for each of the tool's
  settings (with its default shown), and any resource it uses.
- **Modifiers** — the shape verb (*map*, *filter*, *collapse*, …) and
  anything like *retry* or *try_except*. Add one from the list at the
  bottom; reorder or remove the ones there.

Each change rewrites the formula bar, and editing the formula bar updates the
panel.

### In the formula bar

Type the formula directly. After `=`, the bar suggests tools as you type a
name. For now, prefer choosing the tool in the Formula panel: it writes the
brackets and the input for you, in exactly the form below.

## Point at an earlier step

A step reads an earlier step with `wf["name"]` — the step's name in quotes,
inside `wf[ ]`:

```
=scale[mod.map()](wf["readings"])
```

You can also pick it with the mouse: while you're typing in the formula bar,
the earlier steps' data light up; click in one to put a reference to it into
the formula. *(Picking cells, rows and columns this way is being reworked, so
the details will change.)*

A step reads **one** earlier step. Two inputs at once need a *combine* — see
[Combining steps](04-expressions.md#combining-steps).

## Run it

- **▶** in the step's formula row runs that step. It uses the outputs of the
  steps it reads, so run those first — or
- **Run** in the workflow toolbar runs every step, in order.

Then look at the output:

- **Data** shows the step's table. A step that failed shows its error in
  place of the table; rows that failed are marked, and the others still have
  results.
- **Analytics** sums the step up: its name, tool, status, how many rows and
  columns it produced, and its notes.

The **console** (terminal icon in the workflow toolbar) logs every run, with
the details.

## When a step is refused

Many mistakes are caught **before anything runs**, with a message saying
what to write instead:

| you wrote | you're told |
|---|---|
| `scale[mod.map()](readings)` | readings is not defined. To use the step "readings", write wf["readings"] |
| `scale[mod.map()]("readings")` | "readings" is a string. Did you mean wf["readings"]? |
| `scale[mod.mapp()](wf["readings"])` | unknown modifier mod.mapp |
| `identity[mod.select(columns=["score"])](wf["readings"])` | select names 'score', which the input does not have (it has city, n) |
| `scale[mod.map(), mod.filter()](wf["readings"])` | 2 shape verbs in one step (map, filter); at most one is allowed. Split them into separate steps… |
| `scale[mod.sort(by="n")](wf["readings"])` | sort applies no tool, so it runs on identity: `identity[mod.sort(by='n')](wf["…"])`. To compute with scale, use map… |

If some **rows fail** (the tool raised on them), the other rows still have
results, and **Run** stops at that step. Add `mod.try_except()` —
optionally `mod.try_except(default=0)` — to let failures through.

The full list, with fixes:
[`examples/bad_examples/`](../../../src/SIMPLE_STEPS/examples/bad_examples/README.md).

## Name, colour and notes

Open **Settings & Notes** (the tune and note icons, one button, in the
step's toolbar):

- **Step Name** — what the step is called, and what other steps write in
  `wf["…"]` to read it.
- **Color** — **Change color…** opens your system's colour picker; the
  step's header takes the colour. **Reset** goes back to the default colour
  for its position.
- **Notes** — anything worth remembering about the step: what it's for, why
  a setting is what it is. Write in Markdown (`**bold**`, `- lists`,
  `` `code` ``); the notes appear, formatted, in **Analytics**.

The name, colour and notes are saved with the workflow.

## Lock and delete

**Delete** (bin icon) removes the step. **Lock** (padlock) guards a step
against being deleted by accident; unlock it to delete it.

## A first workflow, by hand

With any app, the built-in tools are enough to try the ideas. Add four steps
with these names and formulas:

```
nums      =[3, 1, 2]
rows      =identity[mod.expand()](wf["nums"])
sorted    =identity[mod.sort(by="value")](wf["rows"])
how_many  =count[mod.collapse()](wf["rows"])
```

`nums` is one cell holding a list; `expand` turns it into three rows in a
`value` column; `sort` orders them; `collapse` with `count` gives `3`.

---

Next: [expressions — the formula syntax](04-expressions.md).
