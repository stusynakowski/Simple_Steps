# 127 — File IO: importing and exporting data in steps

> Status: **proposed**, 2026-10-30, app at `bb181ab`, core `58bc115`. Every
> "today" and every core fact below was run, not read. Owner's ask: import
> and export data in steps, from the file system the app shows.

## Summary

A **Folder** resource: a folder on disk that steps read from and write to,
by name, as `res["…"]`. Every app gets a ready-made one, `workspace`, the
same folder the Explorer shows, so what you browse and what steps read and
write are the same files. Its tools:

| Tool | Writes | What it is |
|---|---|---|
| `res["workspace"].files[mod.source()](pattern="*.csv")` | a source | one row per matching file: its path, size, modified time |
| `res["workspace"].read[mod.source()](path="data/sales.csv")` | a source | a file as a table: CSV, JSON (records or lines) |
| `res["workspace"].write(wf["clean"], path="out/clean.csv")` | an export | the step's whole table to a file; its output is a record of what was written |

More folders come from the Resources menu: `Folder(path="…")`. Paths never
leave their folder.

## Today (run 2026-10-30)

| | Found |
|---|---|
| Import | One built-in tool, `load_csv(filepath)`: any path, read **relative to wherever the server was started**, not the workspace, so a workflow that uses it breaks on another machine. No workflow uses it; two READMEs mention it |
| Export | **Nothing.** No built-in tool writes a step's data to a file |
| The Explorer's files | The app's own view of the workspace (`/api/files`), for opening and saving workflows. **Not a resource**: steps can't reach it |
| The pattern that fits | `examples/image_processing`'s `ImageDirectory`: an app-defined folder resource with bound tools (`res["image_directory"].files`, `.load`) |
| **A security bug** | `/api/files`, `/api/files/read` and `/api/files/write` keep paths inside the workspace with `target.startswith(base)`. For a workspace `/home/me/ws`, the path `../ws2/secret.txt` resolves to `/home/me/ws2/secret.txt`, which starts with `/home/me/ws`: a sibling folder can be read and written. Symlinks aren't resolved either |
| Parquet | `pyarrow` isn't installed; Parquet would be a new dependency |

## What core gives (run 2026-10-30, core `58bc115`)

| Need | Core |
|---|---|
| A tool that gets a step's **whole table** (an export) | Yes. A parameter typed `pd.DataFrame` gets the whole grid; with no verb, core picks `table` itself ("'df' is a DataFrame, so the tool gets the whole grid"). The tool's return is the step's output (a `dict` → one row) |
| Tools that live on a resource | Yes: `@bound_tool` methods, called as `res["name"].tool`. A plain `@tool` on a method is refused, with that remedy |
| **Staleness when files change** | Yes, per resource. A resource's `data_version()` changing marks every step that read it stale ("stale: resource ws changed"); a re-run reads the new data. Per **folder**, not per file: a change to any file marks every step that read the folder stale |
| Nothing runs while staging | Confirmed: declaring a step never calls its tool |

## Design

### The Folder resource

- `Folder(path=".")`, declared with `simple_step_resource` in the app
  (`src/SIMPLE_STEPS/file_io.py`), offered by every `App`. A relative path
  is the workspace's.
- **Contained.** Every path is resolved (`realpath`, symlinks followed) and
  must be inside the folder (`os.path.commonpath`); anything else is
  refused with a message naming the folder. The same check replaces the
  Explorer's prefix test (F0 below).
- **`data_version()`**: a hash of the folder's file names, sizes and
  modified times, so a step that read the folder goes stale when a file in it
  changes (core does the rest). Per folder, as core offers it (D4).
- **Ready-made `workspace`**: `Folder` at the workspace root, provided to
  every app (`Loaded`), so a workflow can say `res["workspace"]` without
  setting anything up. An app can turn it off.

### Its tools

- **`files(pattern="*")`**: a source; one row per file under the folder
  matching the glob: `path` (relative), `size`, `modified`. Skips what the
  Explorer skips (`.git`, `__pycache__`, …).
- **`read(path, format="auto")`**: a source; the file as a table.
  `auto` goes by extension: `.csv`, `.tsv`, `.json` (an array of records, or
  an object of columns), `.jsonl`. A `str` column per row for anything else
  (`format="text"`: one row per line). Images stay the image example's job.
- **`write(df, path, format="auto", overwrite=True)`**: an export. Gets the
  whole table (core's `table`), writes it, creates folders as needed, and
  returns `{path, rows, columns, bytes, written_at}`. The `#` lineage columns
  are not written.

### Exports, in the workflow

- An export **runs only when run**: Run Step, ⌘↵, or Run Workflow. Enter
  stages it and writes nothing (staging calls no tool, confirmed above).
- Its output is the record of what it wrote, shown in the grid like any
  other step; it goes **stale** when its input changes, so the file on disk
  is out of date until it's run again.
- Re-running overwrites the file (D2).

### In the UI (later, small)

- **Explorer → "Import as step"** on a file: adds a step
  `res["workspace"].read[mod.source()](path="…")`.
- An export step's output links to its file in the Explorer.
- The Resources menu and the Environment panel list `Folder` and the
  ready-made `workspace` like any other resource.

### What goes

- `load_csv`: replaced by `res["workspace"].read`; its two README mentions
  are updated (D3).

## Decisions to make

| | Question | Recommended |
|---|---|---|
| D1 | Is `workspace` ready-made in every app, or opt-in? | Every app, with a way to turn it off: the Explorer already shows these files to every user |
| D2 | An export onto an existing file | Overwrite (a re-run is a re-export); `overwrite=False` to refuse instead |
| D3 | `load_csv` | Remove it, once `read` lands (no workflow uses it; its path is server-relative) |
| D4 | Staleness per folder, or per file | Per folder now (core's `data_version`); per file is a core ask (a resource version that depends on the tool's arguments) if folders get big |
| D5 | Formats beyond CSV / JSON / text | Parquet and Excel only when asked: each is a new dependency (`pyarrow`, `openpyxl`) |

## Order of work

| # | Work | Why first |
|---|---|---|
| F0 | **Fix the Explorer's path check** (`realpath` + `commonpath`, a test that `../ws2/x` is refused) | a security bug, independent of the rest |
| F1 | `Folder` with `files` and `read`; containment and `data_version`; the ready-made `workspace` | import first: no side effects |
| F2 | `write`, the export record, `#` columns left out | the side-effecting half, once reading is settled |
| F3 | Explorer "Import as step"; an export's file link | the UI on top |
| F4 | Remove `load_csv` (D3); docs: the developer guide's resources section, a user-guide page on files | cleanup |

## Tests to add

| ID | Checks |
|---|---|
| TEST-FILE-001 | `../`, an absolute path, and a symlink pointing out of the folder are each refused, in the Folder and in `/api/files` (F0) |
| TEST-FILE-002 | `read` of CSV, TSV, JSON records, JSON columns and JSONL gives the same table |
| TEST-FILE-003 | Changing a file makes a step that read the folder stale; re-running reads the new rows |
| TEST-FILE-004 | Staging an export writes nothing; running it writes the file and returns its record |
| TEST-FILE-005 | An export of a step with `#` lineage columns writes only its values |
| TEST-FILE-006 | `workspace` is offered in a fresh app and resolves to the Explorer's root |
