# 011 - Testing Strategy

## Overview

This plan establishes a layered, pragmatic testing strategy for Simple Steps. The goal is to catch regressions in the three areas that have already caused real bugs: the pipeline save/load round-trip, the slug/filename identity contract between frontend and backend, and the tab/breadcrumb state that reflects the saved state in the UI.

Tests are organised into four layers — each builds confidence at a different granularity. They should be run in order during development and all four layers should pass before merging to `main`.

---

## Layer 1 — Backend Unit Tests (Python / pytest)

**Purpose:** Verify the file-system persistence logic in isolation, without a running server.  
**Location:** `tests/test_save_load.py`  
**Tool:** `pytest`

### What to cover

- [ ] **Slug derivation** — `_slugify(name)` produces a safe filename string for every expected input (spaces, special chars, unicode, empty string).
- [ ] **Save creates the correct file path** — `save_pipeline("my-project", pipeline)` writes to `projects/my-project/<slug>.json`.
- [ ] **All step `config` fields survive a round-trip** — every key/value in every step's `config` dict is identical after `save → load`.
- [ ] **Pipeline `id` in the JSON matches the filename stem** — `pipeline.id == Path(file).stem` so the frontend slug lookup never fails.
- [ ] **`updated_at` is refreshed on every save** — calling `save_pipeline` twice produces a newer `updated_at` on the second call.
- [ ] **`load_pipeline` returns `None` (not an exception) for a missing pipeline.**
- [ ] **`delete_pipeline` removes exactly one file and returns `True`; a second call returns `False`.**
- [ ] **`list_projects` reflects a newly created project folder immediately.**
- [ ] **`list_pipelines` reflects a newly saved pipeline immediately.**

### Fixture pattern

Use `tmp_path` (pytest built-in) to avoid touching `projects/` on disk:

```python
@pytest.fixture
def fm(tmp_path, monkeypatch):
    monkeypatch.setattr("SIMPLE_STEPS.file_manager.PROJECTS_DIR", str(tmp_path))
    return tmp_path
```

Copy `projects/sample-youtube-mock-analysis/sample-example.json` as a known-good fixture to validate that the current on-disk format is always readable:

```python
@pytest.fixture
def real_sample(tmp_path):
    src = Path("projects/sample-youtube-mock-analysis/sample-example.json")
    dest = tmp_path / "sample-youtube-mock-analysis"
    dest.mkdir()
    shutil.copy(src, dest / "sample-example.json")
    return tmp_path
```

### Run command

```bash
pytest tests/test_save_load.py -v
```

---

## Layer 2 — Backend API Integration Tests (Python / pytest + httpx)

**Purpose:** Test the FastAPI routes end-to-end with a real (in-process) test client and a temporary `projects/` directory.  
**Location:** `tests/test_api.py`  
**Tool:** `pytest`, `httpx`, FastAPI `TestClient`

### What to cover

- [ ] `POST /api/projects` — creates a folder, returns `ProjectInfo` with correct `id` and `name`.
- [ ] `GET /api/projects` — lists only real project folders (not files).
- [ ] `POST /api/projects/{project_id}/pipelines` — saves file; the response `id` equals the slug derived from `name`.
- [ ] `GET /api/projects/{project_id}/pipelines/{pipeline_id}` — reloads by slug; all step configs match what was saved.
- [ ] **Full round-trip:** POST a pipeline with complex configs → GET it back → assert field-for-field equality.
- [ ] `DELETE /api/projects/{project_id}/pipelines/{pipeline_id}` — removes file; subsequent GET returns 404.
- [ ] `DELETE /api/projects/{project_id}` — removes folder; subsequent GET /api/projects omits it.
- [ ] Error cases: GET on unknown project returns 404 with a useful detail string.

### Key assertion: slug contract

```python
def test_saved_id_matches_filename(client, tmp_projects):
    r = client.post("/api/projects", json={"name": "My Project"})
    project_id = r.json()["id"]

    r = client.post(f"/api/projects/{project_id}/pipelines",
                    json={"id": "ignored", "name": "My Pipeline", "steps": [], ...})
    saved = r.json()
    expected_slug = "my-pipeline"

    assert saved["id"] == expected_slug
    assert (tmp_projects / project_id / f"{expected_slug}.json").exists()
```

### Run command

```bash
pytest tests/test_api.py -v
```

---

## Layer 3 — Frontend Unit Tests (Vitest + Testing Library)

**Purpose:** Test hook logic, slug utilities and modal state without a browser.  
**Location:** `frontend/src/**/*.test.ts(x)`  
**Tool:** `vitest`, `@testing-library/react`, `jsdom`

### Installation (one-time)

```bash
cd frontend
npm install --save-dev vitest @testing-library/react @testing-library/user-event jsdom
```

Add to `vite.config.ts`:

```ts
test: { environment: 'jsdom', globals: true }
```

### What to cover

#### Slug utility (pure function, highest priority)

- [ ] `slugify("My Pipeline")` → `"my-pipeline"`
- [ ] `slugify("  YouTube & Analysis! ")` → `"youtube-analysis"`
- [ ] `slugify("")` → `"pipeline"` (fallback)
- [ ] Round-trip: `slugify(name)` on frontend produces the same string as `_slugify(name)` on backend for the same input.

#### `useWorkflow` hook

- [ ] `saveWorkflow(projectId, "My Pipeline")` calls `savePipeline` with `id === "my-pipeline"`.
- [ ] After `loadWorkflowObject(wf)`, `workflow.steps` matches `wf.steps` with status reset to `"pending"`.
- [ ] `addStepAt(0)` inserts a step at index 0 and re-indexes all subsequent steps.
- [ ] `deleteStep(id)` removes the step and re-indexes.
- [ ] `updateStep(id, { label: "New" })` only changes that step.

#### `SaveModal` component

- [ ] Renders with the `defaultName` pre-filled.
- [ ] When `preselectProjectId` matches a project in the list, that project is pre-selected.
- [ ] Calls `onSave` with `(projectId, pipelineName, projectDisplayName)` when Save is clicked.
- [ ] Shows an error message when `onSave` rejects.
- [ ] "Create" button creates a new project and selects it.

#### `MenuBar` component

- [ ] Renders `projectName / pipelineName`.
- [ ] Shows `●` dot when `isModified={true}`.
- [ ] File dropdown appears on click; closes on outside click.
- [ ] Clicking "Save" calls `onSave`.

#### Tab state in `MainLayout`

- [ ] After `handleModalSave`, the active tab has `pipelineId === slug`, `isModified === false`, and `title === "${name}.json"`.
- [ ] `suppressModified` prevents `isModified` being set during a tab switch.
- [ ] Closing the only tab is blocked (tab count stays at 1).

### Run command

```bash
cd frontend
npm run test
```

---

## Layer 4 — End-to-End Tests (Playwright)

**Purpose:** Exercise the full user workflow in a real browser against both the running dev server and backend.  
**Location:** `frontend/e2e/`  
**Tool:** `@playwright/test`

### Installation (one-time)

```bash
cd frontend
npm install --save-dev @playwright/test
npx playwright install chromium
```

### Prerequisites

Both servers must be running:

```bash
# Terminal 1
uvicorn SIMPLE_STEPS.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

### What to cover

#### Pipeline save / reload (critical path)

- [ ] Open app → File → New Pipeline.
- [ ] Add at least one step and configure its arguments.
- [ ] Press `Cmd+S` → `SaveModal` appears.
- [ ] Enter pipeline name + select/create a project → click Save.
- [ ] Modal closes; tab title updates to `<name>.json`; breadcrumb shows project name; `●` dot is gone.
- [ ] Left sidebar explorer shows the new project folder and the new `.json` file inside it.
- [ ] **Hard reload** the page → click the pipeline in the sidebar → all steps and their configs are restored.
- [ ] Step argument values in the UI match what was saved.

#### Save As (new name, same project)

- [ ] With a saved pipeline open, File → Save As.
- [ ] Enter a different name → Save.
- [ ] Sidebar shows **both** pipeline files under the same project.

#### Rename

- [ ] File → Rename → enter new name → confirm.
- [ ] Tab title updates; breadcrumb updates; `●` dot appears.
- [ ] `Cmd+S` saves under the new name.

#### Tab management

- [ ] Two pipelines open in two tabs; switching tabs loads correct steps.
- [ ] Closing a tab that has unsaved changes: consider adding a "discard?" guard (future work — track as open issue).

#### Sidebar interactions

- [ ] Clicking 💾 on a project folder opens `SaveModal` pre-selected to that project.
- [ ] Clicking a pipeline file in the sidebar opens it in a new tab.
- [ ] Deleting a pipeline from the sidebar removes it from the file list.

### Run command

```bash
cd frontend
npx playwright test --headed
```

---

## Execution Order & CI Recommendation

| Step | Command | Gate |
|------|---------|------|
| 1 | `pytest tests/test_save_load.py -v` | Must pass before any other layer |
| 2 | `pytest tests/test_api.py -v` | Must pass before frontend tests |
| 3 | `cd frontend && npm run test` | Must pass before E2E |
| 4 | `npx playwright test` | Final gate before merge |

For CI (GitHub Actions), layers 1–3 can run without a display. Layer 4 requires `xvfb` or the Playwright Docker image.

---

## Open Issues to Track

- [ ] **"Discard unsaved changes?" guard** when closing a modified tab — currently tabs close silently.
- [ ] **Concurrent saves** — if two tabs are both modified and the user saves rapidly, the `suppressModified` ref is shared; consider per-tab save locks.
- [ ] **Backend returns the wrong `updated_at` format** — `sample-example.json` has `created_at` in ISO-Z format but `updated_at` without a `Z`; normalise in `save_pipeline`.
- [ ] **`list_pipelines` does not validate JSON shape** — a corrupt `.json` file silently breaks the whole project listing; add per-file try/except and skip.
