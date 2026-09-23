---
aliases: ["Standoffs"]
tags: [spec, canvas]
---
<!-- [[C89]] standoffsSolveLast, [[C65]] domOrderStacking, [[C112]] noOverlapsEver -->

# Spec: Standoffs

Serves [[C89]] standoffsSolveLast; the layer's stacking is [[C65]] domOrderStacking. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A standoff is an arrangement constraint the user declares between two items on the canvas: "keep these two between this distance and that distance, in this direction." It draws as a pale, thick bar between the two items. Standoffs are a main-canvas feature; the composite drill-in has none.

## What a standoff links

A standoff links two top-level items: loose nodes or groups. Conduits, Format Controllers (docked or not) and group members can't be linked. Each end names an anchor on its item's box, one of eight: a side midpoint (`n`, `e`, `s`, `w`) or a corner (`ne`, `nw`, `se`, `sw`). The two ends always use opposite anchors, so the bar spans the pair. A pair can have at most one standoff.

The model is `standoffs.ts` (`Standoff`, `standoffStore`); the saved form is `SavedGraph.standoffs`, including `locked`.

## The constraint

The direction runs from end a's anchor toward end b (`ANCHOR_DIR[a.anchor]`, a unit vector along one of the eight directions). Measure the distance between the two anchor points along that direction. The constraint holds when

`min ≤ dot(P_b − P_a, axis) ≤ max`

where `P_a` and `P_b` are the anchor points. This is an axis band: only distance along the axis is constrained.

- **Unlocked.** The offset across the axis is free. The bar slants to show that slack.
- **Locked.** The solver also pulls the cross-axis offset to 0, so the two anchors line up exactly along one of the eight directions. New standoffs are locked by default; the toolbar's Lock toggle turns it off.
- **Floor.** `min` is never below `STANDOFF_MIN` (30), and `max` is never below `min`. Both `add` and `setBand` enforce this.
- **Direction.** The toolbar's angle dial sets the direction. `setAxis` changes a's anchor and gives b the opposite one.

## Creating one

Select exactly two linkable items, right-click one of them, and choose "Link with Standoff" (`linkStandoffBetween` in `canvasActions.ts`). The item must not already be linked to the other.

1. The anchor faces along whichever of the eight directions is closest to the line from a's center to b's center (`anchorFromVector`, by angle, with 0° east and y pointing down); b takes the opposite anchor.
2. The band starts at `min` = `STANDOFF_MIN` (30) and `max` = the current distance along the axis (or 30, if that is smaller). The code asks for `min(PUSH_GAP, distance)`, which is always below the floor, so the floor sets it.
3. The new standoff is locked, becomes the selection (clearing node and cable selection), and is settled right away, so the pair snaps into alignment.

## The solver runs last

`solveStandoffs` (`standoffSolver.ts`) is pure and unit-tested. The canvas registers the live settle routine that drives it (`setStandoffSettle`). It takes plain boxes, the standoffs, a set of pinned ids and an optional `forceLock`, and returns a displacement per box.

- It is iterative projection: up to 48 rounds, each correcting every active standoff in turn, stopping once no correction exceeds 0.25px.
- Each correction splits evenly between the two ends. If one end is pinned, the other takes all of it. A standoff with both ends pinned is skipped.
- `forceLock` treats every standoff as locked for that one solve, without touching the saved `locked` flag. Every layout operation uses it, so a cluster of items joined by standoffs (`standoffClusters()`, the connected groups) behaves as one rigid block.
- Position-locked groups are always pinned (`withLockedGroupsPinned`).

The solver runs as the last step after every pass that affects layout ([[C89]] standoffsSolveLast):

| Pass | When and how |
|---|---|
| Live drag | Only when a dragged item (or a member of a dragged group) is linked; ties are sparse, so a plain drag costs nothing (`standoffStore.participants()` gates the work). Once per animation frame during the drag, and once more exactly on drop, with the dragged items pinned. Band only, never `forceLock`, so an unlocked slant survives a drag. Programmatic moves never trigger it. |
| Group expand | Inside `runExpandPushes`. After the push heuristics, each cluster moves as one block: every member takes the cluster's largest displacement, so a lone push isn't pulled partway back. Then a `forceLock` solve, with its corrections folded into the push records so a later collapse restores them too ([[group-expand-push]]). |
| Group collapse | After the pushes are restored, a `forceLock` re-solve, because the shrink moved the anchors. |
| Autofit | `autofitGroupWithHistory` re-solves with `forceLock`, pinning the fitted group. |
| Tidy | A final `forceLock` settle after layout. |
| Toolbar edits | A band, lock or angle change settles at once. |

Every layout pass in the table except the live drag and toolbar edits then ends with the no-overlap pass ([[C112]] noOverlapsEver). It moves each standoff cluster as one unit, so it never breaks a band.

## Tidy and clusters

Tidy lays out each cluster of loose items as a single ELK super-node (`makeArrangeFn` in `tidyArrange.ts`; `FlowCanvas` only wires it in). ELK is the automatic layout engine behind Tidy.

1. A cluster qualifies only if every member is a loose target of this Tidy.
2. The leader is the member nearest the top-left (by `x + y`), preferring a non-group.
3. ELK sees the leader as one rectangle the size of the cluster's bounding box, so it reserves room for the whole block. The size is presented through a proxy object, so the real node is never resized.
4. Edges to other members are remapped onto the leader, as node-level edges (the same way edges to a group are treated).
5. After layout, every member is placed at its stored offset from the leader's new position.

Without qualifying clusters none of this runs, so a graph with no standoffs tidies exactly as it would otherwise. A cluster that doesn't qualify (for example, one that reaches into a group's interior) is handled by the final `forceLock` settle instead.

## Drawing and selection

`StandoffLayer` draws the bars in an SVG inside React Flow's `<ViewportPortal>`, so they move with the camera. The main canvas mounts it (the host's `standoffs` hook); the layer redraws on standoff changes, on layout ticks (`standoffLayoutTick`, which the canvas bumps whenever positions or sizes may have changed, so the layer re-measures) and on collapse changes.

- Each bar is a 9px line between the two anchor points of the items' live boxes, with a small cap circle at each end. A wider invisible line (18px) is the hit target.
- **Stacking.** [[C65]] places the bars at −3 in the stacking ladder, below groups (−2), Conduits (−1) and ordinary nodes (0). `nodeZIndex` in `flowModel.ts` stamps the nodes (groups −2, Conduits −1, the rest 0); the standoff SVG sets its own `z-index: -3` in `StandoffLayer.css`. Both sit in the viewport's stacking context, so a card dragged over a bar covers it even though the viewport portal comes after the node layer in the DOM.
- Clicking a bar selects it and clears node and cable selection; clicking a selected bar deselects it. A standoff selection is always exclusive with node and cable selection. The bar stops `pointerdown` and `mousedown`, so a press on it never pans or starts a lasso.
- A selected standoff shows a docked toolbar: the min and max of the band (each committing on Enter or blur via `useDraftCommit`), the 45° Lock toggle, the angle dial, and a delete button. The Delete key also removes it.
- Deleting either end's node removes the standoff (`registerNodeForget`); a full rebuild clears them all (`registerNodeForgetAll`).

## Known gaps

- An end hidden inside a collapsed group makes the standoff dormant: the bar is hidden and the constraint is skipped.
- A cluster whose members aren't all in the loose layout falls back to the `forceLock` settle instead of the super-node path.
- Standoff edits don't record undo steps of their own.
- Tidy and Cleanup edge cases under heavy overlap have not been fully tested.

## In seeds

This is the author's rule for seed graphs: groups liberally, standoffs sparingly.

- A seed standoff only pins an unwired explanatory Note to what it explains.
- A Note wired through its frontmatter exports gets no standoff.
- A data node never has a standoff to its consumer. An exhibit and its Note go in one group instead (a Note can be a member).

Re-bake seeds with `scripts/tune-seeds.mjs` after editing. `decision-matrix.json` and `table-verbs.json` are the exemplars.
