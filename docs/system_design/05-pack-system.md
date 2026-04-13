# Pack System

The pack system is Simple Steps' plugin architecture. It provides three tiers of operation discovery, a failsafe bundling system, and a manifest-based pack manager.

## Three-Tier Discovery

**File:** `src/SIMPLE_STEPS/pack_loader.py`

```
Tier 1 — System Ops          (always loaded, ships with the package)
Tier 2 — Developer Packs     (opt-in, reusable across projects)
Tier 3 — Project Ops         (per-project, auto-discovered)
```

### Tier 1: System Ops

Built-in operations that ship with the `simple_steps` package:
- `src/SIMPLE_STEPS/operations.py` — default operations
- `src/SIMPLE_STEPS/orchestration_ops.py` — `ss_map`, `ss_filter`, `ss_expand`, `ss_reduce`

These are imported directly by `main.py` at startup. No user configuration needed.

### Tier 2: Developer Packs

Domain-specific function libraries created by developers. Discovered from multiple sources (in order):

1. **Workspace `packs/` directory** — `<workspace>/packs/`
2. **Workspace `ops/` directory** — `<workspace>/ops/`
3. **Workspace root `.py` files** — top-level scripts with `@simple_step`
4. **Bundled repo packs** — `<repo>/packs/`
5. **Legacy sibling directories** — `youtube_operations/`, `llm_operations/`, etc.
6. **Mock operations** — `mock_operations/` (dev only)
7. **CLI `--packs`/`--ops` flags** and `SIMPLE_STEPS_PACKS_DIR`/`SIMPLE_STEPS_EXTRA_OPS` env vars
8. **Manifest packs** — declared in `simple_steps.toml`

```
packs/
├── youtube/
│   ├── youtube_ops.py        # @simple_step decorated functions
│   └── analysis_ops.py
└── webscraping/
    └── scraper_ops.py
```

### Tier 3: Project Ops

Custom functions that live inside a project directory alongside pipeline JSON files:

```
projects/
└── my-youtube-analysis/
    ├── pipeline-1.json
    └── ops/
        ├── custom_scoring.py     # @simple_step functions, auto-registered
        └── helpers.py
```

When a project is opened, its `.py` files are scanned and decorated functions are registered. Project ops can be loaded on-demand via `POST /api/projects/{project_id}/load-ops`.

### PackLoader

The `PackLoader` class manages the discovery lifecycle:

```python
loader = PackLoader(
    developer_pack_dirs=["./packs", "/shared/team-packs"],
    project_dirs=["./projects/my-project"],
)
loader.load_all()       # Scans all tiers
loader.summary()        # Human-readable audit trail
loader.get_ops_by_tier()  # { "system": [...], "developer_pack": [...], "project": [...] }
```

Each file import is recorded as a `LoadResult`:

```python
@dataclass
class LoadResult:
    file_path: str
    tier: OpTier           # system | developer_pack | project
    success: bool
    module_name: str
    ops_registered: List[str]  # operation IDs registered by this file
    error: Optional[str]
```

### Import Mechanism

For Tier 2 and 3, `PackLoader` uses `importlib.util.spec_from_file_location()` to dynamically import Python files. Each file gets a unique module name to avoid collisions. The module is executed, and any `@simple_step` decorators that fire during import automatically register into `OPERATION_REGISTRY`.

Files are eligible for scanning if they:
- End in `.py`
- Don't start with `__`
- Are not in `__pycache__` directories
- Contain `simple_step`, `register_operation`, or `pack.step` (detected via string scan)

### pip-Installed Packs (Entry Points)

Packs published as pip packages can advertise themselves via the `simple_steps.packs` entry point group. The loader discovers them using `importlib.metadata.entry_points()`.

## OperationPack: Failsafe Bundles

**File:** `src/SIMPLE_STEPS/operation_pack.py`

An `OperationPack` wraps a set of related operations with:
- **Dependency validation** — checks for required Python packages before registering
- **Environment checks** — verifies required env vars (API keys, etc.)
- **Health checks** — custom callables that verify external services
- **Graceful degradation** — if validation fails, ops are marked unavailable, not crashed

### Lifecycle

```
1. Instantiate    pack = OperationPack(name="YouTube", required_packages=["google-api-python-client"])
2. Decorate       @pack.step(id="yt_fetch", ...)  def fetch(): ...
3. Register       pack.register()  ← validates deps, registers ops, returns HealthStatus
```

### Deferred Registration

The `@pack.step` decorator does NOT immediately register the function. Instead, it queues a `_DeferredStep` descriptor. Only when `pack.register()` is called does validation happen and functions get registered (or marked unavailable).

### Health Status

```python
@dataclass
class HealthStatus:
    ok: bool
    checks: Dict[str, bool]     # { "google-api-python-client": True, "YOUTUBE_API_KEY": False }
    errors: List[str]           # ["Missing env var: YOUTUBE_API_KEY"]
```

The API exposes pack health via `GET /api/packs`, allowing the frontend to show which packs are healthy and which have issues.

### PACK_REGISTRY

All registered packs are stored in a global `PACK_REGISTRY: Dict[str, OperationPack]`, separate from the per-operation `OPERATION_REGISTRY`. This allows querying pack-level metadata and health.

## Pack Manager

**File:** `src/SIMPLE_STEPS/pack_manager.py`

The pack manager handles the workspace-level pack manifest (`simple_steps.toml`).

### Manifest Format

```toml
[packs]

[packs.youtube]
source = "git"
url = "https://github.com/org/ss-youtube-pack.git"
ref = "main"
path = ".packs/ss-youtube-pack"

[packs.my-local-pack]
source = "local"
path = "../shared-packs/my-local-pack"

[packs.some-pip-pack]
source = "pip"
package = "simple-steps-some-pack"
```

### Pack Sources

| Source | How it Works |
|---|---|
| `git` | Cloned to `.packs/` directory. `ref` specifies branch/tag. |
| `local` | Symlinked or directly referenced by filesystem path. |
| `pip` | Installed via `pip install`. Discovered via entry points. |

### CLI Commands

```bash
simple-steps pack list                     # List declared packs
simple-steps pack add <git-url>            # Add git pack
simple-steps pack add <local-path>         # Add local pack
simple-steps pack add <package> --pip      # Add pip pack
simple-steps pack create <name>            # Scaffold new local pack
simple-steps pack create <name> --pip      # Scaffold pip-installable pack
simple-steps pack remove <name>            # Remove from manifest
simple-steps pack install                  # Install/sync all packs
```

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/packs` | GET | List all manifest packs with health status |
| `/api/packs` | POST | Add a pack (git/local/pip) |
| `/api/packs/{name}` | DELETE | Remove a pack |
| `/api/packs/install` | POST | Install/sync all packs |
| `/api/loader` | GET | Full three-tier loader state |
| `/api/developer-packs` | GET | Developer pack directories with ops |

## Pack Template

**Directory:** `pack_template/`

The `simple-steps pack create` command scaffolds new packs from this template:

```
my-pack/
├── pyproject.toml      # Package metadata (for pip packs)
├── README.md
└── src/
    └── my_pack/
        └── __init__.py  # @simple_step decorated functions
```

The template includes the `simple_steps.packs` entry point configuration so pip-installed packs are automatically discovered.
