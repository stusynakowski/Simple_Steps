# System Design Documentation

Developer documentation describing the internal architecture and design of Simple Steps.

These documents are intended for contributors, maintainers, and anyone building on top of the platform. They explain *how* the system works, *why* key decisions were made, and *where* the important boundaries live.

## Current (on simple-steps-core)

Start here. These describe the system as built on `simple-steps-core`
(2026-10-23, core `86170a3`).

| Document | Description |
|---|---|
| [Object Model](./10-object-model.md) | Every object, core's and the app's — workflow, step, operation, output, kernel, cell — and how formula text becomes a grid |
| [Data Flow & Storage](./11-data-flow-and-storage.md) | Where data lives and how it moves between server and browser: today, what's wrong with it, and the Jupyter-shaped target |
| [Core and App](./12-core-and-app.md) | What `simple-steps-core` owns and what this repo owns, the rules at the line, and how a change crosses it |

## Earlier documents

The pre-core design docs (01–08: architecture, formula system, orchestration
engine, operation registration, frontend, API contract, persistence) are in
[`../archive/system_design/`](../archive/system_design/). They describe the
retired syntax and engine; read them for history only.

## Reading Order

If you're new to the codebase, read the **Object Model**, then **Core and App**, then **Data Flow & Storage**.
