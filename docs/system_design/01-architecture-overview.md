# Architecture Overview

## System Summary

Simple Steps is a visual pipeline orchestrator that lets non-technical users build and run multi-step data pipelines backed by plain Python functions. It bridges the gap between spreadsheet-familiar domain experts and Python-powered data operations.

The mental model: **a spreadsheet where every column is a pipeline step, every row is a piece of data flowing through it, and every cell formula is a Python function call.**

## High-Level Architecture

```
┌─────────────────────────────────────────┐      HTTP/REST       ┌──────────────────────────────────────┐
│         React Frontend (Vite + TS)       │ ◄──────────────────► │      FastAPI Backend (Python)        │
│                                          │                      │                                      │
│  ┌──────────────────────────────────┐   │                      │  ┌──────────────────────────────┐   │
│  │  Formula Bar (source of truth)    │   │    POST /api/run     │  │  Operation Registry           │   │
│  │  ┌──────────────────────────┐    │   │  ─────────────────►  │  │  (OPERATION_REGISTRY dict)    │   │
│  │  │ =op.map(url=step1.url)  │    │   │                      │  └──────────────────────────────┘   │
│  │  └──────────────────────────┘    │   │                      │                                      │
│  └──────────────────────────────────┘   │    GET /api/data/:ref │  ┌──────────────────────────────┐   │
│                                          │  ◄─────────────────── │  │  Orchestration Engine          │   │
│  ┌──────────────────────────────────┐   │                      │  │  (engine.py + orchestrators)   │   │
│  │  Step Canvas (arrow icons)        │   │                      │  └──────────────────────────────┘   │
│  │  Data Grid (Glide Data Grid)      │   │  GET /api/operations │                                      │
│  │  Parameter Panel (Details tab)    │   │  ◄─────────────────── │  ┌──────────────────────────────┐   │
│  │  Execution Log                    │   │                      │  │  Plugin Auto-Scanner           │   │
│  └──────────────────────────────────┘   │                      │  │  (pack_loader.py)              │   │
│                                          │                      │  └──────────────────────────────┘   │
│  ┌──────────────────────────────────┐   │  POST /api/projects  │                                      │
│  │  useWorkflow (state management)   │   │  ←────────────────── │  ┌──────────────────────────────┐   │
│  └──────────────────────────────────┘   │                      │  │  File Manager                  │   │
│                                          │                      │  │  (projects/ JSON persistence)  │   │
└─────────────────────────────────────────┘                      └──────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React + TypeScript | 18.3.1 / ~5.9.3 |
| Build | Vite | 7.2.4 |
| Test (FE) | Vitest | 4.0.17 |
| Data Grid | Glide Data Grid | — |
| Icons | Lucide React | — |
| Backend | FastAPI + Pydantic v2 | ≥0.109 / ≥2.6 |
| Runtime | Python | 3.9+ |
| Data | pandas + NumPy | ≥2.2 / ≥1.26 |
| Server | uvicorn | ≥0.27 |
| Test (BE) | pytest | ≥8.0 |
| Agent (optional) | LangGraph + LangChain | ≥0.2 |
| Desktop (optional) | pywebview | ≥5.0 |

## Core Design Principles

### 1. Formula as Source of Truth

The formula bar string (e.g. `=extract_metadata.map(url=step1.url)`) is the **single canonical representation** of what a step does. Everything else — the operation ID, parameter values, orchestration mode, UI state — is derived from it.

This means:
- The formula string is what gets persisted to disk.
- The UI controls (dropdowns, text inputs) just edit the formula.
- On load, `process_type` and `configuration` are re-derived from the formula via `parseFormula()`.

### 2. Reference Passing (Not Data Shipping)

The backend never sends full DataFrames over HTTP. Instead:
1. A step executes and produces a DataFrame.
2. The DataFrame is stored in an in-memory `DATA_STORE` keyed by a UUID reference ID.
3. Only the reference ID is returned to the frontend.
4. The frontend fetches paginated slices via `GET /api/data/:ref_id`.

This keeps API payloads small and avoids serializing large datasets.

### 3. Operations Are Plain Python Functions

Every operation in Simple Steps is a regular Python function registered via `@simple_step` or `register_operation()`. No base classes, no framework-specific signatures. The decorator inspects type hints to infer UI parameter types and stores metadata in a global registry.

### 4. Three-Tier Plugin Discovery

Operations come from three sources, loaded in priority order:
1. **System ops** — built-in, always present (e.g. `ss_map`, `ss_filter`)
2. **Developer packs** — reusable libraries in `packs/`, git repos, or pip packages
3. **Project ops** — per-project custom functions in `projects/<name>/**/*.py`

All three tiers share the same `OPERATION_REGISTRY` and the same decorator.

### 5. Linear Pipeline Model

Workflows are modeled as a **linear sequence of steps** (not a DAG). Each step can reference the output of any previous step via step references like `step1.url` or `step-abc.col`. This keeps the UI intuitive for non-technical users while still supporting data wiring.

## Key Boundaries

The system has three critical boundaries that must stay in alignment:

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│ Python Script │ ←──→ │  Backend Engine   │ ←──→ │ Frontend Formula │
│ (function call)│      │  (run_operation)  │       │ (formula bar)    │
└──────────────┘       └──────────────────┘       └─────────────────┘
```

1. **Python ↔ Engine**: The same function call you'd write in a `.py` script (`fn(url="https://...")`) must produce the same result when run through `run_operation()` with the equivalent config dict.

2. **Engine ↔ Formula**: The config dict the engine receives must be exactly what `parseFormula()` extracts from the formula string.

3. **Formula ↔ Python**: The formula bar syntax (`=op.map(url=step1.url)`) is intentionally identical to Python function call syntax so it could be `eval()`'d or exported as a Python script.

## Repository Layout

```
Simple_Steps/
├── src/SIMPLE_STEPS/        # Core Python package (pip-installable)
│   ├── main.py              # FastAPI app, plugin scanner, SPA serving
│   ├── engine.py            # Orchestration engine + DATA_STORE
│   ├── decorators.py        # @simple_step + register_operation
│   ├── orchestrators.py     # Wrapper functions (source, map, filter, expand, dataframe, raw_output)
│   ├── orchestration_ops.py # Built-in ss_map, ss_filter, ss_expand, ss_reduce
│   ├── models.py            # Pydantic models + formula builder
│   ├── operation_pack.py    # OperationPack failsafe bundle
│   ├── pack_loader.py       # Three-tier discovery engine
│   ├── pack_manager.py      # Pack manifest (simple_steps.toml) management
│   ├── file_manager.py      # Workflow JSON persistence
│   ├── cli.py               # `simple-steps` CLI entry point
│   ├── cli_local.py         # `simple-steps-local` desktop mode
│   ├── cli_pack.py          # `simple-steps pack` subcommand
│   ├── build_frontend.py    # `simple-steps-build` helper
│   ├── agent/               # LangGraph chat agent (optional)
│   └── frontend_dist/       # Bundled production frontend
├── frontend/src/            # React + TypeScript source
│   ├── components/          # UI components (OperationColumn, StepToolbar, etc.)
│   ├── hooks/               # useWorkflow (central state), useStagedPreview
│   ├── services/            # api.ts (REST client)
│   ├── context/             # StepWiringContext (cell reference wiring)
│   ├── types/               # TypeScript type definitions
│   └── utils/               # formulaParser.ts (parse/build formulas)
├── packs/                   # Developer operation packs (Tier 2)
├── projects/                # Saved workflow JSON files
├── tests/                   # pytest test suite
└── pyproject.toml           # Package config + dependencies
```

## Deployment Modes

| Mode | Command | Description |
|---|---|---|
| **Single process** | `simple-steps` | Backend serves both API and bundled frontend on one port |
| **Dev mode** | `simple-steps --dev` + `cd frontend && npm run dev` | Backend on :8000, Vite dev server on :5173 with proxy |
| **Desktop** | `simple-steps --local` | Native window via pywebview, backend in background thread |
