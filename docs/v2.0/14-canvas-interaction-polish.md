# Bundle 14 — Canvas & interaction polish

**Source:** scope-features #37, #38, #39, #40, #41, #57(b). All IN. Plus a pointer to
`v1.1-plan.md` WS-C, which is already fully planned and covers the rest of this territory
(grid system, cable collision avoidance, minimap position, palette editor). **Depends
on:** none of these depend on each other or on anything else in this plan set — build in
any order, parallelize freely across agents.

---

## #37 — Quick-wire: drop a cable on empty canvas, get the next node (IN, with conditions)

**Required pairing (author's explicit conditions, don't ship without them):**
1. Must be a **Settings toggle**, not forced on for everyone.
2. Must pair with a pass on **socket hit-target sizes** — the current 12×12 socket box is
   small for a drag-release gesture to land cleanly.
3. Must pair with a more appropriate **pointer/cursor icon** while hovering/dragging over
   a socket — distinct from ordinary hover, signaling "release here to wire."

**Build:** drag a cable off an output, release on empty canvas → the Add menu opens right
there, filtered to nodes that accept that socket's type, and the pick lands pre-wired.
The connection plugin already reports the drop and the socket's type
(`Canvas.tsx:2110`, today just resets the drag flag) — the menu + auto-wire is the actual
work.

## #38 — The command palette (IN — Enter key, not Ctrl+K)

**Explicit UX (author's correction from the doc's own Ctrl+K framing):** trigger is
**Enter**, not Ctrl+K. Renders as a **bottom-aligned bar**, not a centered modal, and is
**NOT persistent** (appears on demand, closes after use) — unlike AutoCAD's always-visible
command line, though it borrows that visual/positional feel.

**Implementation note:** bare Enter needs the same "ignored while typing" discipline the
existing single-key graph shortcuts already use, so it doesn't hijack committing a text
field via Enter.

**Build:** one box for add-node, run-command (tidy/calculate/etc.), open-document,
jump-to-node-by-name, toggle-a-setting — each showing its shortcut inline. Reuse the Add
menu's existing fuzzy scoring for the node half.

## #39 — Scrubbing: drag any number, watch the model move (IN)

**Build:** click-drag horizontally on any numeric literal sweeps its value with the graph
updating live, riding the targeted-recompute path (already cheap) and the same machinery
a slider drag already uses. Modifier keys change step size; Escape reverts — extend the
draft-commit contract (`useDraftCommit`) to a drag gesture rather than inventing a new
commit model.

## #40 — Semantic zoom (IN — optional, very conservative trigger)

**Explicit conditions:** a Settings toggle, and the simplified-card swap must only
trigger when genuinely far out (near the orbit end of the zoom range) — not an
aggressive early switch at moderate zoom-out.

**Build:** at low zoom, swap node cards for a simpler representation (colored block +
big label: name + value), groups become titled regions, cables thicken into flows. The
HTML-canvas renderer's mip pyramid already reports LOD per zoom
(`htmlCanvasRenderer.ts`) — reuse that signal to decide when to swap, rather than
introducing a second zoom-tracking mechanism.

## #41 — Conditional formatting for tables (IN — own design pass, sequence LATE)

**Explicit conditions (don't build without a dedicated design pass first):**
1. Ours must be **much better than Excel's** — author explicitly dislikes Excel's own
   implementation; "parity with a twist" is not sufficient bar-clearing here.
2. Attach **ONLY to Display nodes** — not baked into every frame/popup-grid view directly.
3. Must **NOT overlap Format Controller's territory** — text format and units stay FC's
   job (bundle 05); this is visual highlighting only (data bars, color scales, threshold
   icons).
4. **Design deep-dive required first** — there are enough open decisions (what "much
   better than Excel" concretely means, the rule-authoring UX, how it composes with FC)
   to warrant its own session, not a quick implementation.

**NEEDS AUTHOR INPUT:** the design session itself, before any code. Bring concrete
mockups of data bars / color scales / threshold icons and the rule-authoring UX for
sign-off.

**Build (post design session):** data bars, color scales, threshold icons in frame views
(popup grid + column chips), driven by rules or by an Expect node's pass/fail (bundle
11's #12). Respect the Quiet Accent Rule (fills within grid cells, not decorative chrome).

## #57(b) — Multi-node operations: align/distribute, batch expand/collapse (IN)

**Explicit scope split (don't build the OUT half):** (a) paste-anywhere-on-canvas is
OUT — not part of this item. (b) align/distribute + batch collapse/expand-these ARE in.
**Wrap-in-subgraph is explicitly NOT part of this gesture** — subgraph creation needs its
own deliberate action (bundle 09's own design session), not a quick multi-select
shortcut, because a subgraph has different compute semantics and is less editable than a
Group.

**Build:** operations over a canvas selection — align/distribute (visual tidiness short
of a full Tidy pass), batch collapse-these / expand-these. The graph equivalent of a
shape-editing toolbar, exposing operations the existing group/collapse/selection
primitives already support.

---

## Also see: `v1.1-plan.md` WS-C (already fully planned, build as written)

Covers the rest of the canvas/interaction territory and doesn't need re-planning here:
- **Grid system** (`docs/grid-system.md`) — soft alignment guides, primary+sub-grid.
- **Cable collision avoidance** (avoid-nodes, avoid-cables, per-cable overrides) — the
  routing-quality extension deferred from `cable-routing.md` §2. Guard rails: LENGTH
  stays the primary sort key in `cablePaths.ts`; `cablePaths.test.ts` continuity must
  stay green; never degrade cable fidelity during drag/pan/zoom (standing rule).
- **Minimap position** — a 3-way setting (Bottom/Top/Hide) replacing the current boolean.
- **Palette editor** — the app-wide "Custom…" palette editor (per-document palette editing
  is a separate, later Document Properties surface).

## Exit criteria

Quick-wire ships as a Settings toggle with the socket-size + cursor pass shipped
alongside it (not deferred); the command palette triggers on Enter as a bottom bar;
scrubbing works on any numeric literal with modifier-key step control and Escape revert;
semantic zoom is a Settings-gated, conservative-threshold LOD swap; conditional
formatting is NOT built until its design session has author sign-off; align/distribute
and batch collapse/expand ship, explicitly without paste-anywhere or wrap-in-subgraph.
