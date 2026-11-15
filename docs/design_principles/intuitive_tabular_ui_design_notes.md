# Design Notes: Making Tabular UIs Intuitive and Foolproof

## Goal

Design a spreadsheet-like interface that lets users edit, inspect, transform, and restructure tabular data—including nested JSON, objects, arrays, and mixed data types—without needing to understand the underlying implementation.

**Guiding principle:** Minimize the distance between **“I want to do X”** and **“I just did X.”** Make the common path obvious, provide immediate feedback, and make mistakes easy to recover from.

## 1. Why Excel Feels Intuitive

Excel's biggest advantage is **direct manipulation of structured data**: users can work on a visible grid without thinking about schemas, data structures, or commands.

| Principle | Why it helps | Design implication |
| --- | --- | --- |
| Direct manipulation | Users interact with the data itself | Edit in place; avoid unnecessary dialog forms |
| Visual consistency | Familiar gestures behave predictably | Keep selection, editing, navigation, and menus consistent |
| Immediate feedback | Results are visible right away | Show changes, validation, and previews promptly |
| Discoverability | Actions appear where users look for them | Provide contextual menus, tooltips, and lightweight affordances |
| Forgiveness | Exploration feels safe | Provide undo/redo and reversible operations |
| Progressive complexity | Novices aren't overwhelmed | Offer good defaults; reveal advanced controls on demand |
| Spatial reasoning | The grid makes relationships understandable | Keep row/column context visible during operations |

**Caveat:** Excel is also familiar because people have learned it over many years. Not every Excel feature is inherently discoverable; copy its strong interaction patterns, not its complexity or quirks.

## 2. Interaction Design Requirements

### A. Context-sensitive actions

The available actions should follow the **selection**, not require users to hunt through global menus.

- Select a cell → edit, copy, inspect, or convert the value.
- Select a column → filter, sort, rename, transform, aggregate, or validate.
- Select a list-valued column → show **Unpack**, **Index**, and **Aggregate**.
- Select an object-valued column → show **Inspect** and **Expand keys**.
- Select multiple columns → show **Combine**, **Compare**, and compatible operations.
- Select rows → show **Delete**, **Duplicate**, **Group**, or **Reorder**.

Actions should be **type-aware** and should clearly indicate their scope (cell, selection, column, or table).

### B. Familiar spreadsheet interaction conventions

- Single-click selects a cell; double-click enters edit mode.
- Enter commits; Escape cancels; Tab navigates horizontally; Enter navigates vertically.
- Support standard keyboard selection, multi-select, copy/paste, and undo/redo.
- Support multi-cell paste from spreadsheets where practical.
- Right-click opens a contextual menu.
- Drag to resize columns; support drag-fill or related interactions when applicable.
- Keep behavior stable across all tables in the application.

The objective is to reuse skills users already possess.

### C. Match operations to data types

| Data type | Useful actions |
| --- | --- |
| Number | Calculate, aggregate, normalize, format |
| String | Split, replace, concatenate, trim |
| Boolean | Toggle, filter, count |
| Date/time | Format, extract parts, group by period |
| List / array | Expand into rows, expand into columns, index, aggregate |
| Object / dictionary | Inspect, extract field, expand keys, flatten |
| Mixed / unknown | Inspect types, convert, validate, locate inconsistent values |

When an operation is incompatible, either hide it or disable it with an explanation. Prefer **preventing invalid states** over showing errors after the fact.

### D. Preview transformations before applying

Structural changes are risky because they can unexpectedly change record counts, columns, or relationships.

**Example input:**

```json
{"name": "Alice", "scores": [89, 92, 95]}
```

If the user selects **Unpack scores**, present a choice and a live preview:

**Expand into columns**

| Name | Score 1 | Score 2 | Score 3 |
| --- | ---: | ---: | ---: |
| Alice | 89 | 92 | 95 |

**Expand into rows**

| Name | Score |
| --- | ---: |
| Alice | 89 |
| Alice | 92 |
| Alice | 95 |

For each transformation, show:

1. The source selection.
2. The transformation choice and its parameters.
3. Before/after previews.
4. Expected effects on row and column counts.
5. Any information-loss or duplication warnings.
6. **Apply** and **Cancel** actions, with **Undo** available after application.

Never silently overwrite or discard data. Clearly distinguish reversible views from destructive data transformations.

### E. Good defaults, with advanced configuration on demand

Avoid requiring users to make many technical decisions up front.

- Infer likely data types and reasonable operations.
- Provide a default action based on selection and data shape.
- Put uncommon policies in **Advanced options** (null handling, collisions, expansion behavior, coercion, naming rules, etc.).
- Allow users to adjust parameters while previewing the result.
- Preserve or offer to reuse settings for repeated operations where helpful.

### F. Keep the user's orientation

At all times, help users answer:

- **What is selected?** Highlight the relevant cells, rows, or columns.
- **What will be affected?** Clearly label operation scope.
- **What changed?** Show diffs, highlighting, status, or a concise summary.
- **Where did the data go?** Preserve source-to-result traceability.
- **Can I reverse it?** Provide reliable undo/redo and a clear cancel path.

For restructurings, preserve row identities wherever possible and disclose when records are duplicated, combined, filtered, or removed.

### G. Make errors actionable

Bad:

> `ValueError: cannot unpack object`

Better:

> **Cannot expand this column.** Two cells contain numbers instead of lists. **View affected rows** or **Convert values** first.

Useful errors say **what happened**, **where**, and **how to resolve it**. Where possible, highlight the exact problematic cells and offer a safe correction.

## 3. Three Levels of UI Complexity

### Level 1 — Direct manipulation (default)

For routine tasks: select and edit cells, paste data, resize, rename, sort, and filter. The experience should be immediately recognizable to spreadsheet users.

### Level 2 — Contextual operations (revealed by selection)

For guided transformations: unpack, combine, split, aggregate, convert, validate, and restructure. Provide type-aware recommendations, meaningful descriptions, and previews.

### Level 3 — Advanced configuration (on demand)

For power users: explicit schemas, detailed transformation rules, custom expressions, policies for mixed data, and precise control over row/column mappings.

**Do not expose Level 3 complexity to users completing Level 1 tasks.**

## 4. Design Considerations for Object-Valued / JSON Grids

For a grid whose cells may contain arbitrary Python/JSON objects:

- Distinguish a **cell's display value** from its **underlying typed value**.
- Provide compact representations for complex values (e.g., `List[3]`, `Object{4 keys}`) plus drill-down inspection.
- Offer explicit restructuring operations such as **unpack**, **combine**, **pivot**, **unpivot**, **flatten**, and **aggregate**.
- Clarify ambiguous expansion semantics: arrays can become rows or columns; nested objects can be extracted or flattened.
- Track row/column identity and provenance across structural edits.
- Preview changes in shape and cardinality; call out potential data loss.
- Preserve direct manipulation and contextual actions even when the underlying transformation system is sophisticated.
- Keep validation consistent across both manually edited cells and computed/transformed outputs.

## 5. High-Priority Implementation Order

1. **Spreadsheet fundamentals:** reliable selection, keyboard navigation, editing, paste, and undo/redo.
2. **Selection-aware command system:** infer available operations from target scope and data type.
3. **Transformation previews:** run changes against a safe draft and show before/after results.
4. **Helpful validation:** identify bad cells, offer explanations and possible fixes.
5. **Advanced operations:** configurable reshaping, schema management, and power-user tools.

Each operation can follow a consistent model:

```text
Selection → Contextual actions → Configure (if needed)
          → Preview → Apply → Undo if needed
```

## 6. Usability Test

Give a first-time user an unfamiliar table and ask them—without coaching—to:

1. Change a cell value.
2. Add a new variable (column).
3. Filter records.
4. Unpack a nested object.
5. Combine two columns.
6. Undo the last operation.

Observe first clicks, hesitation, wrong turns, misunderstandings, and recovery. Track **task completion without instruction**, time to complete, error rate, and success recovering from mistakes.

## Core Takeaway

The most important investments are:

1. **Excel-like editing ergonomics** — familiar, fast, predictable interactions.
2. **Type-aware contextual actions** — expose the right operations at the right moment.
3. **Previewable, reversible transformations** — make sophisticated restructuring understandable and safe.

A good tabular UI lets novices accomplish common tasks naturally, while giving experts precise control without forcing that complexity onto everyone.
