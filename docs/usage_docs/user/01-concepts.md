# 01 — Concepts

Simple Steps brings spreadsheet-style work and Python together. Someone who
writes Python gives you **tools**; you put them to work in a **workflow**: a
row of **steps**, each one a small table, each built from the one before it.
You never need to read the tools' code. A handful of ideas cover it.

## Workflow

An ordered list of steps, shown left to right. Running the workflow
(**Run All**) runs its steps in order. A workflow is saved as a
`.simple-steps-workflow` file in a project folder, and opened from the
**Explorer**.

## Step

One named stage of a workflow, shown as a column. A step has a **name**, a
**formula** that says what to do, and — once it has run — an **output**, a
table you can look at. Think of a step as one sheet in a spreadsheet, whose
contents are computed from the sheet before it.

## Formula

What a step does, written on one line in the step's formula bar, starting
with `=`:

```
=with_tax[mod.map(), mod.name("total")](wf["items"], rate=0.1)
```

Read it as: *apply the tool `with_tax`, once per row (`map`), to the output of
the step `items`, with `rate` set to 0.1, and call the answer column
`total`.* The formula is the whole truth about a step — the forms and
dropdowns in the app only edit it. [04 — Expressions](04-expressions.md)
has every part.

## Tool

A function the app gives you, like `with_tax` above. Each tool has a name, a
description, and inputs, some with defaults. The **Environment** panel lists
them all; click one to see what it takes and returns, with a formula to
start from. Tools come from the app's developer (see the
[Developer guide](../developer/README.md)); some are built in.

## Referring to another step

A step reads an earlier step by name: `wf["items"]` means *the output of the
step called `items`*. It's the only way to refer to a step — `items` on its
own, or `"items"` in quotes, is not a reference. `wf["items"][0:2]` reads
just part of it. A step has one input; to line up the rows of two steps,
see *Combining steps* in [Expressions](04-expressions.md#combining-steps). A step with no input — the
first one, usually — is a **source**: it makes a table from nothing.

## Shape: the verb in square brackets

The part in square brackets is the step's **modifiers**. The main one is the
**shape verb**: it says what shape the output has, while the tool decides the
values.

| verb | rows in → rows out | the tool is… |
|---|---|---|
| `mod.source()` | nothing → a table | something that builds a table |
| `mod.map()` | n → n: one column of answers | called once per row |
| `mod.filter()` | n → fewer | a yes/no test per row |
| `mod.expand()` | n → more | given a row, returns a list |
| `mod.collapse()` | n → 1 (or 1 per group) | something that combines rows |
| `mod.group()` | n → n, plus a key column | gives each row a group key |
| `mod.table()` | table → table | given the whole table |

`mod.name("total")` after the verb names the answer column; without it, the
column takes the step's name. A `map` step holds only its answers; `zip_`
puts them beside the table they came from.

Some verbs need no tool at all — `select`, `drop`, `rename`, `sort`,
`slice`, `distinct` — and use the built-in `identity`. Leave the brackets
off and Simple Steps picks the verb from the tool. A yes/no tool still
gets `map` (a column of True and False): write `mod.filter()` to keep rows.

A step has **one** shape verb. To filter and then map, make two steps, the
second reading the first. A few other modifiers — `retry`, `timeout`,
`try_except` — change *how* the tool runs rather than the shape, so they can
sit alongside any verb.

## Columns by name

A per-row tool's inputs are filled **from columns of the same name**. A tool
with an input called `price`, run over a table with a `price` column, gets
each row's price. An input with no matching column comes from the formula
(`rate=0.1`) or its default.

## Resource

Something tools *use* that isn't data — a database connection, a language
model, a folder of images. A resource is set up once per workflow and named;
a step uses it as `res["name"]`. The **Environment** and **Resources** menus
list the ones you have and the kinds you can add.

## App and workspace

The **app** is what you were given: a set of tools and resources, started
with `simple-steps run app.py`. The folder it runs in is the **workspace**;
its `projects/` folder holds your workflows.

---

Next: [use the app](02-use-the-app.md).
