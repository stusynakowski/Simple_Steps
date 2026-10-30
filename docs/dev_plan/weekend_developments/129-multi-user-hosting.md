# 129 — Hosting for many users, each isolated

> Status: **proposed**, 2026-10-30, app at `bb181ab`. Owner's goal: one
> on-prem server where many people use one application (one scope of
> problems: its tools and resources), each isolated from the others. Docker
> may be there, but a plain Linux machine with a standard Python or conda
> environment must be able to host it. Single-user modes (`simple-steps run`,
> the desktop app, `simple-steps-dev`) stay as they are; this is a mode.

## Today (checked 2026-10-30)

| | Found |
|---|---|
| **Who you are** | No identity. A **session** is an anonymous random id (`uuid4`) in the `ss_session` cookie (`session.py`), `HttpOnly`, `SameSite=Lax`, `Secure=False`. The server **accepts any cookie value it's given**: whoever holds or guesses a session id is that session |
| **Per session** | the live kernels (`kernels.py`: one live per session, `MAX_LIVE = 1`, put away after 30 idle minutes), their stored outputs (`.simple_steps_cache/<session token>/…`), and what reads them: `/api/data`, `/api/view`, `/api/cell`, `/api/data-meta`, `/api/workflow/sync`, run progress |
| **Shared by everyone** | the **workspace and its projects** (every user sees and edits the same workflow files); the **file API**, writes included (`/api/files`, `/api/files/read`, `/api/files/write`); **settings** (`/api/settings`); the **agent's configuration** (`agent_config.json`); and `POST /api/workspace/open`, which **switches the workspace for the whole server** (it records the path in `~/.simple_steps/state.json`) |
| **Where steps run** | in the **server's own process**, on its thread pool (`/api/run` → `run_in_executor`): one user's slow, memory-hungry or crashing tool affects every user |
| **Paths** | the file API's containment check is a string prefix (`target.startswith(base)`): a sibling folder with the same prefix is reachable (127, F0) |
| The data directory | `.simple_steps_cache` relative to wherever the server started (`SIMPLE_STEPS_RESULT_CACHE_DIR` overrides) |

So the kernels are already per session (the JupyterHub shape, 124), but
everything around them assumes one user on their own machine.

## The shape

```
             ┌──────────────── reverse proxy (TLS) ─────────────────┐
browser ───▶ │ nginx / caddy: HTTPS, optional SSO (oauth2-proxy, …) │
             └──────────────────────────┬───────────────────────────┘
                                        ▼
               the hub: one simple-steps server (FastAPI)
               • who you are (login, or the proxy's header)
               • your workspace, settings, agent config
               • the app: tools, resources, ready-made resources
                                        │  one per active user
                                        ▼
               a kernel host per user: their live kernels, their runs
               (in the hub's process │ a child process │ a container)
```

- **A user** is an account: a name, a role, a home. **A session** is a login
  of that user in a browser. Kernels belong to the user, not the browser, so
  a second tab or another machine sees the same live workflow.
- **A kernel host** is where a user's kernels live and their steps run. One
  interface, three implementations, chosen by configuration (D1):
  - **in-process**: today's behaviour; for single-user modes;
  - **subprocess**: a child Python process per active user, started by the
    hub, with OS limits (`resource.setrlimit`: memory, CPU time, open
    files); plain Linux, no Docker. A crash or a runaway tool takes down only
    that user's host, which the hub restarts;
  - **docker** (optional): a container per user, with cgroup limits and only
    that user's home mounted.

  The hub talks to a host over a local socket; the API (`/api/run`,
  `/api/view`, …) doesn't change, the hub forwards. Idle hosts are stopped,
  their kernels put away first (they already save and restore, 124).

## Identity

| Way in | For |
|---|---|
| **Local accounts** | small teams: a users file on the server, passwords hashed with the standard library (`hashlib.scrypt`), managed from the command line (`simple-steps users add alice --role member`) and an admin page |
| **The proxy's header** | a site with SSO already: the reverse proxy (oauth2-proxy, LDAP, Kerberos) authenticates and sets a header (`X-Forwarded-User`); the hub trusts it **only** from the proxy's address |
| OIDC (later) | a direct identity-provider login, if a site wants one without a proxy |

- The session cookie is **signed** (HMAC with a server secret), tied to the
  user, `Secure` behind HTTPS, and expires. An unsigned or unknown cookie is
  refused, not adopted.
- State-changing requests check the `Origin` header (CSRF), alongside
  `SameSite=Lax`.
- WebSockets authenticate the same way at the handshake.

**Roles:** **admin** (users, quotas, the app's ready-made resources and
secrets, the agent's model, the audit log), **member** (their own home),
and optionally **viewer** (open shared workflows, run nothing).

## What becomes per user

| Today shared | Becomes |
|---|---|
| the workspace and its projects | **a home per user**: `<data>/users/<name>/workspace/projects/…`; the Explorer and the file API see only it |
| `POST /api/workspace/open` | **off** in multi-user mode (a user has one home); admin-only if kept at all |
| settings | per user, in their home |
| the agent's configuration | the model is the admin's (the server's GPU); a user's own preferences are theirs |
| outputs and kernel snapshots | under the user, not the browser: `<data>/users/<name>/cache/…` |
| run progress, logs, the console | per user (they already follow the session; they follow the user) |

**Stays shared, read-only to members:** the app (tools, resource types), the
**ready-made resources** and their secrets (the admin's), and a **templates**
area of example workflows anyone can copy into their home.

**Sharing between users** (D3): first, copy a workflow to another user, or
publish it to templates; later, shared projects with owners and members.

## Limits and quotas

| Limit | Where | Default (D4) |
|---|---|---|
| live kernels per user | hub | 1 (today's `MAX_LIVE`) |
| concurrent runs per user | hub | 1 |
| a run's time | core's `mod.timeout`, and the host's CPU limit | 10 minutes |
| a host's memory | `setrlimit` / the container | 4 GB |
| a home's disk | the hub, checked on write | 5 GB |
| active users at once | hub | set by the admin to the machine |

A user over a limit gets a message saying which, not a dead server.

## Audit

One append-only log: who signed in, who ran which step of which workflow
(with its formula), who changed a resource or a user, and, with 128, every
action the agent took and for whom. Admins read it in the admin page.

## Deploying

**Plain Linux, no Docker** (the baseline):

```bash
conda create -n simple-steps python=3.13 && conda activate simple-steps   # or python -m venv
pip install "simple-steps @ git+https://github.com/stusynakowski/Simple_Steps.git"
simple-steps serve app.py --multi-user --config /etc/simple-steps/server.toml
```

- `server.toml`: the data directory, the auth mode, the kernel host, the
  limits, the server secret's location.
- A **systemd unit** (shipped as a template) runs it as its own system user
  (`simple-steps`), restarts it, and writes to `/var/lib/simple-steps`.
- **nginx or caddy** in front for HTTPS (configs shipped as templates).
- Kernel hosts are child processes of the same system user (D2: separate OS
  users per person need root and are left for later).

**Docker** (optional): a `Dockerfile` and a `compose.yaml` (the hub + caddy,
the data directory as a volume); the docker kernel host when per-user
containers are wanted.

The data directory, everything a backup needs:

```
<data>/
  config/        server.toml's secret, users file (hashed), ready-made resource secrets
  users/<name>/  workspace/projects/…, settings.json, cache/
  templates/     shared example workflows
  audit.log
```

## Security, first

Independent of the rest, and needed before anyone else connects:

1. The file API's path check: `realpath` + `commonpath` (127 F0).
2. `POST /api/workspace/open`: off when multi-user.
3. Signed session cookies; an unknown cookie refused, not adopted.
4. `Secure` cookies and `Origin` checks behind HTTPS.
5. An upload and request size limit at the proxy and the hub.

## Decisions to make

| | Question | Recommended |
|---|---|---|
| D1 | The default kernel host for multi-user | **subprocess**: isolation of crashes, memory and CPU with no Docker; docker as an option |
| D2 | Separate OS users per person | not in v1 (needs root); one system user, homes kept apart by the hub and the host's working directory |
| D3 | Sharing | copy to a user, publish to templates; shared projects later |
| D4 | Default limits | as in the table, per server in `server.toml`, per user overridable by an admin |
| D5 | Identity | local accounts and the proxy header in v1; OIDC when a site asks |
| D6 | Per-user secrets (a user's own database password) | not in v1: secrets stay with the admin's ready-made resources; a per-user secret store later |

## Order of work

| # | Work |
|---|---|
| M0 | The security fixes above |
| M1 | Users and sign-in: local accounts and the proxy header; signed cookies; roles; the `users` command |
| M2 | Per-user state: homes, settings, caches, kernels keyed by user; templates; workspace switching off |
| M3 | The kernel-host interface; the in-process host (today's code behind it); the subprocess host with limits; restart and idle stop |
| M4 | Deploying: `simple-steps serve --multi-user`, `server.toml`, the systemd and proxy templates, a conda environment file; a smoke test that installs into a clean environment and serves two users |
| M5 | The admin page: users, quotas, active hosts, the audit log |
| M6 | The docker host and the compose kit |
| M7 | Sharing (D3) |

## Tests to add

| ID | Checks |
|---|---|
| TEST-HOST-001 | user A can't list, read, write or run anything in user B's home, by the file API, a ref id, a view, or a workflow key |
| TEST-HOST-002 | an unsigned, forged or expired cookie is refused; a cookie never becomes another user's session |
| TEST-HOST-003 | a tool that crashes or exceeds its memory limit stops only its user's host; others keep working; the hub restarts it |
| TEST-HOST-004 | a user over a quota gets a message naming it |
| TEST-HOST-005 | `--multi-user` on a clean conda environment serves two users with no Docker (part of `smoke_install`) |
| TEST-HOST-006 | every run and every agent action appears in the audit log with its user |
