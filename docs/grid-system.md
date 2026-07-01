# Solenoid — Grid System (design spec)

> **Status: FUTURE, unimplemented.** Written in the React Flow era; the ideas
> hold but two references have drifted: cable shapes shipped grid-free (the
> walk router in `cablePaths.ts` keys segments off socket positions and
> compass headings, not grid lines — wiring it to a grid is a real design
> question, not a toggle), and "double-click cable to insert a Conduit" became
> the Insert-Conduit cable action. Coordinate with `backlog.md` → Grid system.

Captured from user direction. For later — implement once the node
graph fundamentals are stable.

---

## Philosophy

Don't force snap. Don't make the user fight the grid. But every
spatial decision the *app* makes — new node placement, straight-cable
routing, Conduit positions, alignment helpers — *considers* a grid
(and possibly sub-grids).

The user should feel that things "land cleanly" by default without
ever feeling they couldn't put a node at an arbitrary position if
they wanted.

## Touchpoints

- **Node placement** — newly added nodes (via right-click, drag-to-empty,
  double-click cable) spawn at the nearest grid intersection. Free-drag
  is not snapped by default; hold a modifier to snap while dragging.
- **Straight-cable mode** — when the cable shape is "straight"
  (see `cable-routing.md`), cable segments run along grid lines and
  turns happen at grid intersections.
- **Diagonal-cable mode** — diagonals at 45° connect grid intersections
  to grid intersections.
- **Conduit node placement** — double-clicking a cable to insert a
  Conduit lands the new node at the nearest grid intersection along
  the cable path.
- **Alignment helpers** — eventual "align selected to grid" command;
  visual snap guides when dragging close to grid lines.
- **Comment/frame nodes** — corners snap to grid by default.

## Primary grid + sub-grid

Two levels:

- **Primary grid** — coarse spacing for typical node placement
  (~24 px to match the existing dotted `Background` gap is the
  obvious starting point).
- **Sub-grid** — finer spacing (primary / 4 or primary / 6) for
  precise placement, available when zoomed in or when a modifier is
  held.

The dotted Background already implies a grid visually. Make the snap
logic align with the visible dots so users get a "yes, those dots
are real" feedback.

## Modifier to bypass snap

A held key (e.g. `Alt` on Win/Linux, `⌥` on macOS) suspends all snap
behaviour — free placement at pixel precision. Same key works for
node drag, cable endpoint drag, and Conduit placement.

## Open questions

- Exact primary grid size. 24 px to match the background dots is a
  good starting point; test at typical zoom levels.
- Sub-grid divisor: 4 or 6?
- Grid in canvas coords (zoom-invariant) vs screen pixels (snap step
  scales with zoom). Canvas coords is almost certainly correct, but
  worth flagging.
- Visual indicator when snap is active vs suspended (modifier held).
