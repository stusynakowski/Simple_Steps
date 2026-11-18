# 141 — Step groups: consecutive steps under one header

**Status:** proposed (2026-11-17), app at `06af47c` on core 1.0.3 (`adfaf87`).
Dev plan [136](./136-consolidation-plan.md) track D, I7. The UI word is
**group** (owner, 2026-11-17: "to minimize confusion"); core calls the same
thing a **stage**, and this page uses core's word only for core's calls.

## 1. What the owner asked for (2026-11-17)

- **Consolidate consecutive steps into one idea**: data loading,
  preprocessing, main processing, analysis, saving. A group adds no
  computation; it organizes the workflow (decided 2026-11-15, 136 D·I7).
- **Don't disturb the UI.** A step that is in no group keeps its header
  exactly as it is.
- **A grouped step's header is split horizontally in two:** the **top half
  is shared** across every step in the group and carries the group; the
  **bottom half is the step's own**. The step's name moves a little down,
  into the bottom half. The two halves are **two shades**.
- **Collapse and expand** a group quickly. Collapsed, it is **one header the
  shape of a step header**, **multi-coloured**: the top half the group's
  colour, the bottom half cut into **parallelograms, one per step, each in its
  step's colour**.
- **The group's header has most of the step header's features, but its only
  actions are about running**, plus **notes**. Its run controls sit on a
  **popover that looks like the step toolbar**: "a mini workflow manager".
- **The group's colour shows on the steps' map** along the bottom.
- **A group is made by selecting step headers, then the popover** (owner's
  choice of the options offered).
- **A group is a nested expander** (owner, 2026-11-17): the group half is the
  top level of the expansion, and it folds and unfolds its steps' tables
  together, as each step's own *Data ▸* expander (133) does for one table.
- **Run group runs only the group's steps**: a mini workflow, or a step made
  of steps. Nothing before or after it runs.
- **Colours nest** (later): a group has its colour, and its steps take shades
  or close colours from that group's own palette.

## 2. What core gives (run 2026-11-17, core 1.0.3)

| Call | Behaviour, as run |
|---|---|
| `k.stage(name, first=, last=)` | groups the steps from `first` to `last`; `k.stages` → `{'prep': ['load', 'clean']}`; `k.stage_of(step)` → its group or `None` |
| `k.stage_status(name)` | the group as one step: `{'state', 'steps', 'needs_run', 'output'}`, e.g. `state: 'staged'`, `needs_run: {'clean': 'staged'}`, `output: 'clean'` (the last step) |
| `k.run_stage(name)` | brings the group up to date: runs a step before it only if the group reads it and it needs a run; runs nothing after it; runs nothing when all is current (0 tool calls) |
| `k.run_stage(name, force=True)` | runs the group's own steps again, not the ones before it |
| `k.run(step, fresh=False)` on each group step, in order | runs on what the inputs show: a **stale** step before the group is **left as it is** and the group reads its current output. But a step before the group that has **never run** is still run first (it has no output to read) |
| `k.rename_stage`, `k.unstage` | as named |
| saving | `workflow.json` keeps `[{'name', 'steps'}]`; a group is in no id, so it never makes a step stale |
| editing | core keeps groups valid through insert (inside joins), move (out leaves), rename (follows) and delete (its last step deletes it); groups never overlap; a step is in at most one |
| **not there** | a stage edit sends **no `on_change`** (read `k.stages` after an edit); a stage has **no extras**, so its colour, notes and folded state are the app's |

## 3. The design

### 3.1 Words

| Word | Means |
|---|---|
| group | consecutive steps under one shared header half; core's stage |
| group half | the top half of a grouped step's header, shared across the group |
| step half | the bottom half: the step's own header |
| folded group | the group shown as one header |

### 3.2 A grouped step's header

```
 ungrouped        grouped (three steps)                      ungrouped
┌─────────┐ ┌──────────────── preprocessing ────────────────┐ ┌─────────┐
│         │ │  ▸ group half: group colour, name, run icon    │ │         │
│ load   ▸│ ├───────────────┬───────────────┬───────────────┤ │ report ▸│
│         │ │ clean        ▸│ filter       ▸│ tidy         ▸│ │         │
└─────────┘ └───────────────┴───────────────┴───────────────┘ └─────────┘
```

- **Group half** (top): one band across the group's columns, in the
  group's colour (a lighter shade of it than the step half uses). It shows
  the group's name, its run icon from `stage_status` (the same icons and
  colours as a step's, `utils/runState.ts`), and on hover its controls,
  bottom right as on a step: notes, the run popover, fold.
- **Step half** (bottom): today's header, name moved down into it, in the
  step's colour. Its controls are unchanged.
- The header's height doesn't grow; each half is half of today's header, so
  the grid below doesn't move.

### 3.3 A folded group

```
┌───────────── preprocessing ─────────────┐
│ ▸ group colour, name, run icon           │
├──────────/─────────────/─────────────────┤
│  clean  /   filter    /    tidy       ▸  │   one parallelogram per step,
└────────/─────────────/───────────────────┘   each in its step's colour
```

One arrow, the shape and width of a step header. The parallelograms are the
step map's own shapes, so the eye reads them as steps. Clicking the group
half unfolds it; hovering a parallelogram names its step and its state.

**A nested expander** (owner, 2026-11-17): folding a group folds its steps'
tables with it, so nothing shows under a folded group but its header and,
when open, its notes (the group's metadata). Unfolding brings back each step
as it was, each table still folded or open by its own *Data ▸* expander.
**Folded or not is each viewer's own**, never saved in the workflow (kept in
the browser, like a remembered panel).

### 3.4 The group's popover: a mini workflow manager

Opened from the group half, styled as the step toolbar:

| Control | Calls |
|---|---|
| **Run group** | **only the group's steps**, on what their inputs show (owner, 2026-11-17): today `k.run(step, fresh=False)` for each step in order; core's own call when 008 C54 lands. A step before the group that has never run is refused with its name ("run `load` first"), not run |
| **Run again** | the same, with `force=True` (plan 140's *Run again* for a step) |
| **Stop** | the run's cancel, once plan 138 N2 has one; hidden until then |
| status | `stage_status`: the group's state and the steps that need a run, each a link that scrolls to it |
| fold / unfold | §3.3 |
| rename, colour, ungroup | `k.rename_stage`, the app's colour, `k.unstage` |
| **notes** | as a step's notes (Markdown under the group half), saved with the group |

### 3.5 Making a group

Shift-click step headers to select consecutive steps; the selection popover
offers **Group steps**, which names the group (a default like `group 1`,
renamed in place) and calls `k.stage(name, first, last)`. Not offered, with
the reason as its tooltip, when the steps aren't consecutive or one is
already in a group. Nothing new on the grid itself (owner's rule: controls on
the popover).

### 3.6 The steps' map

Each step's chevron on the map (`StepMinimap`) gets its group's colour on its
top half, as its header does, so a group reads as one band along the map. A
folded group is one chevron, split as in §3.3.

## 4. Where it's saved

| What | Owner | Where |
|---|---|---|
| a group's name and its steps | core | core's workflow (`k.stage`), and the app's workflow file as `groups: [{name, first, last, meta}]`, declared to core when the file loads |
| colour, notes | the app | that group's `meta` in the workflow file (as a step's `meta` holds its colour and notes) |
| folded | each viewer | the browser only; never in the workflow file |

Membership is core's: after every edit the app reads `k.stages` back and
writes the file from it, so an insert, move or delete that core resolves is
what's saved. The file never decides membership on its own.

## 5. Requirements

| ID | Requirement |
|---|---|
| REQ-GRP-001 | A step in no group shows today's header unchanged |
| REQ-GRP-002 | A grouped step's header is two halves: the shared group half on top, the step half below, in two shades |
| REQ-GRP-003 | The group half spans exactly the group's columns and shows its name and run state from `stage_status` |
| REQ-GRP-004 | A group folds to one header the shape of a step's: group colour on top, one parallelogram per step below, each in its step's colour; folding hides its steps' tables (a nested expander); unfolds on click; folded is per viewer |
| REQ-GRP-005 | The group popover runs only the group's steps, on what their inputs show, never a step outside it; runs them again (`force=True`); and shows which need a run. A never-run input outside the group is refused by name |
| REQ-GRP-006 | A group has notes, edited and shown as a step's are, saved with the workflow |
| REQ-GRP-007 | Selecting consecutive step headers offers *Group steps*; non-consecutive or already grouped steps are refused with the reason |
| REQ-GRP-008 | Rename, recolour and ungroup from the group popover |
| REQ-GRP-009 | The steps' map shows each group's colour on its steps' chevrons; a folded group is one split chevron |
| REQ-GRP-010 | Groups, their colour and notes survive save and reopen; membership after insert, move, rename and delete is core's |
| REQ-GRP-011 | Grouping, ungrouping or folding never changes a step's state or output |

## 6. Phases

| Phase | What | Done when |
|---|---|---|
| **G1** backend | the workflow sync carries `groups`; the file saves and loads them; `/api/run` takes `group` and `force`; `k.stages` read back after each edit | a workflow with a group saves, reopens and runs its group from the API (REQ-GRP-010, 011) |
| **G2** the split header | group half and step half; the name moved down; two shades | REQ-GRP-001–003, in vitest and by eye |
| **G3** making a group | select headers, *Group steps*, rename, ungroup | REQ-GRP-007, 008 |
| **G4** the popover | run, run again, status, notes, colour | REQ-GRP-005, 006 |
| **G5** folding | the folded header, its parallelograms | REQ-GRP-004 |
| **G6** the steps' map | colour bands; a folded group's chevron | REQ-GRP-009 |

## 7. Decisions (owner, 2026-11-17)

| # | Question | Decided |
|---|---|---|
| 1 | Under a folded group | **nothing but its header** (and its notes when open): a group is a nested expander over its steps' tables |
| 2 | Is folded saved? | **each viewer's own**, not saved |
| 3 | What *Run group* runs | **only the group's steps**, like a mini workflow; never a step before or after it (core ask 008 C54 for the never-run case) |
| 4 | A group of one step | **allowed** |
| 5 | Colours | a group palette now; **nested palettes later**: a group's colour, its steps in shades or close colours of it |

## 8. Progress

| Phase | Status |
|---|---|
| **G1** backend | **done 2026-11-17** (owner: "start building"). `PipelineFile.groups` (`[{name, steps, meta}]`); `workflow_groups` on `/api/workflow/sync` and `/api/run` (`None` leaves the kernel's groups as they are); `kernels.sync_groups` makes core's stages match after the steps sync, `group_summary` reads them back (`{name, steps, state, needs_run}`, or `problem` when core refuses one) in the sync response and run metrics; `/api/run` takes `group` (runs only its steps, each `k.run(n, fresh=False)`, refusing by name a never-run step it reads from outside) and `force` (*Run again*, for a step or a group; `step_id` is now optional). Checked through the HTTP API with counted tool calls (15 checks: refusal runs nothing; a group run calls only its steps; a current group or step runs nothing; `force` reruns; an insert inside joins; a refused group says why; ungroup; the file keeps `groups` with `meta`); groups survive put-away and restore; pytest all pass. Core's refusals say "stage" (its word); the UI may show them as they are or swap the word |
| **G2** the split header | **done 2026-11-17**. Frontend: `Workflow.groups` (`StepGroup`: name, step **ids**, so a step rename keeps it, `meta`; core's `state`, `needsRun`, `problem` not saved); the file's `groups` load and save; every sync sends the groups by current step names and applies core's read-back (membership after an insert, move or delete; a group with no steps left is gone); a run's metrics do the same. Drawn: a grouped step's arrow is painted in two halves (`linear-gradient`: `--group-color` on top, `--step-color` below), so shape and height don't change; its name and run icon move into the lower half; the group's first step shows the group's name and run icon (`groupRunState`) in the top half. Group colours: `theme.groupColor`, a palette of deeper tones; `meta.color` wins. Checked in the running app (headless Chrome on a scratch workspace: a three-step and a one-step group between ungrouped steps, both showing core's state); tsc clean; vitest 138/138; bundle rebuilt. Seen: a palette group colour can sit close to its step's (`analysis` / `analyse`, both teal): nested palettes (§7 #5) settle it |
| **G3** making a group | **done 2026-11-17**. Shift-click a step header adds it to (or takes it from) a header selection, outlined white; its popover offers **Group steps**, disabled with the reason when the steps aren't next to each other or one is already in a group (`whyNotGroup`), and **Clear selection**; Esc, a plain header click or a click elsewhere clears it. Grouping names it `group N` and opens the group's popover at once to rename it. A click anywhere on a group's band (any of its steps' top halves) opens **the group's popover**: its name, renamed in place (Enter or leaving the field; refused when empty or taken), its steps, and **Ungroup**. G4 adds the run controls and notes to this popover. The step menus' pop-up is now one component, `StepPop` (`StepMenu.tsx`), used by the step menus and both group popovers. Icons `stacks`, `ungroup` added. Checked in the running app (13 checks, headless Chrome: refusals with their reasons, Esc, group and rename, core's state read back for each group, ungroup from a band clicked over a middle step, a plain click still opens a step, no page errors); a shift-click no longer selects page text (found driving it, fixed); vitest 138/138; bundle rebuilt. Not yet on the console's command bus (`announce`): grouping isn't in the replayable transcript |
| **G4** the popover | **done 2026-11-17**. The group's popover gains **Run group** (`/api/run` with `group`: only its steps, each on what its inputs show) and **Run again** (`force`), both off while it runs or when core refused the group; where it stands (`not run`, `out of date`, `ran`, …) and which steps need a run, with core's reason; a **colour** row (the group palette, `meta.color`); and **notes** (Markdown, edited in place, `meta.notes`, saved with the file). While a Run group is in flight its steps and the band's icon show running. `useWorkflow.runGroup`, `setGroupMeta`; `api.runStep` takes `{group, force, groups}`. Checked in the running app (16 checks, headless Chrome, a six-step workflow of real tools: a group reading a never-run step outside it is refused by name and nothing runs; after that step runs, Run group runs its three steps and leaves the steps after it staged; status reads `ran`; Run again sends `force`; recolour; notes render as Markdown; no page errors); vitest 138/138; bundle rebuilt. Open: a refusal shows only in the log (the popover has closed by then); status lines don't yet scroll to their step |
| **G5** folding | **done 2026-11-17**. **Fold group** / **Unfold group** in the group's popover. A folded group is one header (`FoldedGroup.tsx`) in its first step's place: the same arrow and height as a step's, the group's colour, name and run icon on the top half, and its steps below as parallelograms (leaning as the arrow's edges, 28px over the half's 25px), each in its step's colour, hovering one names its step and state. Nothing shows under it: its steps' columns and tables are gone until it unfolds (a nested expander). A click on the top half opens the group's popover, as an unfolded group's band does (so a folded group can still be run); a click on the steps unfolds it. Folded is each viewer's own: kept in the browser per workflow (`localStorage`, `simple-steps:folded-groups:<workflow id>`), never in the file. Its other steps keep an empty, zero-width place so the steps' map still lines up step for step (G6 draws a folded group as one split chevron there). Icons `unfold_less`, `unfold_more` added. Checked in the running app (12 checks, headless Chrome: fold, the three columns gone, one parallelogram per step with its state, the header's height, the top half opens the popover saying Unfold, folded after reopening, another browser sees it unfolded, unfold restores every column, the file holds no fold, no page errors); vitest 138/138; bundle rebuilt |
| **Controls on the band; a steps multiselect** | **2026-11-18**. After trying three other layouts the same day (a group button in Manage Step, then in the step header; a taller header with a toolbar strip; a row of group headers above the steps), all undone at the owner's word ("worse"), the owner settled: keep **the split step header** (no change in size); put **all of a group's features as buttons with popovers on its band, as a step header's controls**, including the run options; **grouping like a Streamlit multiselect**, easy to add and remove steps; no shift-click ("we can add that stuff later"). Now: the band carries the group's name and run icon on its first step and **its controls inline at its end** (its last step): **Run options** (Run group, Run again, with the status), **Notes**, **Settings**, **Fold**; on a one-step group they show on hover so the name fits. **A click on the band folds the group**; a click on the folded header unfolds it; the folded header carries the same controls; a click on one of its steps unfolds it and opens that step, to run it alone. **Settings**: name, **steps as chips** (× takes an end step out; a middle step's × is off, as a group is consecutive steps) and **+ Add step** (steps outside other groups; one further away brings in the steps between), colour, Ungroup. **An ungrouped step's header** has a group button: it makes that step a group and opens its settings, to add steps. The G3 shift-click selection and its popover are gone, and so is the G4 group popover (its parts are the band's popovers). Checked in the running app (17 checks, headless Chrome: headers stay 50px; the controls sit only at the band's end; run options, notes, settings; chips, a middle × off, × an end step out, the add list leaves out steps past another group, add one; controls follow the new last step; band click folds, the folded header keeps the controls, unfolds; a step's group button makes a group with its settings open; a folded step opens alone with Run Step; no page errors); `tsc -p tsconfig.app.json` clean; vitest 138/138; bundle rebuilt |
| Run group, visibly | **2026-11-18** (owner: "…but the ability to run"). Run group from the band's run options was refused when a step the group reads from outside had never run, and said so only in the log, so it looked like nothing happened. Now the refusal shows **on the group's band**: its run icon turns red and a label says what to do ("run 'load' first"; the full reason on hover), and the name and label run on across a several-step band rather than being cut to the first step. A step run clears it; the next Run group says again if it still can't. Checked in the running app (7 checks: refused with the label and a red icon; after `load` runs on its own the label is gone; Run group then runs, the icon green; Run again runs; no page errors) |
| **UI fixes** (G6 done with them) | **2026-11-18**. Owner: (1) "the group header should be flush… grouped segments should be connected… not divided by the outline"; (2) "the widgets on the group and step should not be shown if we are not hovering on them… the hover label is still shown when i hover over the group and not the step"; (3) "the horizontal scroll bar does not show the multi color steps (label these with i-j…) this also goes for fully collapsed groups"; (4) "make sure the color palette between group and steps match… pick a color palette and then have smooth transitions between each tone". Now: (1) **the band is one piece** (`GroupBand.tsx`), drawn over its steps' top halves, the top half of a step header's arrow from the first step's tail to the last step's point, its run colour round the edge; the steps no longer carry a piece of it each, so no step outline divides it. (2) **Its controls show only on hovering the band** (or while one of their popovers is open), folded or not; the band sits outside the steps' headers, so hovering it no longer brings up a step's controls. (3) **The steps' map** (`StepMinimap`) draws each group as one chevron split as its headers are: the group's colour on top, its steps' colours below (each across its column's share; folded, equal shares), labelled **i–j** (its first and last step numbers; one step: its number); hovering says "Steps i–j · name · state"; a click jumps to it. (4) **One palette**: every step palette is blended along the workflow with its colours as the stops (lists were used in turn before), and a group without its own colour takes **the palette's tone where it sits, deeper** (`useGroupColor`); its settings offer the palette's tones, deeper, instead of a separate fixed set (`GROUP_PALETTE` removed). Checked in the running app (17 checks, headless Chrome: one band exactly over clean..tidy at half the header's height, no per-step pieces; widgets hidden at rest, shown on hover, no step widgets on hovering the band, hidden at rest when folded; the band spans the folded header; the map labels the group 2–4 folded and unfolded, a one-step group 5; the group colour comes from the palette; run options and the settings multiselect still work, the widgets stay while settings are open; no page errors); `tsc -p tsconfig.app.json` clean; vitest 138/138; bundle rebuilt |

## 9. Asks of core

| | Ask | Why |
|---|---|---|
| **C54** | `k.run_stage(name, fresh=False)`: run only the group's steps, on what their inputs show; an input outside the group that has never run blocks the group, naming it, rather than being run | run 2026-11-17: `run_stage` runs earlier steps the group reads when they need it; `run(step, fresh=False)` leaves a stale one alone but still runs a never-run one. The owner's rule is the group only |
| C53 | clearing a step's output (owner is adding it to the next core version) | a group's popover may offer *Clear group* once it exists |
