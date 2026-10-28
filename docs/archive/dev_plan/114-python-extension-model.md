# Python extension model: @op, @resource, progress/cancel

> Section §1.11 — how power users add their own Python.
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

### 1.11 — Python extension model

> **Goal.** Power users can register their own Python as a first-class op
> without touching the parser.  Spreadsheet users never see this.

#### 1.11.1 — How a user adds Python

Drop a `.py` file under `packs/<my_pack>/operations.py`:

```python
from SIMPLE_STEPS.pack_api import op

@op(name="word_count", category="text")
def word_count(text: str) -> int:
    """Number of whitespace-separated tokens."""
    return len(text.split())

@op(name="zscore")
def zscore(col: "Column[float]") -> "Column[float]":
    """Standardize a numeric column."""
    return (col - col.mean()) / col.std()
```

Restart the session (Kernel pill → Restart in Phase B).  The ops appear
in the autocomplete and the command palette immediately.

**The decorator IS the contract.**  Everything the engine needs to know
about an op — how to schedule it, whether to cache it, what secrets it
needs, what resources to inject, whether it's incremental — is declared
as a kwarg on `@op`.  The bar parser never grows; the *decorator* does.
A fully-loaded example:

```python
from SIMPLE_STEPS.pack_api import op, resource

@resource(name="openai", secrets=["OPENAI_API_KEY"])
def openai_client(api_key: str):
    from openai import OpenAI
    return OpenAI(api_key=api_key)

@op(
    name="summarize",
    category="llm",
    async_=True,                  # engine awaits this op
    max_concurrency=20,           # within-step parallelism cap
    deterministic=False,          # skip cache
    network=True,                 # surface "needs network" pill chip
    source=True,                  # this op materializes external data
    key="row_id",                 # primary key for incremental updates
    default_mode="fill_missing",  # see §1.14
    needs=["openai"],             # resources to inject
    secrets=["OPENAI_API_KEY"],   # surfaced at session boot for prompt
)
async def summarize(
    text: "Column[str]",
    *,
    openai,            # injected by name (resource id == param name)
    progress,          # engine-provided, see §1.11.6
    cancel_token,      # engine-provided, see §1.11.6
) -> "Column[str]":
    out = []
    for i, t in enumerate(text):
        cancel_token.raise_if_cancelled()
        r = await openai.responses.create(model="gpt-4o-mini", input=t)
        out.append(r.output_text)
        progress(i + 1, len(text))
    return out
```

The bar call is still boring: `=summarize(step1.transcript)`.  All of
the policy above lives next to the function, in code review, in git
history — *not* in a YAML sidecar and *not* in the formula string.

**Recognised `@op` kwargs** (locked):

| Kwarg | Type | Default | Meaning |
|---|---|---|---|
| `name` | `str` | function name | Bar-visible identifier |
| `category` | `str` | `"misc"` | Grouping in the palette |
| `async_` | `bool` | `False` | If True, op is awaitable |
| `max_concurrency` | `int` | `1` | Max in-flight tasks within this step |
| `deterministic` | `bool` | `True` | False ⇒ never cached |
| `network` | `bool` | `False` | Surfaces a "🌐 network" chip on the step |
| `source` | `bool` | `False` | Treats output as external data — enables incremental modes (§1.14) |
| `key` | `str` \| `list[str]` | `None` | Primary key for `source=True` ops |
| `default_mode` | str | `"replace"` | One of `replace`/`append`/`upsert`/`fill_missing` |
| `needs` | `list[str]` | `[]` | Resource ids to inject; see §1.11.5 |
| `secrets` | `list[str]` | `[]` | Env-var names required; missing ⇒ banner |
| `timeout_s` | `float` \| `None` | `None` | Hard wall-clock cap per call |

#### 1.11.2 — Type → shape inference

The `@op` decorator inspects type hints to decide *what kind of input the
op expects* and *what shape it returns*.  This drives the autocomplete
hints and the error messages.

| Param hint | Expected input | Bar coercion |
|---|---|---|
| `int` / `float` / `str` / `bool` | scalar literal | rejects non-literal |
| `list[T]` | literal list | rejects scalar |
| `Cell[T]` | a `=Cell(...)` ref | rejects multi-row inputs |
| `Column[T]` | step column or `=Column(...)` | rejects step-table |
| `Table` | step or `=Table(...)` | accepts any step |

`Return` type determines the *output shape*:

| Return hint | Output |
|---|---|
| scalar (`int`/`str`/…) | 1×1 Cell |
| `list[T]` / `Column[T]` | n×1 Column |
| `dict` / `pd.DataFrame` / `Table` | full Table |

If hints are missing, the decorator falls back to "Table → Table" and
emits a warning in the Execution Log so the author knows to add them.

#### 1.11.3 — Apply / map (per-row Python escape hatch)

For one-off "I just want to run a Python function over my rows" cases
without writing a pack:

```
=apply(step1, OP_NAME, on="url")           # OP_NAME runs per cell of `url`
=apply(step1, OP_NAME, on=["a","b"])        # OP_NAME(a, b) → new col
=apply(step1, OP_NAME, on="url", into="domain")
```

`OP_NAME` must be a **registered op identifier** (no inline lambdas — keeps
the bar deterministic, cacheable, and shareable).  The cell value(s) are
passed positionally; extra kwargs to the op come via `args={...}`.

This replaces the old `map_each` / `apply_to` / `expand_each` trio with
one verb — the differences (per-row vs per-frame vs row-expand) are
expressed by the op's return type:

| Op returns | Behaviour of `apply` |
|---|---|
| scalar | per-cell map → new column |
| `Column` | per-cell map yielding lists → `Expand`-equivalent if `expand=True` |
| `Table` | per-row sub-tables → concatenated (row-expand) |

#### 1.11.4 — Frontend "Add Operation" affordance

Phase C: a `+` button in the Operation Pack sidebar opens a Monaco editor
pre-filled with the `@op` template above, saves under `packs/local/`, and
triggers a hot reload.  Until then, packs are installed by hand and a
restart is required.

#### 1.11.5 — `@resource` — session-scoped stateful clients

Some ops need an object that's expensive to build and stateful (HTTP
session with connection pool, OpenAI client, sqlite connection, headless
browser, …).  Building one per op call wastes time and breaks rate
limiters.  Building one at import time leaks secrets and makes mocking
hard.  Answer: **declare it as a resource.**

```python
from SIMPLE_STEPS.pack_api import resource

@resource(name="openai", secrets=["OPENAI_API_KEY"])
def openai_client(api_key: str):
    from openai import OpenAI
    return OpenAI(api_key=api_key)

@resource(name="http")
def http_session():
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": "simple-steps/1.0"})
    return s

@resource(name="db")
def db():
    import sqlite3
    return sqlite3.connect("data.sqlite")
```

**Lifecycle.**

| Event | What happens |
|---|---|
| Session boot | Resource is *registered* but not instantiated. |
| First op with `needs=["openai"]` runs | Resource factory called once; result memoized for the session. |
| Subsequent ops | Same instance injected — no rebuild. |
| Kernel pill → Restart | All resources discarded; factories will re-run on next demand. |
| Session exit | If the resource exposes `.close()` it is called; otherwise GC'd. |

**Secret injection.**  If a `@resource` declares `secrets=["NAME"]`, the
engine reads `NAME` from (in order) `~/.simple_steps/secrets.json` →
process env → workspace-local `.env`.  The factory is called with each
declared secret as a positional argument *in the order listed*.  Missing
secret → op call fails at first-use with a clickable banner "Add
`OPENAI_API_KEY` in Settings → Secrets".  Boot does **not** fail; an
unused-but-undeclared resource is fine.

**Injection into ops.**  An op declares `needs=["openai"]`; the engine
injects the resource as a keyword argument whose **name matches the
resource id** (`openai` here).  Pytest-fixture style.  Open question
§4.13 below tracks the alternative of explicit `(resource_id,
param_name)` tuples.

**Cross-pack references.**  A resource defined in `pack_a` is referenced
as `"pack_a.openai"` from `pack_b`.  Bare `"openai"` resolves to the
current pack first, then falls back to globally-unique names.  Collisions
across packs without a prefix → registration error at session boot.
(Open question §4.14.)

**What `@resource` is NOT.**

- Not a place for per-row caches (use ordinary Python `functools.cache`
  inside the op).
- Not a way to share state *between* ops in a way that survives Restart
  (that's the source-op cache, §1.14).
- Not a DI container — only ops can request resources, and only by name.

#### 1.11.6 — `progress` and `cancel_token` (engine-injected utilities)

Long-running ops should report progress and bail out cleanly when the
user hits the red Stop button.  The engine injects two utilities into
any op whose signature includes them by name (no decoration needed):

```python
@op(name="scrape_all", async_=True, max_concurrency=10, network=True)
async def scrape_all(urls: "Column[str]", *, http, progress, cancel_token):
    out = []
    for i, url in enumerate(urls):
        cancel_token.raise_if_cancelled()        # raises Cancelled
        out.append(await fetch(http, url))
        progress(i + 1, len(urls), msg=url)      # updates step header
    return out
```

| Utility | API |
|---|---|
| `progress` | callable `progress(done, total, msg="")` — updates the step pill's progress bar |
| `cancel_token` | `cancel_token.is_cancelled() → bool` and `.raise_if_cancelled()` |

Neither is required.  An op that omits them runs to completion and shows
an indeterminate spinner.  The engine still enforces `timeout_s` for ops
that can't or won't check cancellation.


