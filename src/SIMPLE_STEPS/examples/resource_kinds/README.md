# Resource kinds — try the resource column

One resource of every kind, each a deterministic dummy, so you can try the
resource column (the panel ahead of step 1) and check every answer.

```bash
simple-steps run examples/resource_kinds/app.py
python examples/resource_kinds/runme.py
```

| file | what it is |
|---|---|
| [`resource_tools.py`](resource_tools.py) | the five resource types and the ready-made `shared_fs` |
| [`app.py`](app.py) | the application |
| `workspace/projects/resource_kinds/resource-kinds.simple-steps-workflow` | the saved workflow |
| [`runme.py`](runme.py) | runs the workflow and checks every step |

## The resources

| name | type | kind (its icon) | used by |
|---|---|---|---|
| `db` | `CityDB()` | database | `regions` |
| `files` | `MemoryFS()` | file system | `texts`, `sizes` |
| `pool` | `WorkerPool(workers=2)` | compute | `squares`, `pool_info` |
| `llm` | `EchoLLM(model="echo-1")` | language model | `answer` |
| `weather` | `WeatherAPI(units="C")` | service | `temps` |
| `shared_fs` | the deployment's `MemoryFS`, its files locked | file system | `policy` |

The column picks the icon from the type's name and bases (`DB`, `FS`,
`Worker`, `LLM`, `API`). Every tool is a resource's method, written
`res["db"].lookup[mod.map()](wf["cities"])`, so the app declares no tools of
its own.

## Things to try

1. **Open the column's resources.** Each shows *Not loaded*: nothing is
   built until a step uses it, or you press **Load**.
2. **Load** `db`. Its dot turns green; the Overview menu counts it as loaded.
3. **Run** `squares`, then `pool_info`: it answers `pool #N: 2 workers`.
   **Refresh** `pool` and run `pool_info` again: the number goes up, because
   Refresh builds a new pool.
4. **Clear** `pool`. Its dot goes grey; the next run builds it again.
5. **Break one.** Change `pool`'s formula to `WorkerPool(workers=0)` and
   press Enter: it saves, because the setting's type is right. Press **Load**:
   it fails to build, and the error shows on the resource. Set it back to
   `WorkerPool(workers=2)`.
6. **Change a setting.** `WeatherAPI(units="F")` and re-run `temps`.
7. **Ready-made.** `shared_fs` comes from the deployment. Its `files` are
   locked, so the formula bar refuses a change to them.
8. **Hover** a resource: the steps that use it light up.
9. **Pin** the column (hover its header), scroll the steps to the right: a
   thin view stays at the left edge. Scroll back to the start for the full
   column.
10. **Maximize** a resource: it fills the canvas.

Notes and colours (the resource's settings, and its notepad) are saved in the
workflow under each resource's `meta`, and never change how it is built.
