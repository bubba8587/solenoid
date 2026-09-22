---
aliases: ["Conduit lane faces"]
tags: [spec, canvas]
---
<!-- [[D17]] relaysTransparent -->

# Spec: Conduit lane faces

Serves [[D17]] relaysTransparent. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A Conduit is a rotatable block of lanes. Each lane is a pair of square sockets: input `in_i` on one face and output `out_i` on the opposite face, with the value passing straight through. This spec says where those faces and squares sit and which way cables leave them. The geometry lives in `ribbonCable.ts` (`conduitLaneOffset`, `conduitLanePoint`, `conduitFacePoint`) and `components/ConduitComponent.tsx`; the body box is covered in [[resizable-content-nodes]].

## Rotation

- The block's angle is `ConduitNode.angle`, in degrees clockwise from +X, always snapped to a multiple of 45° and kept in [0, 360). Off-45° angles make the diagonal cable shape look bad.
- It changes from the toolbar's angle dial, or with `[` and `]` on a selected Conduit (`rotateBy`, one 45° step each). The component reads the angle from the node on every render, with `conduitAngleStore` as the re-render signal, so a rotation from outside the component shows at once.

## Faces

There is **no flip rule**. Inputs sit on the block's local **−x** face and outputs on its **+x** face, and both simply rotate with the block. Any code that picks a face by the sign of the angle is dead and should be deleted.

In the block's local frame, before rotation:

- Every size is a base value times the current `scale`: 1 when the block is expanded, 0.6 when it is collapsed. The square is `CONDUIT_SQ` (10); the gap between the columns is `CONDUIT_COL_GAP` (1.5); the gap between rows is `CONDUIT_ROW_GAP` (1.5).
- The input column's center is at x = −(SQ + COL_GAP) × scale / 2, and the output column's center at the same distance on +x.
- Lane `i` of `lanes` sits at y = (i − (lanes − 1) / 2) × (SQ + ROW_GAP) × scale, so the lanes are centered on the pivot.

The point is then rotated by the angle about the pivot, the center of the body square. Each painted square is also rotated by the angle about its own center.

## One lane geometry

`conduitLaneOffset` is the only lane geometry. The component paints each square on it, and `conduitLanePoint` puts each cable tip on it, so a tip can never drift off the square it plugs into.

- A cable tip lands on the **center** of its lane's square, not on its rim ([[C7]] authorRuled).
- Tip positions are computed, never measured. React Flow's stored handle box is wrong for a Conduit twice over: it re-measures only on a node version bump, so an expand or collapse leaves it on the old geometry; and it is the bounding box of the rotated square, which is up to √2 larger off-axis.
- A cable can arrive one frame before the component republishes its lane count, so the lane index is clamped to the last lane.
- `conduitFacePoint` gives a ribbon trunk's attachment point: the pivot plus or minus the column offset along the angle, for the output or input face (see [[cable-rendering-knobs]]).

The component publishes `{ angle, scale, selected, lanes }` to `conduitLayoutStore` whenever any of them changes, and clears it on unmount. Tips and trunks read that store. It also calls the view's `rerenderNode` when the angle, scale or lane count changes. That bumps React Flow's handle measurement, so the lane squares are drop targets where they are painted rather than at their collapsed positions.

## Cable direction

For every one of the `CONDUIT_MAX_LANES` (8) lanes, the component writes the snapped angle to `cableAngleStore` for both `in_i` and `out_i`, and clears them on unmount. An output cable therefore leaves the +x face heading along the angle, and an input cable arrives into the −x face heading along the same angle. Both are perpendicular to their face.

## Lane count and expansion

- The block shows as many lanes as the highest wired lane index plus one, counted in the Conduit's own graph (a Conduit inside a drill-in counts its drill-in cables). It always shows at least one lane, so a fresh Conduit has a socket to grab.
- The block expands when it is selected, or while a cable is being dragged with the pointer within 140 px of it. During such a drag, if fewer than 8 lanes are used, one extra phantom lane appears to receive the new cable.
- When the wired lane count changes, the graph recomputes so downstream nodes pick up the new lanes. It skips this during a graph rebuild, whose own final pass recomputes everything.
- The block renders behind the cables (`z-index: -1` on its node holder), so cables plug in over the squares.

## Extending

The toolbar's extend action adds a new Conduit in the same graph, with the same angle, 130 px further along the angle, and wires each used lane `out_i` to the new block's `in_i` (at least one lane).
