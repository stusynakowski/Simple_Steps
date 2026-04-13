# Desktop Mode (No Browser)

Simple Steps can run as a **native desktop window** instead of opening in a browser. The UI is pixel-for-pixel identical — it's the same React frontend, just rendered inside a native OS window powered by [pywebview](https://pywebview.flowrl.com/).

This is ideal for:
- **Demos and workshops** — no "open your browser" step
- **Non-technical users** — feels like a native app
- **Kiosk / single-purpose setups** — one window, no browser tabs
- **Working offline** — everything runs locally, no external requests

---

## Quick Start

### 1. Install

```bash
pip install -e ".[desktop]"
```

Or add `pywebview` to an existing install:

```bash
pip install pywebview
```

### 2. Launch

From whatever directory you want as your workspace:

```bash
cd ~/my-data-project
simple-steps-local
```

Or use the `--local` flag on the main CLI:

```bash
simple-steps --local
```

A native window opens. The current working directory becomes the workspace root — all `projects/`, `packs/`, `ops/`, and top-level `.py` files are discovered from there, just like the browser version.

---

## Commands

There are two equivalent ways to launch desktop mode:

| Command | Description |
|---|---|
| `simple-steps-local` | Dedicated desktop CLI entry point |
| `simple-steps --local` | Convenience flag on the main CLI (delegates to the same code) |

Both accept the same flags.

---

## Flags

### Desktop-specific flags

| Flag | Description | Default |
|---|---|---|
| `--width PX` | Window width in pixels | `1280` |
| `--height PX` | Window height in pixels | `860` |
| `--title TEXT` | Custom window title | `Simple Steps — <folder name>` |
| `--debug` | Enable web developer tools inside the window (right-click → Inspect) | off |

### Shared flags (same as browser mode)

| Flag | Description | Default |
|---|---|---|
| `--port PORT` | Backend API port (auto-picks a free port if busy) | `8000` |
| `--host HOST` | Backend bind address | `127.0.0.1` |
| `--workspace DIR` | Workspace root directory | current working directory |
| `--ops DIR [DIR ...]` | Extra directories to scan for `*_ops.py` plugins | none |
| `--packs DIR [DIR ...]` | Extra developer pack directories | none |
| `--projects-dir DIR` | Directory for saved workflows | `<workspace>/projects` |

---

## Examples

```bash
# Basic — open from current directory
simple-steps-local

# Custom window size for a large monitor
simple-steps-local --width 1920 --height 1080

# Specify a workspace root explicitly
simple-steps-local --workspace ~/team-shared-repo

# Custom title for a workshop
simple-steps-local --title "Data Pipeline Workshop" --width 1400

# With extra packs
simple-steps-local --packs ./youtube_pack ./llm_pack

# Enable right-click → Inspect for debugging
simple-steps-local --debug

# Use a specific port
simple-steps-local --port 9000

# Via the main CLI shortcut
simple-steps --local --workspace ~/my-project
```

---

## How It Works

When you run `simple-steps-local`, the following happens:

```
1. Parse CLI flags
2. Set SIMPLE_STEPS_WORKSPACE = <cwd or --workspace>
3. Find a free port (default: 8000, auto-picks if busy)
4. Start FastAPI/uvicorn in a background daemon thread
5. Wait for the server to accept connections (up to 15s)
6. Open a native pywebview window pointing at http://127.0.0.1:<port>
7. Block until the window is closed
8. Exit the process (daemon thread auto-terminates)
```

The backend is identical to the browser version — same FastAPI app, same engine, same pack loader. The only difference is the frontend is displayed in a native window instead of a browser tab.

---

## Platform Notes

### macOS
- Uses **WebKit** (built-in). No extra system dependencies needed.
- The window appears as a native Cocoa app.

### Windows
- Uses **EdgeChromium** (Edge WebView2) if available, otherwise falls back to **MSHTML**.
- Edge WebView2 is pre-installed on Windows 10 21H2+ and Windows 11.

### Linux
- Uses **GTK + WebKit2**. Install system dependencies:
  ```bash
  # Debian/Ubuntu
  sudo apt install python3-gi gir1.2-webkit2-4.0

  # Fedora
  sudo dnf install python3-gobject webkit2gtk3
  ```

---

## Comparison: Browser vs. Desktop

| Aspect | `simple-steps` (Browser) | `simple-steps-local` (Desktop) |
|---|---|---|
| UI | Identical | Identical |
| Opens in | Default browser | Native OS window |
| Backend | uvicorn (foreground) | uvicorn (background thread) |
| Port auto-detect | No (fails if busy) | Yes (auto-picks free port) |
| Exit behavior | Ctrl+C in terminal | Close the window |
| Dev tools | Browser DevTools (F12) | `--debug` flag enables Inspect |
| Extra dependency | None | `pywebview` |
| Best for | Development, remote access | Demos, workshops, end users |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `simple-steps-local: command not found` | Install with `pip install -e ".[desktop]"`, then make sure your virtualenv is active |
| `❌ pywebview is not installed` | Run `pip install pywebview` or `pip install simple-steps[desktop]` |
| Window is blank / white | The backend may still be starting. Wait a few seconds and refresh (Cmd+R / Ctrl+R in the window) |
| Window won't open on Linux | Install WebKit2 GTK: `sudo apt install python3-gi gir1.2-webkit2-4.0` |
| `❌ Backend did not start within 15 seconds` | Check for import errors in your packs/ops. Run `simple-steps --no-browser` first to see full error output |
| Port conflict | Desktop mode auto-picks a free port, but you can force one with `--port` |
| Can't right-click → Inspect | Launch with `--debug`: `simple-steps-local --debug` |
| Window title shows wrong directory | Use `--workspace` to set explicitly, or `cd` into the right directory before launching |

---

## Environment Variables

The same environment variables work in desktop mode:

| Variable | Description |
|---|---|
| `SIMPLE_STEPS_WORKSPACE` | Workspace root (alternative to `--workspace`) |
| `SIMPLE_STEPS_EXTRA_OPS` | Semicolon-separated extra plugin directories |
| `SIMPLE_STEPS_PACKS_DIR` | Semicolon-separated extra pack directories |
| `SIMPLE_STEPS_PROJECTS_DIR` | Override project storage directory |
