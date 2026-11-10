# Specification: The workspace file API

The Explorer's file tree reads and writes files through three routes:
`GET /api/files`, `GET /api/files/read` and `POST /api/files/write`. Each
takes a path relative to the workspace root.

- **REQ-FILE-001:** each route acts only inside the workspace. A path that
  resolves outside it is refused with 403 and nothing is read or written:
  `..`, a sibling folder whose name begins with the workspace's (`../ws2`
  for a workspace `ws`), an absolute path, or a symlink that leads out.
  (Plan 127 F0: the check compared strings with `startswith`, so `../ws2`
  passed.)
