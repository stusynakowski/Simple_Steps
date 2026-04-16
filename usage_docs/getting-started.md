# Getting Started with Simple Steps

Simple Steps is an interactive data pipeline builder. Think of it as a **spreadsheet meets Python** — you build workflows visually, but every step is backed by real Python functions.

---

## What You See When You Open the App

The interface has four main areas:

| Area | Where | What It Does |
|---|---|---|
| **Activity Bar** | Far left icons | Switch between Explorer, Search, Docs, Packs, Settings |
| **Sidebar** | Left panel | Browse your workspace files, projects, docs, and operation packs |
| **Workflow Area** | Center | Your pipeline — a left-to-right chain of steps |
| **Formula Bar** | Top of each step | Shows (and lets you edit) the formula that defines what the step does |

---

## Core Concepts

### Steps
A **step** is one stage in your pipeline. Each step takes data from the previous step, runs an operation, and produces output. Steps are displayed as columns of data — click one to see its results.

### Formulas
Every step has a **formula** — a text expression that defines what it does. Formulas look like function calls:

```
=load_csv(path="data.csv")
=extract_metadata(url=step1.url)
=filter_rows(column="views", min_value=1000)
```

The formula is the **source of truth**. When you pick an operation from the sidebar or type in the formula bar, you're writing (or editing) this formula.

### Operations
Operations are the Python functions available to your formulas. They come from three places:

1. **System ops** — Built-in operations (Load CSV, Filter Rows, etc.)
2. **Developer packs** — Functions in your `packs/` directory or imported via `simple_steps.toml`
3. **Project ops** — Python files inside a specific project folder

### Projects & Pipelines
- A **project** is a folder inside `projects/` in your workspace
- A **pipeline** is a saved workflow (stored as a `.json` file inside a project)
- You can have multiple pipelines per project

---

## Your First Workflow

1. **Click +** on a step to add it to the workflow
2. **Pick an operation** from the sidebar (or type a formula)
3. **Configure parameters** — fill in the fields the operation needs
4. **Run the step** — click the play button to execute
5. **Add more steps** — each one feeds from the previous step's output
6. **Save** — click the 💾 icon on a project folder in the Explorer

---

## The Workspace

When you launch Simple Steps, the **current directory becomes your workspace**. The Explorer sidebar shows all the files in that directory — just like an IDE. The app automatically discovers:

| Path | What It Is |
|---|---|
| `projects/` | Your saved project folders and pipeline JSON files |
| `packs/` | Developer operation packs (Python files with `@simple_step` functions) |
| `ops/` | Additional custom operations |
| `*.py` | Top-level Python files with operations |
| `simple_steps.toml` | Manifest declaring external pack dependencies |

You can launch from any directory:

```bash
cd ~/my-data-project
simple-steps-local
```

Everything is relative to where you launch.
