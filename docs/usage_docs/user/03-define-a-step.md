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
| **Header** | the step's name and status (*pending*, *running*, *completed*, *error*), on one line. Click it to open or close the step. Hover it for its controls: **settings** (tune icon) and **notes** (note icon) at the bottom left, **minimize** and **maximize** at the bottom right; drag it out to float the step in its own window. A step with notes has a small arrow at the header's bottom left, on hover: it opens the notes under the header. |
| **Toolbar** | three groups. **Run** runs this step (⌘↵); **Run to the end** (fast-forward) runs it and every step after it; **Run options** has *Stage this step* (↵), *Run all steps* and *Clear output*. **Step Panels** opens **Analytics** and **Data** below. **Manage Step** moves the step left or right, locks it, or deletes it. A narrow step shows the icons without words. |
| **Formula row** | **fx** opens the Formula panel; then the **formula bar**. |
| **Panels** | whichever you've opened, always in the order Analytics, Formula, Data. Click a panel's title to fold it to just the title. |

## Write the formula

Every step's formula starts with `=`. A typical one:

```
=with_tax[mod.map(), mod.name("total")](wf["items"], rate=0.1)
```

*tool* `with_tax`, *how to apply it* `[mod.map(), mod.name("total")]` — once
per row, answer in a column called `total` — *what to apply it to* `wf["items"]`, and
*settings* `rate=0.1`. [04 — Expressions](04-expressions.md) explains each
part.

### With the Formula panel (fx)

The easiest way to start. Press **fx**: the step widens, and the panel shows
the formula **taken apart**, with a dotted line from each part to the field
that edits it. Hover a part, or a field, and both light up.

```
=double [mod.map(), mod.name("twice")] (wf["readings"], n=wf["readings"]["n"])
   ┆        ┆           ┆                   ┆                ┆
  Tool    1. map      2. name           runs over            n
```

- **Tool** (left) — choose one from the list, grouped by category. The
  formula is written for you, already reading the previous step (a *source*
  tool, which reads nothing, gets no input). A step that's just a value
  (`=[1, 2, 3]`) or a copy of a step (`=wf["readings"]`) has no tool, and
  says so.
- **Modifiers** (left) — the shape verb (*map*, *filter*, *collapse*, …),
  the output's name, and anything like *retry* or *try_except*. Add one from
  the list at the bottom; reorder or remove the ones there.
- **Arguments** (right) — first **runs over**: the step whose rows the tool
  is applied to. Its columns fill the tool's parameters **by name**: a
  parameter called `n` reads the column `n`, and the panel says so under it.
  Then a field for each parameter, with its default shown.

Under each argument that reads a step, the panel says **exactly what the
tool receives**: always the data, never the `#` column or a column's name.
An argument can read any column, whatever it's called:
`n=wf["readings"]["score"]` gives `n` each row's `score`.

| you write | the tool gets |
|---|---|
| `n=wf["r"]["score"]` | each row's own `score` (the steps must line up row for row) |
| `n=wf["r"][2]["score"]` | one value, the same for every row |
| `n=wf["one_column_step"]` | that column's values as one list, the same for every row |
| `n=wf["r"]` | the whole table, the same for every row |

Drag the line between the two columns to give the tool or the arguments more
room (double-click it to reset); the dotted lines follow. Each change
rewrites the formula bar, and editing the formula bar updates the panel.

### In the formula bar

Type the formula directly. After `=`, the bar suggests tools as you type a
name. For now, prefer choosing the tool in the Formula panel: it writes the
brackets and the input for you, in exactly the form below.

While you type, the bar only checks that the text can be read. Press
**Enter** to stage the step: it's then checked against the workflow (does
the tool exist, one shape verb, the settings' types, which steps it may
read). A step's problems show on its status pill, in its summary and in the
Formula panel; the other steps still run.

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

A reference can pick part of a step: `wf["readings"][0:2]` is its first two
rows, `wf["readings"][cols["n"] > 1]` the rows where `n` is over 1. Either
can be a step on its own or a tool's input.

A step has **one** input. To line up the rows of two steps, use a
*combine* — see [Combining steps](04-expressions.md#combining-steps).

## Run it

- **Run** in the step's toolbar runs that step. It uses the outputs of the
  steps it reads, so run those first — or
- **Run to the end**, beside it, runs that step and every one after it — or
- **Run** in the workflow toolbar runs every step, in order.

Then look at the output:

- **Data** shows the step's table. A step that failed shows its error in
  place of the table; rows that failed are marked, and the others still have
  results.
- **Analytics** sums the step up: its name, tool, status, how many rows and
  columns it produced, and its notes.

The **console** (terminal icon in the workflow toolbar) logs every run, with
the details.

The **map** along the bottom of the steps shows where a run stands: a thin
line over each step, **grey** staged (not run, or out of date), **blue**
queued or running, **green** ran, **orange** ran with some rows failed,
**red** failed. Hover it for the step's status; click to jump to the step.

## When a step is refused

Many mistakes are caught **when you press Enter**, before anything runs,
with a message saying what to write instead:

| you wrote | you're told |
|---|---|
| `scale[mod.map()](readings)` | readings is not defined. To use the step "readings", write wf["readings"] |
| `scale[mod.map()]("readings")` | "readings" is a string. Did you mean wf["readings"]? |
| `scale[mod.mapp()](wf["readings"])` | no modifier 'mapp'. Known: auto, breaker, cast, collapse, … |
| `identity[mod.select(columns=["score"])](wf["readings"])` | select names 'score', which the input does not have (it has city, n) |
| `scale[mod.map(), mod.filter()](wf["readings"])` | 2 shape verbs in one step (filter, map); at most one is allowed. Split them into separate steps… |
| `scale[mod.sort(by="n")](wf["readings"])` | sort applies no tool: write mod.sort(…)(wf["…"]). To compute with scale, use map: scale[mod.map()](wf["…"]) |
| `scale[mod.map(name="score")](wf["readings"])` | map's name= is retired: name the output with mod.name("score") after the verb |

If some **rows fail** (the tool raised on them), the other rows still have
results, and **Run** stops at that step. Add `mod.try_except()` —
optionally `mod.try_except(default=0)` — to let failures through.

The full list, with fixes:
[`examples/bad_examples/`](../../../src/SIMPLE_STEPS/examples/bad_examples/README.md).

## Name, colour and notes

Hover the step's header: the **tune** icon opens its settings, the **note**
icon its notes.

- **Step Name** — what the step is called, and what other steps write in
  `wf["…"]` to read it.
- **Color** — **Change color…** opens your system's colour picker; the
  step's header takes the colour. **Reset** goes back to the default colour
  for its position.
- **Notes** — anything worth remembering about the step: what it's for, why
  a setting is what it is. Write in Markdown (`**bold**`, `- lists`,
  `` `code` ``). The notes appear, formatted, in **Analytics**, and under
  the step's header when you open them with the arrow at the header's
  bottom left (shown on hover).

The name, colour and notes are saved with the workflow.

## Move, lock and delete

All three are in **Manage Step**. **Move left** and **Move right** change the
step's place in the row. **Delete step** removes it. **Lock** guards a step
against being deleted by accident (a padlock shows on the toolbar); unlock
it to delete it.

## A first workflow, by hand

With any app, the built-in tools are enough to try the ideas. Add four steps
with these names and formulas:

```
nums      =[3, 1, 2]
rows      =identity[mod.expand()](wf["nums"])
sorted    =identity[mod.sort(by="rows")](wf["rows"])
how_many  =count[mod.collapse()](wf["rows"])
```

`nums` is one cell holding a list; `expand` turns it into three rows, in a
column named after the step, `rows`; `sort` orders them; `collapse` with `count` gives `3`.

---

Next: [expressions — the formula syntax](04-expressions.md).
