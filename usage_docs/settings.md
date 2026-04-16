# Settings & Configuration

Simple Steps has runtime settings you can toggle while the app is running, plus workspace-level configuration files.

---

## Runtime Settings

Access settings via the **⚙️ icon** in the Activity Bar, or via the API.

### Eval Mode

| Setting | Default | What It Does |
|---|---|---|
| `eval_mode` | `false` | When on, the formula bar accepts arbitrary Python code |

**How to enable:**

- **API:** `POST /api/settings` with `{"eval_mode": true}`
- **Python:** The setting is toggled programmatically

When eval mode is on, if a formula references an operation that isn't in the registry, the engine falls back to executing it as raw Python via `eval()` / `exec()`. This gives you full Python power in the formula bar.

---

## Workspace Configuration

### `simple_steps.toml`

This file (at your workspace root) declares external pack dependencies:

```toml
[packs]

[packs.youtube-analysis]
source = "git"
url = "https://github.com/org/ss-youtube-pack.git"
ref = "main"
path = ".packs/ss-youtube-pack"

[packs.shared-analytics]
source = "local"
path = "../team-shared/analytics"

[packs.nlp-pack]
source = "pip"
package = "simple-steps-nlp-pack"
```

Run `simple-steps pack install` to sync all declared packs.

### Environment Variables

| Variable | Default | What It Controls |
|---|---|---|
| `SIMPLE_STEPS_WORKSPACE` | Current directory (`cwd`) | The workspace root |
| `SIMPLE_STEPS_PROJECTS_DIR` | `<workspace>/projects` | Where project folders live |
| `SIMPLE_STEPS_EXTRA_OPS` | (none) | Extra operation directories (`;`-separated) |

---

## Launching

### Browser Mode (default)

```bash
cd ~/my-data-project
# Start backend:
uvicorn SIMPLE_STEPS.main:app --reload
# Start frontend (separate terminal):
cd frontend && npm run dev
```

### Desktop Mode (native window)

```bash
pip install simple-steps[desktop]
cd ~/my-data-project
simple-steps-local
```

### CLI Flags

| Flag | What It Does |
|---|---|
| `--workspace <path>` | Set workspace root (default: cwd) |
| `--port <n>` | Backend port (default: 8000, auto-finds free port) |
| `--packs <path>` | Additional pack directories to scan |
| `--projects-dir <path>` | Override projects directory |
| `--width`, `--height` | Window size (desktop mode) |
