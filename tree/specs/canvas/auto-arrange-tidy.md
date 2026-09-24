---
aliases: ["Auto-arrange / Tidy"]
tags: [spec, canvas]
---
<!-- [[B10]] reactFlowView, [[D63]] lockedGroupIsObstacle, [[C89]] standoffsSolveLast, [[C112]] noOverlapsEver -->

# Spec: Auto-arrange / Tidy

Serves [[B10]] reactFlowView; the position lock is [[D63]] lockedGroupIsObstacle, the size read is [[#Size reads]], standoff clusters are [[C89]] standoffsSolveLast. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

Tidy rearranges cards into a left-to-right (or top-to-bottom) flow using the ELK layered layout engine. It only moves cards; it never resizes them. Cleanup is a bigger pass built on Tidy: it tidies inside every group, fits and collapses the groups, then tidies the top level. Both live in `tidyArrange.ts` (`makeArrangeFn`, `makeCleanupFn`). The integration harness is `tidyArrangeGroups.test.ts`, which drives the real arrange and cleanup with real elkjs over a fake area that models the DOM contract.

## What Tidy guarantees

Tidy is an ELK layered layout, called directly, that only moves nodes. Ports sit symmetrically so two connected nodes line up; the result is anchored to the flow's leading edge and its cross-axis center; no layout pass leaves a fixed inline size on a card. A global Tidy keeps each group as a rigid unit and never enters it; a group's own Tidy arranges exactly that group's members.

Why: each of these closes a failure the opposite choice produced. rete-auto-arrange's `classic` preset put outputs at the top and inputs at the bottom, so every link staircased its target upward and the graph looked as if it floated high. Anchoring by the top-left corner dropped a flattened row to the top of the old footprint, the same symptom from the other side. And its applier stamped an inline height on every card, which froze it. Moving without resizing keeps cards content-driven, as [[react-flow-surface-contract#Node width and height]] demands of everything else. Symmetric ports and leading-edge anchoring give the same answer in either direction, so Cleanup's cycle of Tidy then autofit is a fixed point. **Reopen if:** ELK is replaced, or React Flow starts owning card sizes (then the guard that drops pinned sizes becomes the wrong tool).

## Entry points

- **Tidy** runs from the top-bar Tidy button, View ▸ Tidy in the menu bar, or the `T` key. It lays out the selection if there is one, otherwise the whole canvas. A selection that lies entirely inside one group becomes a within-group Tidy of that group. Above `TIDY_CONFIRM_THRESHOLD` layout units (docked FCs and group members do not count) it asks for confirmation first. The count uses the same predicate as `layoutTargets`, or the dialog would misstate the scope.
- **Group Tidy** is the button in a group's header. It runs a within-group arrange (`arrangeFn({ groupId })`), waits two animation frames so the deferred docked-FC snap-back lands, then autofits the box to its members. A locked group keeps its corner through the autofit: its members move to it instead.
- **Cleanup** runs from View ▸ Cleanup or the `C` key. Above `TIDY_CONFIRM_THRESHOLD` units it asks for confirmation first.
- The composite drill-in has its own arrange (`FlowCompositeOverlay.tsx`) that reads the same Tidy settings.

## Size reads

Every size read in the movement stack (tidy, push, standoffs, splice, align, autofit, focus, the Outline panel) goes through `measuredBox()` in `nodeSize.ts`. It never returns a zero size. Its tiers, in order:

1. React Flow's own measure of the mounted card (`view.measured`), which costs nothing; a DOM read forces a synchronous reflow after any pending write.
2. The live rendered size (`offsetWidth` / `offsetHeight`), once both are non-zero. Once a card has painted, the live DOM is the truth and already includes its collapse state.
3. The node's stored `width` / `height`, the ResizeObserver's mirror, supplied through the `editor` argument.
4. A default of `FALLBACK_NODE_W` × `FALLBACK_NODE_H` (180 × 100).

Tiers 3 and 4 are collapse-aware: an unpainted collapsed card reports `COLLAPSED_NODE_H` (52) as its height instead of its taller expanded one.

**MUST:** no feature reads `offsetWidth || node.width || 100` on its own. Separate reads disagreed exactly where it mattered: before first paint an unpainted member read as zero, which shrank a bounding box to its corner, and on a collapsed group the stored size is the taller expanded one (OutlinePanel, which tried the sources in the opposite order, once centered the camera on a collapsed group's expanded box).

A source sweep enforces it: a direct `offsetWidth` or `offsetHeight` read in a movement-stack module outside `nodeSize.ts` fails unless the line above carries `measuredBox exception:` and its reason. Five exceptions stand, each the same ladder with a different last step, and each goes away when `measuredBox` accepts a fallback from its caller:

- `zoomAt.frameSize` takes a narrower surface, so callers outside the flow view can frame a node.
- The push world reads an expanded group at its stored size, which is exactly what it renders, since React Flow's measure lags a resize by a frame.
- The expand push reads a collapsed card by its layout formula.
- Group containment falls back to the stored box.
- A docked FC's caller supplies the fallback.

**Reopen if:** React Flow's measure becomes reliable before first paint, which would collapse the ladder to one step.

## Building the ELK graph

`elkTidyLayout` builds the graph and applies the result through a `translate` callback. elkjs is a heavy chunk, so it loads lazily on the first Tidy (`makeEnsureElk`); a failed load clears the cache so the next Tidy retries, and a surface destroyed during the load returns null.

- The root options are `ELK_ROOT_OPTIONS`: `elk.algorithm = layered`, `elk.hierarchyHandling = INCLUDE_CHILDREN`, `elk.edgeRouting = POLYLINE`. This constant is their one home: `elkTidyLayout` spreads it and the integration test consumes it verbatim, so the two cannot drift ([[engineering#One declaration per fact]]). `tidyLayerSplitFor` is shared with the test the same way.
- Each card becomes a child with its ports sorted by socket index and `portConstraints: FIXED_POS`. Edges connect port ids (`${nodeId}_${key}_${side}`); an edge with an empty socket key connects the node itself.
- Docked Format Controllers are adornments, not layout nodes. They are left out, and their inline cables are bridged (host → FC → consumer becomes host → consumer) so the real graph still lays out.
- ELK only sees edges whose both ends are in the layout, because an edge to an excluded node makes ELK throw. Edges into a group's members are remapped onto the group as node-level edges, and edges into a cluster follower are remapped onto its cluster leader.
- A group lays out as one portless rectangle at its measured size. Its members are held out and carried rigidly by the group's net move afterwards.
- A Conduit exposes only its wired lanes as ports (one in and one out when nothing is wired), so ELK does not treat it as a tall multi-port card.
- Cards are handed to ELK as Proxies. A Proxy keeps the card's `id`, so the applier still translates the real card, and any reserved size lives only on the proxy.
- A plain card reserves its measured box. A cluster leader (a standoff cluster, see [[C89]] standoffsSolveLast) reserves the whole cluster's bounding box, and its followers are placed back at their offsets from the leader before the anchor step.
- A card with a docked output Format Controller reserves the host plus FC as one inflated box, so ELK does not pack a neighbor into the FC's area. The width grows by the FC width plus 8 per docked FC; the height covers the FC centered on its socket. This reservation is made only for hosts that are themselves layout targets, and it lives only in the proxy handed to ELK. Nothing is written to the card.

## Symmetric ports

Ports sit at the **same offset on both sides** of every card, so two connected cards line up instead of staircasing. `symmetricPortPreset(direction)` builds the preset per layout, so a settings change needs no re-registration. Ports are 15 × 15 and spaced 16 apart.

- Under **RIGHT**, inputs sit on the WEST side and outputs on the EAST side, spread down the card's height.
- Under **DOWN**, inputs sit on NORTH and outputs on SOUTH, spread across the width.

The `tidyAlign` setting chooses where the port column sits:

- **Center** (the default) puts the ports around the middle of the card, so card centers align. Cables may slant slightly because the real output socket sits lower than the input rows.
- **Top** puts the first port 20 from the leading edge, so card top edges (or left edges under DOWN) align.

`tidyAlign` lives in `settingsStore` and shows as a Center / Top segmented control (a `"segment"` field type) in Settings ▸ Canvas.

## The three Tidy knobs

`tidyLayoutOptions` turns the settings into ELK options; the port preset's own `spacing` only places ports. Both call sites (the main canvas and the drill-in) read them at layout time through `tidyOptionsFromSettings`. The popover off the top-bar Tidy button (`TidyOptionsPopover.tsx`, `.solenoid-tidy-options`) mirrors the Settings rows.

| Setting | ELK option | Values |
|---|---|---|
| `tidyDirection` | `elk.direction` | `right` → RIGHT, `down` → DOWN (ports and anchor transpose with it) |
| `tidyDensity` | `elk.layered.spacing.nodeNodeBetweenLayers` / `elk.spacing.nodeNode` | compact 36 / 24, normal 55 / 38, airy 80 / 56 |
| `tidyWidthCap` | layer unzipping | off, 2, 3 or 4 cards per layer |

A width cap switches on ELK's layer unzipping. The root gets `elk.layered.layerUnzipping.strategy = ALTERNATING` (omitted when the cap is off), and the port preset's per-node `options` hook stamps `elk.layered.layerUnzipping.layerSplit` on every card. The split must be per card, because ELK ignores it on the root. Its value is `tidyLayerSplitFor(nodeCount, cap) = ceil(nodeCount / cap)`, at least 1. The count is the whole layout's node count, since per-layer widths are unknown before ELK runs. That over-splits a graph with cards outside the widest layer, which is safe: a layer of W cards has W ≤ nodeCount, so W / split ≤ cap. Layer unzipping needs elkjs 0.11 or later; the project is on 0.12.

## Flipped cards

A card in `socketFlipStore` reads from its right and emits to its left, so Tidy lays it out as a predecessor. Whenever either end of an edge is flipped, the edge is reversed and its ports are dropped, making it a node-level edge so the mirrored side never fights the symmetric ports. The test reads each end's ELK-visible id, so a grouped member counts as its group, which is never flipped. In a RIGHT layout a flipped sink lands to the left of its source.

It also lands below its layer-mates, not above. When any ELK-visible card is flipped, `elkTidyLayout` lists the flipped cards last among the children and adds `FLIPPED_MODEL_ORDER_OPTIONS` (`elk.layered.considerModelOrder.strategy = NODES_AND_EDGES` and `elk.layered.crossingMinimization.forceNodeModelOrder = true`). ELK needs the strategy set alongside the force flag, because the flag assumes the model order has survived into crossing minimization. Forced model order then sorts them to the trailing edge of their layer. A layout with no flipped card gets neither change, so it is identical to an ordinary layout. `tidyArrangeGroups.test.ts` pins both the placement and the unflipped options and children.

## Anchoring the result

ELK lays out from the origin, so the result is shifted back. The anchor keeps the flow's **leading edge and cross-axis center**, not the top-left corner.

- Under RIGHT it keeps the old cluster's left edge and vertical center.
- Under DOWN it keeps the top edge and horizontal center.
- Within a group, the reference is the box interior (inset by `GROUP_PAD`, below `GROUP_HEADER`). The shift is clamped so centering never pushes members above the header under RIGHT, or past the left pad under DOWN.

Both references are deterministic in either direction, so Cleanup's tidy-then-autofit cycle is a fixed point. The test pins this under DOWN with a width cap of 3.

## After the layout

The selection is cleared for the layout and restored afterwards, because translating a selected card triggers the group-follow, which would compound across the per-card placement. These steps run in order after ELK returns:

1. Cluster followers move to their offsets from the new leader position.
2. The anchor shift moves every layout target.
3. Each laid-out group's members move by the group's net delta.
4. The pin-drop loop clears inline sizes (see Cards stay content-sized).
5. Within a group: the box grows to wrap its members, and may push its neighbors (see Growing a group).
6. Autosave is scheduled, the selection is restored, and a Tidy of a selection zooms to it. Scheduling here is enough: `view.translate` schedules nothing, and the autosave debounce reads positions when it flushes, so the deferred settle below is still captured.
7. One frame later, so the sockets have rendered at the new host positions before they are measured, docked FCs snap back onto their hosts; standoffs settle with `forceLock`, so a cluster is pulled back into a rigid block rather than merely band-satisfied; the no-overlap pass runs ([[C112]] noOverlapsEver, skipped under Cleanup's `skipPush`, whose own top-level Tidy runs it), preferring the layout targets (or the group, within a group), so a selection Tidy that lands on an unselected card pushes that card aside and a tidied card on a locked group moves off it; and a whole-canvas Tidy waits one more frame and then fits the view with `fitAll`. Never a raw `zoomAt`, which centers in the full container and lands content under the docked panels.

## Cards stay content-sized

No layout pass may leave a fixed inline `height` on a card. A pinned height freezes the card: collapse can no longer shrink it and a grown value clips. `area.resize` does nothing on the flow surface, and `elkTidyLayout` only translates, so nothing stamps sizes today. The pin-drop loop in `arrangeFn` stays as a guard. For each layout target whose root is a `.solenoid-node`, it removes the inline `height`, then re-applies a manual width from `nodeSizeStore` (React won't re-diff what an imperative write set) or removes the inline `width`. A collapsed card keeps its own compact width, so it gets no manual width. Other roots are skipped, because they set their inline size from React's `style` prop and removing it would leave nothing to re-stamp it.

## Position-locked groups

A group with `GroupNode.lockedPosition` set (persisted through `INIT_FIELD_ORDER`) sits out global Tidy and Cleanup as a fixed obstacle ([[D63]] lockedGroupIsObstacle).

- It is dropped from `layoutTargets`, so global Tidy never places it or carries its members.
- Cleanup skips it in its member tidy, autofit and collapse steps. It stays exactly where it was pinned.
- The final no-overlap pass holds every locked box fixed, so any tidied card that lands on one yields, moving right or down. A pushed group tows its members and a pushed host its docked FCs.
- Its own header Tidy button still works; the lock only fixes the box's corner.
- The lock also wins over a Standoff band. Every `solveStandoffs` call site pins locked groups (`withLockedGroupsPinned`), so a locked standoff end holds and the whole correction falls on the other end.

The lock is toggled from the group's right-click menu ("Lock position" / "Unlock position") or the header lock icon, which sits left of the Tidy icon and shows only while locked. `setGroupLocked` in `groupLogic.ts` is the one entry point.

## Growing a group

After laying out its members, a within-group Tidy grows the box to wrap them: `width` and `height` become the larger of the old value and the members' extent plus `GROUP_PAD`, rounded to integers so the edge never lands on a half-pixel.

If the box grew by more than half a pixel, `tidyArrange.ts` calls `pushForGrownGroups` (`groupPush.ts`). It uses the same `runExpandPushes` engine as expanding a collapsed group, with the pre-grow size as `preSizes`, so neighbors are shoved off the grown edges. It passes `record: false`: a Tidy is a deliberate manual action, so the displacement is permanent. No restore record is written, and pushed neighbors stay put when the group later collapses. A neighbor that already had an expand-push record from before now counts as manually moved, so it does not snap back either. The push only runs when the `groupPush` setting is on.

Cleanup passes `skipPush: true` to its per-group arranges, because it runs its own autofit, collapse and top-level re-tidy right after. A selection or whole-canvas Tidy runs no grow push, because it moves groups as whole units and leaves their interiors alone; only the final no-overlap pass moves what it lands on.

## Cleanup

`makeCleanupFn` lays members out inside their boxes first and then arranges the collapsed groups and loose cards as units, so nothing is tidied twice. The steps, in order:

1. Clear the node and cable selection.
2. Tidy every unlocked group's members with `skipPush: true`.
3. Wait two frames (the snap-back's animation frame, then its translate) so the deferred FC snap-backs land, then autofit every unlocked group. Autofitting earlier would pad the boxes around stale FC positions.
4. Collapse every unlocked group that is still expanded.
5. Tidy the top level, with groups as rigid collapsed units and no confirmation.
6. Wait a frame, fit the view, and schedule autosave.

## Align and distribute

`selectionOps.ts` holds the manual layout verbs over the selection: align, distribute and batch collapse. It works through the `process.ts` singletons, so it is callable from anywhere.

- **The move set.** Each selected card carries its group's members (when it is a group) and its whole standoff cluster (`expandMoveSet`), so moving one end of a pair can't wrench it away from its bar. A position-locked group is never in the move set, whether selected or reached through a cluster ([[D63]] lockedGroupIsObstacle); the arrow-key nudge uses the same set. Every physical card moves exactly once: a card carried by two seeds follows the first only, since the deltas come from boxes captured up front and would drift. The selection is dropped while the cards move, because translating a selected card triggers the group-follow, which compounds.
- **Align** (`alignDeltas`, pure) aligns the boxes to an edge or the center of the selection's own bounding box, the way Figma and Illustrator do: left, right, top, bottom, or center on either axis. It is a manual gesture and deliberately not overlap-free, so cards that share the other axis land on top of each other.
- **Distribute** (`distributeDeltas`, pure) spaces the gaps between edges evenly, not the centers, because card heights vary so widely that equal-center spacing overlaps big cards. It needs at least three cards, and it guarantees no overlap and at least `DISTRIBUTE_GAP` (40, close to Tidy's normal node spacing of 38, so distribute and auto-arrange feel alike) between neighbors:
  - if the span from the first to the last card already fits every box plus that gap, both ends stay fixed and the interior evens out, with gaps of at least `DISTRIBUTE_GAP`;
  - otherwise the cards are too close to fit, so the first stays put and each next card is pushed out at exactly `DISTRIBUTE_GAP`, and the run grows.
- **Batch collapse** (`collapseSelection`) collapses or expands the selected cards, silently skipping groups, Notes, Conduits and cards without a chevron. A card built with `collapsible={false}` carries `.solenoid-node--no-chevron`, and that class is the only signal readable outside the render tree.
