# Open questions and the pre-implementation decision tracker

> Sections §4 (27 open questions) and §5 (decision tracker).
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

## 4. Open questions

These need a yes/no before the parser rewrite lands.

1. **Bare-literal default column name** — `=42` produces a column called what?
   Proposal: `"value"`.  Alternative: leave unnamed (frontend renders index).
2. **`Cell([1,2])` policy** — error vs auto-promote to `Column`?
   Proposal: error, force user to pick the right constructor.
3. **`Column` name inference from single-key dict** — does the explicit
   `name=` override the key name?  Proposal: yes, explicit always wins.
4. **`Table` from file path** — sandbox to `WORKSPACE_ROOT`?
   Proposal: yes; absolute paths and `..` traversal rejected with a banner.
5. **Unknown parameters in operation calls** — silent drop, warn-and-run, or
   reject?  Proposal: **reject** with did-you-mean.  Reasoning: silent
   drops cause "why isn't my param working" tickets we can never debug.
6. **`step0` semantics** — error vs alias for "input dataframe".
   Proposal: error.  We don't have an "input dataframe" concept at the
   step level today — step1 *is* the first step.
7. **Case sensitivity of operation names** — `=OP` vs `=op`.
   Proposal: case-sensitive (Python-style).  `Cell`/`Column`/`Table` are
   capitalized because they are *types*; everything else is a function.
8. **`and` / `or` on step columns** — error or implicit translate to `&` / `|`?
   Proposal: error.  Python's `and`/`or` short-circuit on truthiness, which
   silently produces the *wrong* answer on pandas Series; better to fail
   loudly with "Use `&` for elementwise AND".
9. **`Expand` default `into=` behavior** — replace source column in place,
   or always require explicit `into=`?  Proposal: in-place replace when
   omitted; `into=` adds a new col and drops the source.
9b. **`Expand` axis inference from cell type** — list→rows, dict→cols,
    str→requires `sep`.  Lock these defaults?  Proposal: yes — they match
    the most common shape transitions and `axis=` is always available as
    an escape hatch.
10. **`Collapse` dropping un-aggregated columns** — silent drop or error?
    Proposal: silent drop **with a warning chip on the step header** listing
    which columns were dropped.  Quiet enough not to nag; visible enough
    to debug.
11. **Eval mode** — keep or remove?  With the new grammar (operator
    overloading + 3 constructors + ops), eval mode covers very few cases
    that `Column` / `Table` don't already handle.  Proposal: **remove**.
    Lean: smaller surface area, security boundary becomes "no imports,
    period."  Migration: rewrite eval recipes as registered operations.
12. **`Cell()` vs `Cell(None)` vs missing-value sentinel** — three concepts,
    do they collapse to two or stay separate?  Proposal: stay separate.
    `Cell()` → empty (`∅`, "no value computed"); `Cell(None)` → explicit
    null; missing/NaN inside a `Column` → propagates as usual.  Reasoning:
    reductions over empty columns need a distinct "I ran but had nothing
    to reduce" signal, otherwise it's indistinguishable from "user
    explicitly stored a null".
13. **Resource injection — by name vs explicit tuple.**  Proposal:
    inject by parameter-name match (`needs=["openai"]` ⇒ `def f(*, openai)`),
    pytest-fixture style.  Tuples `("openai", "client")` available as an
    opt-in for rename / disambig.  Failure mode for typo'd names is a
    clear "no such resource" error at op load time.
14. **Missing-secret failure mode — lazy vs eager.**  Proposal: **lazy** —
    fail at first op call that needs the secret, with a clickable
    "Add `OPENAI_API_KEY` in Settings → Secrets" banner.  A workflow of
    pure transforms shouldn't be blocked by missing LLM creds.  Eager
    check available via a Settings toggle.
15. **Cross-pack resource references.**  Proposal: addressable as
    `"pack_a.openai"`; bare names resolve current-pack-first, then global
    if unique; collisions without a prefix → boot error.  Same namespacing
    rule as op names — keeps the mental model consistent.
16. **Source-op `default_mode` default.**  Proposal: `replace`.  It's the
    only mode that's correct without a `key=` declared; surprises are
    limited to "I lost my cache" rather than "my data silently
    double-counted."  Incremental semantics opt in explicitly.
17. **Source-op `upsert` duplicate-key handling.**  Proposal: **error**
    with a banner naming the duplicate keys (top 5).  Silent
    last-write-wins hides op bugs forever.
18. **Async kwarg — `async_` vs sniff from signature.**  Proposal: sniff
    via `inspect.iscoroutinefunction`; allow `async_=False` to force sync
    execution of a coroutine (testing).  Removes a footgun where author
    marks `async_=True` but writes a sync `def`.
19. **Structured literal arguments (lists, dicts, tuples).**  Ops often
    take config like `by=["a","b"]` or `headers={"Accept":"json"}`.
    Proposal: accept literal `list` / `dict` / `tuple` as op arguments
    via the same `ast.literal_eval` path as bare literals (§1.1).  Depth
    capped at 3; deeper config must live in a workspace `.json` and load
    via `=Table("config.json")`.  No step refs allowed inside containers
    (use a dedicated op instead of nesting `step2.x` into a list).
20. **`ColumnRef` as a first-class param hint.**  Bare strings inside
    op kwargs (e.g. `by=["category", "region"]`) are ambiguous: literal
    string or column reference?  Proposal: introduce `ColumnRef` /
    `list[ColumnRef]` / `dict[ColumnRef, T]` as hint vocabulary; the
    decorator tells the engine which strings to validate as columns of
    the upstream step, drive autocomplete from, and auto-rewrite on
    rename.  Bar syntax stays plain strings.
21. **`**kwargs` opt-in for ops with truly dynamic kwargs.**  Override
    of §4.5 for HTTP/SQL/chart-style ops.  Proposal: `@op(accept_unknown_kwargs="headers")`
    funnels all unrecognised kwargs into the named parameter.  Required
    so autocomplete stops typo-correcting keys it can't know about.
22. **`Literal["a","b"]` hint for enum-like kwargs.**  Proposal: support
    `typing.Literal` in param hints — drives a dropdown in the bar and
    is validated at parse time.  E.g. `how: Literal["left","right","inner","outer"]`.
23. **Heterogeneous-cell `Expand`.**  When a column has mixed cell types
    (some lists, some dicts), refuse to infer axis.  Proposal: error
    with the offending row indices listed (top 5).  Don't try to "do the
    right thing" on mixed shapes.
24. **Pack hot-reload vs Restart.**  Proposal: Restart-only for v1.
    Hot-reload of decorated, possibly-stateful op modules is a notorious
    bug source (stale closures, frozen `Mock` clients).  Revisit in
    Phase C with a dedicated "Reload pack" affordance.
25. **Resource teardown order.**  Proposal: on Restart / session exit,
    resources with `.close()` are called in **reverse registration
    order** (so DB outlives HTTP outlives caches).  Spelled out so pack
    authors can rely on it.
26. **Reserved type names.**  Proposal: `Cell`, `Column`, `Table` are
    reserved — packs cannot register ops with those names.  Hard error
    at pack load.  Prevents users from shadowing constructors.
27. **`step0` reservation for future workflow input.**  Proposal: reject
    `step0` today with "Steps are 1-indexed."  Reserve the identifier so
    we can later use it for "workflow parameter / input dataframe" without
    breaking compat.

---

## 5. Decisions still needed before parser / pack-api code starts

Sticky list — flip ✅ as each is locked in.

- [ ] §4.5 reject unknown params *(lean: yes)*
- [ ] §4.11 remove eval mode *(lean: yes)*
- [ ] §4.13 resource injection by parameter name *(lean: yes)*
- [ ] §4.14 lazy secret check *(lean: yes)*
- [ ] §4.15 cross-pack resource naming `pack.name` *(lean: yes)*
- [ ] §4.16 source-op default mode = `replace` *(lean: yes)*
- [ ] §4.17 upsert duplicate keys → error *(lean: yes)*
- [ ] §4.18 sniff `async` from signature *(lean: yes)*
- [ ] §4.19 accept literal list/dict/tuple args, depth ≤ 3 *(lean: yes)*
- [ ] §4.20 `ColumnRef` / `list[ColumnRef]` / `dict[ColumnRef,T]` as hint vocab *(lean: yes)*
- [ ] §4.21 `accept_unknown_kwargs="param"` opt-in for dynamic kwargs *(lean: yes)*
- [ ] §4.22 support `typing.Literal[...]` for enum kwargs *(lean: yes)*
- [ ] §4.23 heterogeneous `Expand` → error with row indices *(lean: yes)*
- [ ] §4.24 Restart-only pack reload for v1 *(lean: yes)*
- [ ] §4.25 resource teardown in reverse registration order *(lean: yes)*
- [ ] §4.26 `Cell`/`Column`/`Table` reserved names *(lean: yes)*
- [ ] §4.27 reserve `step0` for future workflow input *(lean: yes)*
- [ ] §1.10 MVP op set — ship all 50 or pick a 20-op core?

