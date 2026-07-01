---
target: node-graph editor (src/graph)
total_score: 32
p0_count: 0
p1_count: 0
timestamp: 2026-06-19T18-38-27Z
slug: src-graph-node-graph-editor
---
# Critique: Node-Graph Editor (src/graph) — refresh

## Design Health Score

| # | Heuristic | Score | Δ | Key Issue |
|---|-----------|-------|---|-----------|
| 1 | Visibility of System Status | 3 | — | Reactive recompute, Alerts HUD, error values, load overlay |
| 2 | Match System / Real World | 3 | — | Excel parity + tooltips strong; node paradigm still a leap |
| 3 | User Control and Freedom | 3 | — | Undo/redo, copy/paste, Escape-reverts, delete |
| 4 | Consistency and Standards | 3 | +1 | Theming-bug drift fixed (table/frame/slider), status palette documented, button fonts unified globally |
| 5 | Error Prevention | 3 | — | Typed sockets, draft-commit; standoff 30px floor adds a guard |
| 6 | Recognition Rather Than Recall | 4 | — | Legend, tooltips, searchable Add menu, Function Reference |
| 7 | Flexibility and Efficiency | 4 | +1 | New single-key shortcuts (A/G/T/E/F/C/I) + add-node hotkey |
| 8 | Aesthetic and Minimalist | 3 | — | Cleaner now that drift colors are largely tokenized |
| 9 | Error Recovery | 3 | +1 | Error badge hover now surfaces the plain-language meaning + fix |
| 10 | Help and Documentation | 3 | — | Shortcuts overlay refreshed (now documents A, I, Esc) |
| **Total** | | **32/40** | **+3** | **Good** |

## Anti-Patterns Verdict
**Does this look AI-generated? No.** Real semantic token system, deliberate accessibility stance, zero SaaS-template tells.

**Deterministic scan:** 96 findings (was 147) — 95 design-system advisories + **1 real** anti-pattern (down from 2). The `transition: width` layout animation is resolved; only the Markdown blockquote `border-left: 3px` remains, and that's a neutral-toned typographic convention, not the decorative colored stripe the rule targets (won't-fix). No browser overlay this session (no automation available).

## What Moved Since the Last Run (29 → 32)
- **Token-drift theming bugs fixed** — table/frame/slider display cells used hardcoded inline colors invisible in light mode; routed to `--text*`/`--border`. (Consistency 2→3.)
- **Error recovery** — the `#CODE!` badge hover now appends the plain-language meaning + fix from `ERROR_EXPLANATIONS`. (Error Recovery 2→3.)
- **Efficiency** — graph actions are now single keys (A add, G group, T tidy, E expand, F autofit, C cleanup, I isolate); Add node gained the `A` accelerator. (Flexibility 3→4.)
- **Accessibility** — `--text-muted` lifted to clear WCAG AA 4.5:1; count badges use theme-aware ink; a global button-font rule fixed every control's typeface.

## What's Working
- Typed sockets encode meaning twice (color + shape) — exemplary, colorblind-safe.
- Recognition-over-recall on-ramp for spreadsheet users is near best-in-class.
- Restraint: color is spent on data and state, not decoration — and the drift that undercut this is largely gone.

## Priority Issues (now minor)
- **[P3] Blockquote side-stripe** (Markdown.css:35) — deliberate convention; leave or restyle as a full-border quote if strict.
- **[P3] Remaining drift advisories (95)** — mostly legitimate (chart palette, semantic colors not yet in DESIGN.md). A documented-vs-drift pass would quiet the detector and harden the system, but no user-visible defect.
- **[P2, unverified] Keyboard-graph affordances** — single-key shortcuts help, but whether canvas nodes are tab-focusable with a visible focus ring is still unconfirmed without browser testing. Worth an `audit` with the app running.
- **[P3, unverified] New ink count badges in light theme** — `--accent-ink` flips per theme; confirm the alert badge (fixed red bg) still reads in light mode.

## Persona Red Flags
- **Alex (Power User):** materially better served now — single-key ops, add-node hotkey. Gap remaining: no bulk property edit across a multiselection.
- **Sam (Accessibility):** font + shape-coded sockets excellent; `--text-muted` now AA. Open: canvas focus rings / keyboard cable creation (needs live verification).
- **Morgan (Spreadsheet Analyst):** error values now self-explain on hover — a real win for first-timers. Empty-canvas first-run is moot (Getting Started seed loads).

## Questions to Consider
- Is the token system worth a lint guard so drift doesn't re-accumulate after this cleanup?
- Should the remaining semantic/chart colors be promoted into DESIGN.md to retire the advisory noise?
