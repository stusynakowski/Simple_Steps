# 200 — Shell Infrastructure Dev Plan ("Jupyter‑on‑VS‑Code" for Simple Steps)

**Status:** Draft
**Owner:** Stuart
**Audience:** Contributors implementing the app shell around the workflow canvas

---

## 0. Deployment Model

**Now (M0 — local single‑user):** the app runs on the user's machine. `simple-steps` boots a FastAPI backend on `localhost`, opens a browser tab pointed at it. The Python environment is whatever installed `simple-steps`. One user, one workspace, one kernel — the same posture as opening a `.ipynb` inside VS Code locally. **This is the only deployment mode we build for in this plan.**

**Later (M1 — hosted multi‑user, out of scope for this plan):** the same backend runs on a shared server with its own compute; users connect via a browser; each user gets an isolated workspace + kernel process; auth/sessions/quotas appear. We are *not* implementing this — but we keep the door open by following four rules:

1. **All state lives on the backend.** No browser‑local storage of pipeline content. `localStorage` is allowed only for cosmetic UI prefs (sidebar widths, last‑opened tab). This is already the case and must stay that way.
2. **Every backend endpoint takes its workspace from a header / query param**, not from a global. Today that param defaults to the single process‑wide workspace; tomorrow it gets resolved per‑request from an auth context. Concretely: prefer `GET /api/files/tree?workspace=<id>&path=...` over a singleton `WORKSPACE_ROOT`. The singleton stays as the default, but the parameter is plumbed through now.
3. **No filesystem paths in API responses that the browser interprets.** Return opaque IDs (`pipeline_id`, `project_id`, `file_id`) and a separate `display_path` string. The frontend never constructs an absolute path. (Today some endpoints leak `/Users/...` paths — clean these up as we touch them.)
4. **The "kernel" is addressable.** Even though M0 has exactly one in‑process kernel, every `/api/run`, `/api/kernel/*`, `/api/data/:ref_id` call passes through a `kernel_id` (default `"local"`). M1 will swap the resolver to pick a per‑user kernel; nothing else changes.

These four rules cost ~zero effort now and save a rewrite later. They're called out again inside the relevant phases below.

**What this means concretely for the rest of this plan:**

- Auth, RBAC, sessions, quotas, sandboxing, kernel spawning, per‑user filesystems → **out of scope**. Don't build placeholders.
- Workspace = the local folder the user launched `simple-steps` from. Singular.
- Kernel = the FastAPI process. Singular. Restart = clear in‑process caches; *not* kill‑and‑respawn.
- The browser is treated as a thin client to `localhost` — exactly as if VS Code's webview were pointed at a local extension host.

---

## 1. Mental Model

Simple Steps **is** a notebook — but instead of a vertical list of Python cells, the user sees a **spreadsheet‑style horizontal canvas of "steps"** (each step is one Python expression / cell, written as a `=formula`).

Everything *around* the canvas should look and feel like a Jupyter notebook opened inside VS Code:

| VS Code / Jupyter concept                | Simple Steps equivalent                                            | Status |
|------------------------------------------|--------------------------------------------------------------------|--------|
| Workspace folder                         | `SIMPLE_STEPS_WORKSPACE` (cwd where `simple-steps` was launched)  | ✅ exists (`file_manager.py`) |
| Explorer / file tree                     | `FileTree.tsx` in `ActivityBar`                                    | ✅ partial |
| `.ipynb` document                        | `PipelineFile` JSON in `projects/<project>/<pipeline>.json`        | ✅ |
| Notebook tabs                            | `WorkflowTabs.tsx`                                                 | ✅ |
| Cell                                     | `StepConfig` rendered as `OperationColumn` / `StepIcon`            | ✅ |
| Cell formula / source                    | `step.formula` (`=op.orchestrator(args)`)                          | ✅ |
| Kernel                                   | Python interpreter running the FastAPI backend + registered packs  | ⚠️ implicit |
| Kernel picker (top‑right of notebook)    | **Missing** — no UI to select / inspect the active Python env      | ❌ |
| Run cell / Run all                       | `runStep` / `runPipeline` in `useWorkflow`                         | ✅ |
| Restart kernel / Clear outputs           | **Missing** — no way to reset session state without reloading      | ❌ |
| Variable explorer                        | Step output grids (`DataOutputGrid`)                               | ✅ per‑step only |
| Command palette (`⌘⇧P`)                  | **Missing**                                                        | ❌ |
| Status bar (bottom)                      | **Missing**                                                        | ❌ |
| Outline view                             | `WorkflowSequence` (horizontal step strip)                         | ✅ |
| Chat / Copilot side panel                | `ChatSidebar` + `AgentWidget`                                      | ✅ partial |
| Extensions / packs                       | `packs/` directory + plugin auto‑scanner                           | ✅ backend / ❌ UI |
| Settings UI                              | **Missing** (only env vars today)                                  | ❌ |
| Save / Save As / Recent files            | `SaveModal` + `MenuBar`                                            | ✅ partial |

The columns flagged ❌ / ⚠️ are the gap this plan closes.

---

## 2. Design Principles

1. **The canvas is sacred.** Everything in this plan is *chrome around* `MainLayout`'s center pane. Don't change step / formula semantics.
2. **Mirror VS Code layout exactly.** Activity bar (left rail) → Side panel → Editor area → Right panel → Status bar (bottom). Users already know this layout.
3. **Backend owns truth, frontend mirrors it.** File system, environment info, kernel state — all expose REST endpoints; the UI is a thin reflector. (Same rule that already governs formulas.)
4. **No hidden state.** A user must always be able to answer: *Which project? Which pipeline? Which Python env? Which pack versions? What's running right now?* — by glancing at the chrome.
5. **Every command has a keyboard shortcut and a command‑palette entry.** Build the palette early; register commands into it from each feature.

---

## 3. Target Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MenuBar     File  Edit  View  Run  Pack  Help                               │ ← exists
├──┬───────────────┬─────────────────────────────────────────┬─────────────┬──┤
│  │               │  WorkflowTabs:  [pipeline-a.json ×] [+] │             │  │
│A │               ├─────────────────────────────────────────┤             │  │
│c │  Side panel:  │  UnifiedToolbar  ▶ Run  ❚❚ Pause  ■ Stop│  Chat /     │  │
│t │   • Explorer  │  Kernel: ⬤ Python 3.11 (.venv)         │  Agent      │  │
│i │   • Packs     ├─────────────────────────────────────────┤  sidebar    │  │
│v │   • Search    │                                         │             │  │
│i │   • Run hist. │      WorkflowSequence  (step icons)     │             │  │
│t │   • Settings  │                                         │             │  │
│y │               │      OperationColumn(s) / Data grids    │             │  │
│  │               │                                         │             │  │
├──┴───────────────┴─────────────────────────────────────────┴─────────────┴──┤
│ StatusBar:  ⬤ Python 3.11  •  proj: yt‑analysis  •  3/5 steps ✓  •  saved │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Foundation: Adopt Off‑the‑Shelf Primitives (not a Jupyter fork)

Before writing any new chrome, we swap our hand‑rolled pieces for the same primitives VS Code / JupyterLab / Linear / Raycast already use. **We are not forking JupyterLab** — that would force our app into the Lumino widget model and the ZMQ‑kernel protocol, neither of which fit our React + FastAPI + formula‑step architecture. Instead we pull in only the standalone packages that work inside any React app.

### 4.1 What we import and why

| Library | npm package | What it gives us | Where it replaces our code |
|---|---|---|---|
| **Monaco Editor** | `@monaco-editor/react` | *The* VS Code editor as a React component. Syntax highlighting, autocomplete, hover tooltips, signature help, diff view, themes — all the editor UX users already know. | The formula bar in `StepToolbar.tsx` and the `WorkspaceFileEditor.tsx`. We register a custom "simple‑steps formula" language for our `=op.orchestrator(args)` grammar. |
| **Lumino Commands** | `@lumino/commands` | A typed command registry + keybinding dispatcher. This is the exact module JupyterLab uses for `⌘⇧P`. ~200 KB, no Jupyter runtime dependencies. | Phase C1 / C4 (`services/commands.ts`, `useKeybindings`). We wrap it; our code reads as `registerCommand({...})`. |
| **cmdk** | `cmdk` | Headless command‑palette UI (the library Vercel, Linear, Raycast use). Fuzzy search, keyboard nav, grouping — we style it to match VS Code. | Phase C3 (`CommandPalette.tsx`). Also reusable for the Phase E4 search panel. |
| **Allotment** | `allotment` | Resizable split panes with VS Code‑identical drag behavior, persisted sizes, collapse handles. Extracted from VS Code's own splitter code. | The hand‑rolled resize logic in `MainLayout.tsx` (`isResizingSidebar`, `isResizingRightSidebar`, `isResizingHeader` — all deleted). |
| **react‑arborist** | `react-arborist` | Virtualized tree view with keyboard nav, drag‑drop, inline rename, multi‑select. | The internals of `FileTree.tsx`. We keep our `FileEntry` shape and `/api/files/tree` backend; only the rendering swaps. |
| **VS Code Codicons** | `@vscode/codicons` | Microsoft's official VS Code icon font (MIT). 500+ icons, pixel‑identical to the editor. | Replaces Lucide icons globally. This is the single biggest visual‑parity win — most "looks like VS Code" feeling comes from this swap. |
| **react‑aria Tabs** (or `@radix-ui/react-tabs`) | `react-aria-components` | Headless, accessible tab primitives with full keyboard support. | The internals of `WorkflowTabs.tsx` (keeps our tab data model; gains a11y + dirty‑dot affordance). |
| **react‑jsonschema‑form** | `@rjsf/core` | Renders a settings UI directly from a JSON Schema — same pattern VS Code uses for its settings editor. | Phase E5 settings panel. We author one schema, get the form for free. |
| **tinykeys** (only if not using Lumino's dispatcher) | `tinykeys` | 400‑byte keybinding library. Use only if we want to avoid pulling Lumino. | Backup option for `useKeybindings`. |
| **@jupyterlab/rendermime** *(optional, later)* | `@jupyterlab/rendermime` | Renders Jupyter MIME bundles (HTML, SVG, plotly, LaTeX). Standalone, no kernel needed. | Only if/when a step needs to emit rich outputs beyond tabular data. Defer until a real use case appears. |

### 4.2 What we explicitly do NOT import

- `@jupyterlab/notebook`, `@jupyterlab/cells`, `@jupyterlab/application`, `@jupyterlab/filebrowser` — these assume Jupyter's cell + kernel + contents‑API model and would force a rewrite of our canvas and backend.
- The full `jupyterlab` meta‑package and `@jupyter-widgets/*` — bring in a whole runtime we don't need.
- Lumino's `Widget` / `BoxPanel` / shell — we keep React for layout; we only borrow `@lumino/commands`.

### 4.3 Sprint S0 — Foundations swap (1 week, mostly deletions)

Insert this sprint **before** Phase A. No behavior changes — pure primitive replacement.

- [ ] **S0.1** Add the libraries above to `frontend/package.json`. Pin majors.
- [ ] **S0.2** Replace splitter logic in `MainLayout.tsx` with `<Allotment>` panes. Delete the three `isResizing*` refs and their mouse handlers.
- [ ] **S0.3** Replace icon imports (Lucide → `@vscode/codicons`). One CSS import + a small `<Icon name="..." />` wrapper component.
- [ ] **S0.4** Swap `FileTree.tsx` internals to `react-arborist`. Keep `FileEntry` and the `/api/files/tree` call unchanged.
- [ ] **S0.5** Stand up `services/commands.ts` wrapping `@lumino/commands` `CommandRegistry`. Export the singleton. Register **zero** commands yet — Phase C will populate it.
- [ ] **S0.6** Stand up an empty `cmdk`‑based `CommandPalette.tsx` bound to `⌘⇧P`. Renders "no commands yet"; proves the wiring.
- [ ] **S0.7** Replace the formula bar `<textarea>` in `StepToolbar.tsx` with `<MonacoEditor language="simpleSteps" />`. Register a stub language definition (keywords only) — full grammar comes later.
- [ ] **S0.8** Update `MainLayout.test.tsx` snapshots; smoke‑test that `npm test` and `npm run build` still pass.

**Exit criteria:** App looks visibly more like VS Code (icons, splitters, file tree), the formula bar is now Monaco, `⌘⇧P` opens an empty palette, and net lines‑of‑code is **negative**. No backend changes.

---

## 5. Phased Roadmap

Each phase is shippable on its own. Items marked **P0** are blockers for the next phase.

### Phase A — Workspace & File System (foundation)

Goal: behave like "File → Open Folder" in VS Code.

- [ ] **A1 (P0)** Backend: `GET /api/workspace` → `{ root, name, projects: [...], recent: [...] }`. Source of truth for the chrome.
- [ ] **A2 (P0)** Backend: `POST /api/workspace/open` accept an absolute path; persist last‑opened in `~/.simple_steps/state.json`.
- [ ] **A3** Backend: `GET /api/files/tree?path=...` (already partially implemented) → unify on a single `FileEntry` schema (`{ name, path, kind: 'file'|'dir'|'pipeline'|'project', children? }`).
- [ ] **A4** Frontend: `FileTree.tsx` shows project folders with a **pipeline glyph** for `.json` pipelines (vs generic files). Double‑click a pipeline → open in a new tab.
- [ ] **A5** Frontend: `MenuBar` → `File ▸ Open Workspace…`, `File ▸ Open Recent ▸`, `File ▸ Close Workspace`. Wire to `/api/workspace/open`.
- [ ] **A6** Frontend: dirty‑state tracking per tab; show `●` on tab title when unsaved; prompt on close.
- [ ] **A7** Tests: `tests/test_file_manager.py` round‑trip; `MainLayout.test.tsx` open/close tab.

**Exit criteria:** Launch `simple-steps` in any directory → the explorer reflects it, double‑click loads a pipeline, ⌘S saves, dirty dot disappears.

---

### Phase B — Kernel / Environment Surface

Goal: equivalent of VS Code's "Select Kernel" button in the top‑right of a notebook.

- [ ] **B1 (P0)** Backend: `GET /api/kernel` → `{ python_executable, python_version, venv_path, platform, simple_steps_version, installed_packs: [{name, version}] }`. Pull from `sys`, `importlib.metadata`, and the pack registry.
- [ ] **B2** Backend: `POST /api/kernel/restart` → tear down in‑memory orchestration cache, re‑scan packs, return fresh `/api/kernel`. (Process stays alive; just resets state.)
- [ ] **B3** Backend: `POST /api/kernel/clear-outputs` → drop the data‑ref cache used by `runStep`. Frontend should mark all step statuses back to `pending`.
- [ ] **B4** Frontend: new `KernelStatus` component, top‑right of `UnifiedToolbar`. Click opens a popover with env info + actions: *Restart Kernel*, *Clear All Outputs*, *Reload Packs*.
- [ ] **B5** Frontend: persist warning banner if backend reports a pack import failure (today these are silent).
- [ ] **B6** Document in `docs/system_design/09-kernel-lifecycle.md`.

**Note:** We are *not* implementing multi‑kernel / kernel‑switching yet (the backend process *is* the kernel). The UI just makes that legible.

**Exit criteria:** User can see which Python is powering the session, restart it, and clear outputs, all without leaving the app.

---

### Phase C — Command Palette & Keybindings

Goal: every action discoverable via `⌘⇧P`. (S0 already stood up the empty registry + palette shell; this phase populates them.)

- [ ] **C1** Flesh out `services/commands.ts` — typed wrapper over `@lumino/commands` `CommandRegistry`:
      ```ts
      registerCommand({ id, title, category, keybinding?, when?, run: () => ... })
      ```
- [ ] **C2** Wire core commands: `workflow.runStep`, `workflow.runAll`, `workflow.stop`, `file.save`, `file.saveAs`, `file.openWorkspace`, `kernel.restart`, `kernel.clearOutputs`, `view.toggleSidebar`, `view.toggleChat`, `view.toggleExecutionLog`.
- [ ] **C3** Populate the `cmdk` palette (from S0.6) with the registry — fuzzy search, category headers, keybinding badges.
- [ ] **C4** Global keybinding dispatcher — use `@lumino/commands` `CommandRegistry.processKeydownEvent`, mounted on `window`.
- [ ] **C5** Tests for registry + palette filter logic.

**Exit criteria:** Every menu item is also reachable from the palette; tests assert the registry is the single source of truth.

---

### Phase D — Status Bar

Goal: persistent low‑profile feedback row, mirroring VS Code's bottom bar.

- [ ] **D1** `StatusBar.tsx` segments (left → right):
  1. Kernel indicator (⬤ green / yellow / red) + Python version.
  2. Active workspace name.
  3. Active project / pipeline.
  4. Pipeline progress (`3/5 steps ✓` while running).
  5. Save state (`saved` / `unsaved`).
  6. Pack count (`12 packs`) → click opens Packs panel.
- [ ] **D2** Each segment registers itself via a `useStatusItem({ id, priority, render })` hook so packs can contribute later.
- [ ] **D3** Animations: spinner while a step runs; transient toast on save.

---

### Phase E — Activity Bar Panels (rounding out the left rail)

`ActivityBar.tsx` exists but is sparse. Add the remaining VS Code‑style panels:

- [ ] **E1** **Explorer** (exists) — polish: context menu (`New Pipeline`, `New Project`, `Rename`, `Delete`, `Reveal in Finder`).
- [ ] **E2** **Packs panel** — list installed operation packs, version, source path, enable/disable toggle. Backend: `GET /api/packs`, `POST /api/packs/{id}/reload`.
- [ ] **E3** **Run history panel** — chronological list of step runs from `ExecutionLog`, persisted to `~/.simple_steps/history.jsonl`. Click an entry → jump to the step.
- [ ] **E4** **Search panel** — full‑text search across pipelines in the workspace (`grep` over JSON, surface matching step labels / formulas).
- [ ] **E5** **Settings panel** — UI over a `~/.simple_steps/settings.json`: theme, autosave, default orchestrator, agent enabled, telemetry off.

---

### Phase F — Notebook Lifecycle Parity

Goal: every notebook UX expectation that's still missing.

- [ ] **F1** **Autosave** (configurable; off by default like VS Code's). Debounced 1.5s after last edit.
- [ ] **F2** **Undo / Redo** stack at the workflow level (already partially in `useWorkflow`? confirm and finish). `⌘Z` / `⌘⇧Z`.
- [ ] **F3** **Move step** (drag in `WorkflowSequence`) + `Cells ▸ Move Up/Down` commands.
- [ ] **F4** **Run from here / Run above** commands on step right‑click.
- [ ] **F5** **Export** menu: `Export as Python script` (already partially supported via the formula→Python mapping — finalize), `Export as JSON`, `Export step outputs as CSV`.
- [ ] **F6** **Untitled pipeline** on launch (no project required), same as Jupyter's `Untitled.ipynb`. Prompted to save on first run.

---

### Phase G — Chat / Agent Polish

`ChatSidebar` exists. Bring it to Copilot‑Chat parity within the constraints of the formula model.

- [ ] **G1** Slash commands: `/insert-step`, `/explain-formula`, `/fix-error`, `/suggest-next`.
- [ ] **G2** Agent has read access to: current workflow JSON, available operations catalogue, last execution log. Read‑only by default.
- [ ] **G3** Agent edits go through the same `updateStep` API the UI uses — i.e. proposes a formula diff, user accepts to apply. Never bypass the formula bar.
- [ ] **G4** Inline “Explain this step” affordance on each `OperationColumn` header.

---

### Phase H — Multi‑pipeline / Multi‑tab Hardening

- [ ] **H1** Per‑tab `useWorkflow` instance (today's single‑instance hook lifted into a `WorkflowTabContext`).
- [ ] **H2** Independent run state per tab; only one pipeline runs at a time (kernel is shared) → queue + UI indicator.
- [ ] **H3** Detached step windows (`DetachedStepWindow` exists) re‑attach to the correct tab on close.

---

## 5. Backend API Additions (summary)

| Endpoint                              | Method | Purpose                                      | Phase |
|---------------------------------------|--------|----------------------------------------------|-------|
| `/api/workspace`                      | GET    | Current workspace + recents                  | A     |
| `/api/workspace/open`                 | POST   | Switch workspace root                        | A     |
| `/api/files/tree`                     | GET    | Unified file tree                            | A     |
| `/api/kernel`                         | GET    | Env + pack info                              | B     |
| `/api/kernel/restart`                 | POST   | Reset in‑process caches                      | B     |
| `/api/kernel/clear-outputs`           | POST   | Drop data‑ref cache                          | B     |
| `/api/packs`                          | GET    | Installed packs                              | E     |
| `/api/packs/{id}/reload`              | POST   | Re‑scan a single pack                        | E     |
| `/api/settings`                       | GET/PUT| User settings                                | E     |
| `/api/history`                        | GET    | Run history                                  | E     |
| `/api/search`                         | GET    | Search across pipelines                      | E     |

All new endpoints get Pydantic v2 models in `src/SIMPLE_STEPS/models.py` and tests in `tests/`.

---

## 6. Frontend Module Plan

```
frontend/src/
├── shell/                       ← NEW — everything that is *not* the canvas
│   ├── CommandPalette.tsx
│   ├── KernelStatus.tsx
│   ├── StatusBar.tsx
│   ├── PacksPanel.tsx
│   ├── RunHistoryPanel.tsx
│   ├── SearchPanel.tsx
│   └── SettingsPanel.tsx
├── services/
│   ├── commands.ts              ← NEW command registry
│   ├── keybindings.ts           ← NEW
│   ├── workspace.ts             ← NEW (wraps /api/workspace*)
│   └── kernel.ts                ← NEW (wraps /api/kernel*)
├── context/
│   ├── WorkspaceContext.tsx     ← NEW (single source of workspace state)
│   └── KernelContext.tsx        ← NEW
└── hooks/
    └── useStatusItem.ts         ← NEW
```

Existing components stay where they are; the canvas is unchanged.

---

## 7. Milestones / Sequencing

| Sprint | Phases   | Deliverable                                                      |
|--------|----------|------------------------------------------------------------------|
| S0     | §4.3     | Adopt primitives (Monaco, Lumino cmds, cmdk, Allotment, codicons, react‑arborist). Net deletion. |
| S1     | A1–A5    | Open any folder as a workspace; explorer + tabs round‑trip       |
| S2     | A6–A7, B | Kernel status visible + restartable; dirty‑state correct         |
| S3     | C, D     | Command palette, keybindings, status bar live                    |
| S4     | E        | Packs / History / Search / Settings panels                       |
| S5     | F        | Autosave, undo, move, export — notebook lifecycle complete       |
| S6     | G, H     | Agent polish + multi‑tab hardening                               |

Two‑week sprints (S0 is a one‑week sprint) → ~13 weeks to land the whole shell. Each sprint is independently shippable; you can stop after S3 and still have a recognizably "VS‑Code‑shaped" product.

---

## 8. Definition of Done (for the whole plan)

A new user who has used Jupyter inside VS Code can:

1. Launch `simple-steps` in a folder and see their pipelines in the explorer.
2. Open a pipeline in a tab; see kernel info top‑right and status bar bottom.
3. Run a step / all steps / restart kernel / clear outputs — by mouse, menu, palette, **and** keyboard.
4. Save, save‑as, open recent, undo, move steps, export to `.py`.
5. Browse installed operation packs and run history without leaving the app.
6. Ask the agent to suggest or fix a step; accept its diff into the formula bar.

When all six are true, the infrastructure is done and feature work can return to the canvas itself (formula grammar, shape vocabulary, decoration system — see `dev_notes/`).

---

## 9. Open Questions

1. **Multiple kernels?** Today the backend process *is* the kernel. Do we ever want to run two Python envs side‑by‑side (e.g. a `pandas 1.x` pipeline next to a `pandas 2.x` one)? If yes, Phase B grows substantially. **Recommendation:** punt until post‑S6.
2. **Hosted multi‑user (M1).** Covered in §0. Out of scope for this plan; the four forward‑compat rules in §0 are the only work we do now toward it. When we *do* tackle M1, the additional sprints needed are: per‑user auth (likely OAuth via the existing FastAPI app), per‑user kernel processes (one `uvicorn` worker per user or a kernel‑manager process pool), workspace isolation (chroot‑style path scoping in `file_manager.py`), and websocket migration for `runStep` progress events.
3. **Cell metadata.** Jupyter cells carry arbitrary `metadata`. Should `StepConfig` gain a `metadata: Dict` field for tags, collapse state, agent annotations? **Recommendation:** yes, add in S2 as a forward‑compatibility move.
4. **Conflict resolution.** Two tabs editing the same pipeline → last write wins or lock? **Recommendation:** detect via `updated_at` and warn; no locking.

---

## 10. References

- `docs/system_design/06-frontend-architecture.md` — current component tree
- `docs/system_design/08-pipeline-persistence.md` — file format
- `docs/dev_plan/100-architecture.md` — canvas architecture (unchanged by this plan)
- `dev_notes/scaling_notes.md` — performance considerations once shell is in place
