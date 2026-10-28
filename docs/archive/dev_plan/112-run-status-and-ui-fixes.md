# Run-status UX expectations and UI fix log

> Sections §1.9 (run status) and §2 (UI fix backlog).
>
> Sourced from the May-17 working spec
> (`dev_notes/formula_bar_contracts.md`, now retired).

---

### 1.9 — Status / UX expectations for *every* run

For every formula above, when the **Run** button is clicked:

- [ ] Step header pill turns **yellow "running"** within 100ms.
- [ ] On success → green "✓ done" + execution-time chip (e.g. `42ms`).
- [ ] On failure → red "✗ error" + clickable banner that opens the **Execution Log** scrolled to this step's error.
- [ ] Output grid renders before the next step's "running" pill (i.e. sequential, not racing).
- [ ] If the step is unchanged from last run, status pill stays neutral grey + a small `(cached)` chip.
- [ ] Hovering the pill shows tooltip: timestamp of last successful run.


## 2. UI Fixes

Smaller, scoped changes — none of these are new features.

| # | Area | Bug / change | Repro / where | Status |
|---|---|---|---|---|
| 2.1 | (fill in) | (fill in) | | ⬜ |
| 2.2 | | | | ⬜ |
| 2.3 | | | | ⬜ |

### Suggested rows to seed it (delete what doesn't apply):

- **Formula bar** — caret position survives `injectReference` from another column (no jump to start/end).
- **Formula bar** — Esc dismisses the autocomplete dropdown without blurring the editor.
- **Formula bar** — multiline paste is collapsed to a single line (we're single-line UX).
- **Formula bar** — `Tab` accepts the highlighted autocomplete suggestion (instead of inserting a tab char).
- **Step header** — clicking the colored arrow toggles maximize, not expand (verify).
- **Step header** — operation-name dropdown shows full description on hover.
- **File tree** — single-click on a workflow opens it in a tab (today single-click does nothing visible, only double-click works).
- **File tree** — currently-active workflow row is highlighted.
- **Tabs** — middle-click closes a tab.
- **Tabs** — Ctrl/Cmd-W closes the active tab.
- **Tabs** — Ctrl/Cmd-S saves the active tab.
- **Sidebar collapse** — clicking the activity-bar icon for the *currently active* view collapses the sidebar (verify today's behavior).
- **Execution log** — auto-scroll to bottom on new entry, unless the user scrolled up.
- **Execution log** — clear button confirms before wiping.
- **Save modal** — Enter submits, Esc closes.
- **Command palette** — recently used commands surface first.
- **Toolbar** — Run/Pause/Stop buttons disable themselves when no steps exist.

---


