---
aliases: ["Resizable-content nodes"]
tags: [spec, canvas]
---
<!-- [[C37]] observerOwnsSize -->

# Spec: Resizable-content nodes

Serves [[C37]] observerOwnsSize. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Some nodes render content whose size changes with live input: a slider, a drag, a growing list. For these, the **node body stays a constant size** (it is the node's hit area and the `offsetParent` its contents position against), and the visible content overflows it. The node's top-left corner then never moves as the content changes, so nothing has to re-center it.

Any inspector toolbar must not ride on the changing content. The Conduit's toolbar is portaled out of the canvas transform entirely (`createPortal` in `ConduitComponent.tsx`) into a viewport-fixed dock (`.solenoid-conduit-toolbar--docked` in `conduit.css`): 14 px from the left and 15 px above `--chrome-bottom`, moving to 272 px from the left while the Navigator panel is open on desktop. Neither zoom nor content changes can move it. It shows only while the Conduit is selected.

## The Conduit

The Conduit is the one node built this way today.

- The body is a fixed `CONDUIT_BODY_SIZE` (92) square. The pivot is its center.
- The housing and lane sockets are drawn from the pivot with `overflow: visible`. Sockets are absolutely positioned and may extend outside the body.
- Collapsing and expanding changes a real layout scale (0.6 collapsed, 1 expanded) applied to every dimension, not a CSS transform, so socket positions stay truthful.

**The constant body is a pivot box, never a hit target.** It is much larger than the block it wraps, so an invisible 92 square would out-rank the cables, standoffs and canvas under it.

- `nodeClassName` (`flow/flowModel.ts`) marks the React Flow wrapper `sol-conduit-node`, and `flow.css` makes it pointer-transparent with `!important`, because React Flow stamps `pointer-events: all` inline on every selectable wrapper. The `.solenoid-conduit` root is pointer-transparent too.
- Pointers land only on what is painted: the shell shapes, plus the lane squares while the block is expanded.
- A compressed (collapsed) lane takes the `solenoid-conduit__lane--inert` class, which also reaches React Flow's Handle inside it. Without it, the bunched squares cover the whole block, every press starts a cable drag, and the block can never be grabbed.
- The **grab handle** is the shell's top slice, `HANDLE_H` (12) tall. Its height does not take the collapse scale. It is the one strip no cable crosses, so it stays a grab target at any lane count or zoom.

## What not to do

- Do not size the body to fit the variable content. When the body grows, the toolbar and top-left position shift and the node jiggles.
- Do not try to pin the visible center by translating the node in `useLayoutEffect`. `area.moveNode` is async (it awaits a guard pipe), so its DOM update does not land in the same paint as React's commit, and the node flashes for one frame.
