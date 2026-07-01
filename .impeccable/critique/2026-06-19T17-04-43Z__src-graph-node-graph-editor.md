---
target: node-graph editor (src/graph)
total_score: 29
p0_count: 0
p1_count: 1
timestamp: 2026-06-19T17-04-43Z
slug: src-graph-node-graph-editor
---
# Critique: Node-Graph Editor (src/graph)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Reactive recompute, Alerts HUD, error values, load overlay all communicate state; status of long compute could be clearer |
| 2 | Match System / Real World | 3 | Excel parity + Excel-equivalent tooltips are strong; the node paradigm itself is still a leap from cells |
| 3 | User Control and Freedom | 3 | Undo/redo, copy/paste, Escape-reverts-edit, delete all present |
| 4 | Consistency and Standards | 2 | Real token drift: ~140 one-off hardcoded colors/radii bypass the semantic token ramp |
| 5 | Error Prevention | 3 | Typed sockets block invalid connections; draft-commit prevents stray propagation |
| 6 | Recognition Rather Than Recall | 4 | Socket legend, tooltips, searchable Add menu, Function Reference, node-type hints — genuine strength |
| 7 | Flexibility and Efficiency | 3 | Shortcuts, lasso, tidy, collapse, minimap; no command palette / bulk property edit |
| 8 | Aesthetic and Minimalist | 3 | Quiet, restrained chrome; the drift colors undercut the discipline |
| 9 | Error Recovery | 2 | #CODE! tokens are Excel-familiar but cryptic to first-timers without hover explanation |
| 10 | Help and Documentation | 3 | Function Reference (Ctrl+/), tooltips, legend; no task-oriented onboarding |
| **Total** | | **29/40** | **Good** |

## Anti-Patterns Verdict

**Does this look AI-generated? No — emphatically.** This is a distinctive, opinionated instrument with a real semantic token system, a deliberate accessibility stance (Atkinson Hyperlegible, shape+color typed sockets), and zero SaaS-template tells: no purple gradients, no hero-metric cards, no glassmorphism, no identical card grid.

**Deterministic scan:** 147 findings — 140 advisory, 7 warning.
- 140 advisories = design-system drift (colors/radii/fonts outside DESIGN.md). Mostly expected against a freshly-written curated token list, but it surfaces a real consistency problem (below).
- 2 genuine anti-patterns: a side-stripe `border-left: 3px` (Markdown.css:35), and a `transition: width` layout animation (LoadOverlay.css:60).

**Visual overlays:** none — no browser automation in this session, so no live in-page overlay was injected. Findings are from source review + the CLI detector only.

## Overall Impression
A serious, well-built instrument that already avoids every common AI-design trap. Its weakness is internal discipline, not taste: a large amount of styling bypasses its own excellent token system with hardcoded one-off colors, several of which won't flip correctly between dark and light themes. Tightening that drift is the single biggest win, and it's mechanical, not creative.

## What's Working
- **Typed sockets encode meaning twice** (color AND shape), so type is legible at a glance and survives color-blindness. Exemplary.
- **Recognition over recall** is near-best-in-class: legend, Excel-equivalent tooltips, searchable Add menu, Function Reference. A spreadsheet user has a real on-ramp.
- **Restraint.** Chrome recedes, color is spent on data, nothing decorative competes with the graph.

## Priority Issues

- **[P1] Palette / token drift bypasses the design system.** ~72 distinct undocumented colors and ~68 off-scale radii are hardcoded across node components. Hardcoded neutrals (#888, #aaa, #ccc, #ddd) and blues (#4c8bf5, #9ecbff) don't participate in the dark/light token swap, so they risk reading wrong in light theme and violate the "mirror every token" rule.
  - **Fix:** Route neutrals through `--text-*`/`--border-*`; promote legitimate semantic colors (alert red, chart hues) into DESIGN.md + the sidecar so they're documented, not drift.
  - **Suggested command:** `/impeccable colorize` (or `/impeccable polish`)

- **[P2] Side-stripe border in Markdown blockquote.** `border-left: 3px solid` (Markdown.css:35) is an absolute-ban pattern — the one real slop tell in the codebase.
  - **Fix:** Replace with a full 1px border + background tint, or leading typographic mark.
  - **Suggested command:** `/impeccable polish`

- **[P2] Error values are Excel-cryptic for first-timers.** `#SHAPE!`, `#CIRC!`, `#CODE!` match Excel but a non-expert needs the meaning surfaced at the point of failure (hover/inline), not just the code.
  - **Fix:** Ensure every error token has a hover/inline plain-language explanation and a suggested fix.
  - **Suggested command:** `/impeccable clarify`

- **[P3] `transition: width` on the load overlay.** Animating a layout property can jank; prefer transform/clip-path.
  - **Fix:** Animate `transform`/`clip-path`/`opacity` instead.
  - **Suggested command:** `/impeccable optimize`

- **[P3] Radius scale sprawl.** 10 distinct radii in use (1.5/2/3/5/6/7/9/10/11/12px) against a documented 4/8/999 scale.
  - **Fix:** Collapse to the documented scale or extend the scale deliberately.
  - **Suggested command:** `/impeccable polish`

## Persona Red Flags

**Alex (Power User):** Well served — shortcuts, lasso, copy/paste, tidy. Gaps: no command palette to add a node by keyboard without the mouse; no bulk property edit across multiselected nodes.

**Sam (Accessibility-Dependent):** Font + shape-coded sockets are excellent. Risks: graph editing looks mouse-first — unclear whether nodes are tabbable, whether cables can be created keyboard-only, and whether canvas nodes show a visible focus ring. `--text-muted` (#6b7177) on sunken surfaces is near the 4.5:1 floor for body text; verify.

**Morgan (Spreadsheet Analyst — project persona):** Excel-equivalent tooltips and the Function Reference are the on-ramp. Red flag: the first-run leap from "type =A1*B2 in a cell" to "drag nodes and wire cables" has no guided moment; an empty canvas may read as "now what?".

## Minor Observations
- 5 undocumented font-family declarations (likely Markdown/KaTeX) — confirm intentional, document if so.
- Many advisories are legitimate semantic colors (alerts, charts) that simply aren't in DESIGN.md yet; documenting them will quiet the detector and harden the system.

## Questions to Consider
- Could the empty canvas itself teach the first node + first cable, instead of relying on the Reference?
- Should error tokens always carry their explanation inline, so hover isn't required to understand a failure?
- Is the token system enforceable (lint) so drift doesn't re-accumulate after a cleanup?
