# System Design Documentation

Developer documentation describing the internal architecture and design of Simple Steps.

These documents are intended for contributors, maintainers, and anyone building on top of the platform. They explain *how* the system works, *why* key decisions were made, and *where* the important boundaries live.

## Documents

| Document | Description |
|---|---|
| [Architecture Overview](./01-architecture-overview.md) | High-level system architecture, component map, and data flow |
| [Formula System](./02-formula-system.md) | The formula bar as the single source of truth — parsing, building, quoting rules, and bidirectional sync |
| [Orchestration Engine](./03-orchestration-engine.md) | How the backend executes operations — wrappers, reference passing, and the DATA_STORE |
| [Operation Registration](./04-operation-registration.md) | `@simple_step` decorator, `register_operation()`, registry structure, and parameter inference |
| [Pack System](./05-pack-system.md) | Three-tier discovery, OperationPack bundles, pack manager, and `simple_steps.toml` manifest |
| [Frontend Architecture](./06-frontend-architecture.md) | React component tree, state management via `useWorkflow`, and the wiring context |
| [Data Flow & API Contract](./07-data-flow-api-contract.md) | REST API endpoints, request/response shapes, reference-passing pattern, and the step map |
| [Pipeline Persistence](./08-pipeline-persistence.md) | Save/load lifecycle, `PipelineFile` model, hydration logic, and backward compatibility |

## Reading Order

If you're new to the codebase, start with the **Architecture Overview**, then read the **Formula System** (the conceptual core), then the **Orchestration Engine** (the execution core). The remaining documents can be read in any order based on what you're working on.
