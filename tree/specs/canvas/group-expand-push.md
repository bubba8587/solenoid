---
aliases: ["Group expand push"]
tags: [spec, canvas]
---
<!-- [[C85]] groupPushDeterministic, [[C86]] membershipByGesture, [[C87]] groupsAreSubflows, [[C52]] visibleSelection, [[D63]] lockedGroupIsObstacle, [[C112]] noOverlapsEver -->

# Spec: Group expand push

Serves [[C85]] groupPushDeterministic (the push and its records), [[C87]] groupsAreSubflows (the RF projection) and [[C86]] membershipByGesture (who joins a group). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A collapsed group draws as a small card. Expanding it back to full size would cover whatever sits nearby, so the expansion pushes those neighbors just far enough aside, remembers each push, and slides them back when the group collapses again. This spec covers that push, how groups map onto React Flow, and the rules for who is a member of a group.

## The world the push works on

The push runs over plain boxes, with no rete or DOM, so the core (`computeExpandPush`, `separateOverlaps` and `separateAll` in `groupPushCore.ts`) is pure and unit-tested (`groupPushCore.test.ts`, `layoutInvariants.test.ts`). `groupPush.ts` builds the boxes and applies the result.

- **Movable boxes** are every group plus every loose node: a node that is in no group and is not a docked Format Controller (FC).
- A loose node's box reaches over its docked FCs (FC width plus 8), rightward for an FC docked to an output and leftward for one docked to an input, because a docked FC has no box of its own.
- An expanded group is read at its stored size, which is exactly the size it renders at; React Flow's measure lags a resize by a frame. Its box then reaches over any FC docked to a member that hangs past its edge (an input FC on a member at the left pad does), since that FC rides the member. When such a group expands, its collapsed card is widened to the same top-left corner, so the right and bottom seams stay where the card's were. A collapsed group is read at its card size; its members' FCs are hidden with them.
- A group moves with its members and with every FC docked to one of them; a loose node moves with any FC docked to it.
- All passes read and write the same in-memory boxes, and the totals are applied once at the end, because `view.moveNode` is async and the DOM would show stale positions between passes.

The push runs only while the `groupPush` setting is on.

## The push, per expanding group

When several groups expand at once, they are processed in order of `x + y` of their boxes (top-left first), each against the boxes as earlier groups left them.

For one group, the expanded box starts at the group's position with its full size; the collapsed card is the same corner with the card's size. The right and bottom edges of the card are the "seams" the expansion grows from.

**Satellites.** A loose node wired to the group's members is a satellite. Count its cables into members (upstream) and out of members (downstream). The larger count decides its side: upstream nodes are feeders, downstream nodes are consumers. A node with equal counts has no side and is not a satellite. Its target height is the mean vertical center of the members it is wired to, in world coordinates, corrected by however far this group has already moved within the batch, since members move physically only when the batch applies.

**Anchors.** For every other box, its anchors are the centers of the entities its cables lead to. Each cable end resolves to a push entity: a member becomes its group, a docked FC becomes its host. Satellites and groups get no anchors, so a group always clears by geometry, never toward its cables: a group chasing its connections would pile interconnected groups onto one spot when several expand at once.

**Exempt boxes.** A position-locked group is never moved by these steps ([[D63]] lockedGroupIsObstacle), and neither is a box that already overlaps the collapsed card (the user parked it there). Pairs of boxes that already overlap each other before the push are recorded as baseline pairs, and the cascade never tries to separate them. The backstop below separates all of these anyway.

The steps, in order:

1. **Rails.** Each satellite that the expanded box would touch is placed on its dataflow side: feeders just left of the box, consumers just right of it, each `PUSH_GAP` (28) clear of the edge and vertically centered on its target height, clamped within the box's vertical span. A consumer that is already right of the group and would clear rightward is left for step 2 (cleared, not re-placed). Satellites on the same side are then stacked downward in y order, `RAIL_STACK_GAP` (12) apart.
2. **Clear.** Every other box that the expanded box covers moves just past an edge plus `PUSH_GAP`. Only covered boxes move; free space is expanded into without moving anything.
   - A box with anchors tries all four directions (right, down, left, up) and takes the one with the smallest score: mean distance from its new center to its anchors plus 0.5 times the length of the move. A node wired to something on the left therefore hops left out of the way.
   - A box without anchors moves right if its center is past the right seam and it overlaps the box vertically, down if its center is below the bottom seam and it overlaps horizontally. If both apply, it takes the axis along which its center is farther from the card's center. If neither applies, it waits for step 3.
3. **Residual clear.** Any box, satellites included, still overlapping the expanded box after steps 1 and 2 adds the cheaper of a move right or a move down to clear it plus `PUSH_GAP`.
4. **Cascade.** Each moved box, in order of its original `x + y`, pushes any box it now lands on just clear of itself (plus `PUSH_GAP`) along its main direction of travel. It pushes only boxes that started ahead of it on that axis, and never exempt boxes or baseline pairs. Each pushed box then cascades in turn. A band of cleared boxes therefore restacks in its original order instead of flattening or reversing.

## After all groups: standoffs and the backstop

Three more passes run over the same boxes, after every expanding group has had its push:

1. **Standoff clusters move as one block** ([[C89]] standoffsSolveLast). For each cluster of boxes joined by standoffs, every member except a locked group takes the largest displacement any member received, and the cluster's contributing groups become the union of its members'. A lone push is therefore not pulled partway back.
2. **Standoff solve.** `solveStandoffs` runs with `forceLock` over the moved boxes, with the expanding groups and any position-locked group pinned. Its corrections are added to the same totals, credited to every expanding group.
3. **Overlap backstop** ([[C112]] noOverlapsEver). `separateAll` removes every overlap left among the boxes, with no exemptions: an overlap the user made before the expand is separated too. Each standoff cluster is one unit, so it can't tear. Locked groups are fixed; the expanding groups are preferred, so they hold still while a partner can yield. Its moves are credited to every expanding group.

`separateAll` runs `separateOverlaps` twice. The first pass pins the fixed and the preferred units; the second pins only the fixed ones, clearing any overlap the first had to leave between two pinned units. `separateOverlaps` places the boxes one at a time, pinned ones first, then the rest from the top-left (by `x + y`). A pinned box stays where it is. Every other box, while it overlaps one already placed, moves right or down, whichever is cheaper, to clear the placed box it overlaps most by `PUSH_GAP`. So the top-left box keeps its anchor corner, a pinned box's partner yields, and two pinned boxes are left alone. Moves only ever go right or down, so it always finishes, and a few hundred boxes take milliseconds. Afterwards only two fixed units can still overlap.

## What is not a layout op

A card that grows with its live content (a Display showing a longer value, a list that gains rows) and a card whose body chevron expands push nothing. Either can cover a neighbor until the next layout op's no-overlap pass separates them, which measures the grown card. Content that overflows a constant-size body ([[resizable-content-nodes]]) is never counted at all, since the pass reads the card's box. Whether growth should push is open with the author (inbox `card-growth-pushes`).

## Records and restore

Each moved box gets a push record in memory (never saved; a reload keeps everything where it is). A record holds the position before the first push, the position the latest push left it at, and `dueTo`, the set of groups whose expansion moved it.

- **Merging.** When a later expansion moves the same box again, the push merges into the existing record (keeping the original position and adding to `dueTo`) only if the box is still within `EPS` (2px) of where the last push left it. Otherwise the old record is void, because something moved the box in between (Tidy, Cleanup, align or distribute move boxes without a drag), and a fresh record starts from the current position. `groupPushRecords.test.ts` pins this.
- **Restore.** After a collapse, and when a group is deleted, `restoreSettledPushes` checks every record whose contributing groups are all collapsed or deleted. If the box is still within `EPS` of where the push left it, it slides back to its original position; if not, it stays put. Either way the record is dropped. Manual moves win.
- **Invalidation.** Dragging a node or group ends in RF's `onNodeDragStop`, which drops every record for the dragged item and every record that item's expansion caused (`groupPushStore.invalidateGroup`). A click never starts an RF drag, so only a real move invalidates.

## Entry points

`setGroupsCollapsed` is the one entry point for toggling. The group's chevron, the Outline panel and the collapse hotkey (`E`) all call it. It runs these steps:

1. Measure the collapsed card size of each group about to expand, before the flip re-renders it at full size. These are the seam origins.
2. Flip `collapsed`, recompute collapse state (`syncGroupCollapse`), wait for each group to re-render so the footprints measured next are current, and settle the cable endpoints (`settleCollapse`).
3. On collapse: restore settled pushes, then re-solve standoffs with `forceLock`, because the shrink moved their anchors (a no-op when the restores already landed everything in band). Two frames later, once React Flow has measured the cards, `settleOverlapsAfterPaint` runs the no-overlap pass, preferring the collapsed groups: a restore can land a card on one placed while the group was open. On expand (with `groupPush` on): run the push.
4. Schedule an autosave.

ELK (the automatic layout engine behind Tidy) is never used in this path.

`pushForGrownGroups` reuses the same engine outside a toggle, when a Tidy inside a group grows its box ([[auto-arrange-tidy]]). It records nothing, so that displacement is permanent and never restores on collapse.

## Groups are React Flow sub-flows

A member is the group's RF child: it sets `parentId`, its RF position is relative to the group box, and parents come before children in the node array (`flowModel.toFlowNodes`). RF then tows members with the group and stacks them above it.

The model stays absolute. Saves, Tidy, standoffs, the lasso and docking all read `view.position` / `node.position` unchanged. Conversion lives only at the boundary:

- `toFlowPosition` / `fromFlowPosition`;
- `handlers.moveNode`, where moving a group re-bases every member, so a Tidy that moves members before their group still ends consistent;
- `onNodesChange`, which applies RF-driven moves to the model, groups first.

A membership change re-projects the nodes through the `groupMembershipStore` subscription. During a group drag, the model's member positions follow the group by its per-frame delta (`moveGroupMembers`), collapsed groups included. Drag callers pass `skipSelected`, because RF already moves selected members as part of the selection; a programmatic push leaves it off.

## Creating and fitting a group

- **Group** (the `G` key, or the menu) wraps the current selection (`createGroupFromSelection`, `groupLogic.ts`). A selected member of another group leaves that group, since membership is exclusive. The new box may cover cards outside the selection; the no-overlap pass pushes them off it. Nodes hidden inside a collapsed group are left out, since they already belong to one and a selection path such as Ctrl+A then G would otherwise absorb them ([[C52]] visibleSelection). The cable selection is cleared first, because a selected cable carried into the group-forming reflow garbles its rendering.
- The box is the members' bounding box (through `measuredBox`) plus `GROUP_PAD` (24) on each side and `GROUP_HEADER` (34, matching GroupNode.css) on top, with integer dimensions: a fractional width or height puts the edge on a half-pixel and the selection ring drifts. Creation, the within-group Tidy and autofit share these two constants; if they disagreed, Cleanup's tidy-then-autofit cycle would drift the box a few pixels on every run.
- The group's color is the palette slot of the most common node kind in the selection; a tie, or all kinds distinct, falls back to gray (`GROUP_DEFAULT_COLOR`). The members tint at once.
- **Autofit** (the `F` key, or a double-press on the resize grip) wraps the box tightly around its current members with the same padding, clamped to the grip's own minimums (`GROUP_MIN_W` 140, `GROUP_MIN_H` 90) and to integers. `autofitGroupWithHistory` records one undo entry for position, size and members together, so both entry points undo as a single step, then re-settles the standoffs as a rigid block, pinning the fitted group, and runs the no-overlap pass preferring it, since a box that grows can land on a neighbor. A locked group keeps its corner: the members move to it instead ([[D63]] lockedGroupIsObstacle).
- The group element stacks behind its members and behind member Conduits (−1), so a Conduit inside a group stays selectable ([[C65]] domOrderStacking).
- **The position lock** is set only through `setGroupLocked`; its re-projection repaints the RF `draggable` flag and the header lock icon ([[D63]] lockedGroupIsObstacle). Every standoff solve pins every locked group and its members (`withLockedGroupsPinned`), since the solver works on raw endpoint ids and a member's standoff would otherwise slide the member out of the locked box.

## Who is a member

Membership changes only on an explicit gesture ([[C86]] membershipByGesture):

- **Dragging a node in or out** (`reconcileGroupMembership`, run on RF drag stop for each dragged non-group node). Membership is exclusive and stable: a node belongs to at most one group, and keeps it while its center stays inside that group's rendered box. Once its center leaves, it leaves; it then joins the first other expanded group whose rendered box contains its center. Any FC docked to the node follows its host's membership.
- **A select-then-group action.**
- **A manual resize of the box** (`reconcileGroupBox`, from the grip drag). Every non-group node whose center is inside the new box joins, unless it already belongs to another group, and every member whose center is outside leaves.
- **Creating a node inside a group** (`absorbIntoContainingGroup`, for live creation such as the Add menu or paste). The node joins the first expanded group whose rendered box contains it entirely, unless it is already a member of some group. During a load or seed rebuild, membership comes from the saved list instead.

Groups don't nest: a group is never a member. "Rendered box" means the group element's live size, falling back to the stored one, because a collapsed group draws as a small card and its stored size would absorb nodes dropped where the expanded box would be. Deleting a node drops its id from every member list.

**Autofit does not change membership.** It wraps the box around the existing members, so `autofitGroupWithHistory` never runs `reconcileGroupBox`, which would absorb any bystander whose center the shrunk box happens to cover. It does run `rebuildGroupMembership`, which only refreshes the color markers from the unchanged list.

**A collapsed group never gains members.** All three editors guard it: `reconcileGroupMembership` skips collapsed groups as join targets, `absorbIntoContainingGroup` skips collapsed groups, and `reconcileGroupBox` does nothing while the group is collapsed (reconciling against the small card would also drop every member). To change membership, expand the group first.
