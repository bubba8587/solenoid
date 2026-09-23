---
aliases: ["Group collapse"]
tags: [spec, canvas]
---
<!-- [[C88]] collapseIsVisual -->

# Spec: Group collapse

Serves [[C88]] collapseIsVisual. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Collapsing a group shrinks it to a small card that shows the group's results as readout rows. Collapse is visual only: members stay wired and keep computing. This spec covers what is hidden, which readouts the card shows, and how the camera finds a node inside a collapsed group.

## What collapse hides

`recomputeGroupCollapse()` (`groupCollapse.ts`) rebuilds the collapse state for every collapsed group at once. `syncGroupCollapse` calls it.

- **Hidden nodes.** Every member is hidden, along with any FC docked to a member (the group's "extended members"). A docked FC collapses with its host, and everything downstream treats it exactly like a member.
- **Hidden cables.** A cable is hidden only when both ends are hidden in the same collapsed group. A cable that crosses the group's edge stays visible and is redirected to a pill on the card: outbound cables to a pill on the right, next to that value's readout row, and inbound cables to a pill on the left, one per member input. A cable between two different collapsed groups stays visible and runs between both groups' pills.
- **Conduit bundles.** Outputs of a hidden Conduit that land on one external destination share one combined row and pill, so their cables draw as a single ribbon; a combined row shows the lane count instead of one lane's value. Inbound cables from one external Conduit likewise share one left pill, since their ribbon trunk ends whole and needs one anchor. The bundling destination is derived from membership, not from the order pills are computed in, so a first pass maps every hidden member to its group, for every collapsed group, before any group is processed: bundling needs to know whether a target is hidden in a different collapsed group.

**Pills.** A pill is keyed by the socket it stands in for (`nodeId::socketKey`), not by a connection, so a cable being dragged out of an output pill redirects to the pill instead of anchoring at the hidden member's origin. A pill's index is its row, which sets its vertical offset; the row gap must match the `.solenoid-group__summary` flex `gap` in GroupNode.css, or cable ends drift a gap further off with every row down.

**Settling cable ends** (`settleCollapse`). Pills reuse the members' socket keys, so an expand re-renders the members a frame before re-measuring, and a collapse must not re-render them, which would clobber the pills' positions. A docked FC gets the same treatment even when it was never absorbed as a member, since a retained Display-to-FC hop registers a pill on the FC's `out` socket.

**How hiding is applied.** `flowModel.nodeClassName` adds `sol-member-hidden` to each hidden member, and flow.css turns that into `visibility: hidden !important` (with pointer events off). `FlowSurface` re-stamps the classes when the collapse store notifies. React Flow owns the wrapper's inline `visibility` and writes `visible` after measuring, so writing visibility on the element directly does not stick; a class rule does. Hiding uses `visibility`, never `display`, because a hidden member must stay laid out, or its measured size and socket positions drop to zero.

## Which readouts the card shows

A readout row shows one of the group's terminals: a value that leaves the group or goes nowhere. Rows are built in three passes.

1. **Display members.** A Display is the special visible readout. Its "effective output" is its own `out`, unless the Display feeds a Format Controller (FC) that is also a member; then the FC's `out` is the effective output (the Display stays the visible readout and the FC is hidden). The Display gets a row when its effective output has no connection, or has any connection that leaves the group.
   - Display → nothing: shown.
   - Display → FC → outside: shown, as the Display.
   - Display → FC → inside only: no row.
2. **Other outputs that cross the edge.** Any other member output socket with a cable leaving the group gets a generic row: the member's label and its live value from `cableValueStore`. There is one row per source socket. Two refinements apply only in `recomputeGroupCollapse`:
   - if the value's source already feeds a shown Display, the crossing gets a pill on that Display's row instead of a second row;
   - for a Conduit lane, the row is labeled with the node that feeds the matching input lane, since that is where the value comes from.
3. **Leaf members.** A member that has an output socket but no outgoing cable at all gets a generic row for its first output. A value that goes nowhere is a terminal too.

A member whose outputs all feed members only is hidden with no row. Members already shown in pass 1 (a Display and its FC hop) are not counted again.

`groupReadouts()` computes the same rows for a pinned group without collapsing it (used by `PinLayer`). It runs the same three passes but skips Conduit bundling and the two pass-2 refinements above. Keep the passes in the two functions matched.

## Camera targets across collapsed groups

`flyToNode.ts` serves every "go to this node" caller: the pins and alerts HUD, the cable inspector and Presentation. It is drill-in aware: a node inside an open composite moves the drill-in's camera.

- **Resolve a visible target.** A node hidden in a collapsed group has no visible element, so framing it would target a stale point near (0,0) and jump the view off-screen. Before framing, `resolveVisibleTarget` walks up from the node to its group for as long as the target is still hidden.
- **Frame a collapsed group by its rendered size.** `zoomAt` frames `node.width` / `node.height` whenever they are defined, but a collapsed group still carries its expanded dimensions. So a collapsed group is passed as a sizeless reference (only its id), and `zoomAt` falls back to the rendered element's size. Plain nodes pass the real node.
- `flashNode` flashes the same resolved target, so a node inside a collapsed group lights up its group card.

The minimap draws from React Flow's own node set, with colors from `minimapFillForNode`. The fit-all math in `NavMenu` uses `collapsedAwareNodesRect`, which sizes collapsed groups the same way.
