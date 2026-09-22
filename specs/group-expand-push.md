<!-- [[C85]] groupPushDeterministic, [[C86]] membershipByGesture, [[C87]] groupsAreSubflows -->

# Spec: Group expand push

Serves [[C85]] groupPushDeterministic (the push and its records), [[C87]] groupsAreSubflows (the RF projection) and [[C86]] membershipByGesture (who joins a group). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A collapsed group draws as a small card. Expanding it back to full size would cover whatever sits nearby, so the expansion pushes those neighbors just far enough aside, remembers each push, and slides them back when the group collapses again. This spec covers that push, how groups map onto React Flow, and the rules for who is a member of a group.

## The world the push works on

The push runs over plain boxes, with no rete or DOM, so the core (`computeExpandPush` and `separateOverlaps` in `groupPushCore.ts`) is pure and unit-tested (`groupPushCore.test.ts`, `layoutInvariants.test.ts`). `groupPush.ts` builds the boxes and applies the result.

- **Movable boxes** are every group plus every loose node: a node that is in no group and is not a docked Format Controller (FC).
- A loose node's box is widened by the width of any FC docked to its output side (FC width plus 8), because the docked FC has no box of its own.
- A group being expanded is read at its stored full size, since its element may still be mid-render. Other groups use their measured size.
- A group moves with its members; a loose node moves with any FC docked to it.
- All passes read and write the same in-memory boxes, and the totals are applied once at the end, because `view.moveNode` is async and the DOM would show stale positions between passes.

The push runs only while the `groupPush` setting is on.

## The push, per expanding group

When several groups expand at once, they are processed in order of `x + y` of their boxes (top-left first), each against the boxes as earlier groups left them.

For one group, the expanded box starts at the group's position with its full size; the collapsed card is the same corner with the card's size. The right and bottom edges of the card are the "seams" the expansion grows from.

**Satellites.** A loose node wired to the group's members is a satellite. Count its cables into members (upstream) and out of members (downstream). The larger count decides its side: upstream nodes are feeders, downstream nodes are consumers. A node with equal counts has no side and is not a satellite. Its target height is the mean vertical center of the members it is wired to.

**Anchors.** For every other box, its anchors are the centers of the entities its cables lead to. Each cable end resolves to a push entity: a member becomes its group, a docked FC becomes its host. Satellites and groups get no anchors, so a group always clears by geometry, never toward its cables.

**Exempt boxes.** A box that already overlaps the collapsed card (the user parked it there) is never moved by these steps. Pairs of boxes that already overlap each other before the push are recorded as baseline pairs, and the cascade never tries to separate them.

The steps, in order:

1. **Rails.** Each satellite that the expanded box would touch is placed on its dataflow side: feeders just left of the box, consumers just right of it, each `PUSH_GAP` (28) clear of the edge and vertically centered on its target height, clamped within the box's vertical span. A consumer that is already right of the group and would clear rightward is left for step 2 (cleared, not re-placed). Satellites on the same side are then stacked downward in y order, `RAIL_STACK_GAP` (12) apart.
2. **Clear.** Every other box that the expanded box covers moves just past an edge plus `PUSH_GAP`. Only covered boxes move; free space is expanded into without moving anything.
   - A box with anchors tries all four directions (right, down, left, up) and takes the one with the smallest score: mean distance from its new center to its anchors plus 0.5 times the length of the move. A node wired to something on the left therefore hops left out of the way.
   - A box without anchors moves right if its center is past the right seam and it overlaps the box vertically, down if its center is below the bottom seam and it overlaps horizontally. If both apply, it takes the axis along which its center is farther from the card's center. If neither applies, it waits for step 3.
3. **Residual clear.** Any box, satellites included, still overlapping the expanded box after steps 1 and 2 adds the cheaper of a move right or a move down to clear it plus `PUSH_GAP`.
4. **Cascade.** Each moved box, in order of its original `x + y`, pushes any box it now lands on just clear of itself (plus `PUSH_GAP`) along its main direction of travel. It pushes only boxes that started ahead of it on that axis, and never exempt boxes or baseline pairs. Each pushed box then cascades in turn. A band of cleared boxes therefore restacks in its original order instead of flattening or reversing.

## After all groups: standoffs and the backstop

Three more passes run over the same boxes, after every expanding group has had its push:

1. **Standoff clusters move as one block** ([[C89]] standoffsSolveLast). For each cluster of boxes joined by standoffs, every member takes the largest displacement any member received, and the cluster's contributing groups become the union of its members'. A lone push is therefore not pulled partway back.
2. **Standoff solve.** `solveStandoffs` runs with `forceLock` over the moved boxes, with the expanding groups and any position-locked group pinned. Its corrections are added to the same totals, credited to every expanding group.
3. **Overlap backstop.** `separateOverlaps` removes every overlap left among the boxes, treating each standoff cluster as one unit so it can't tear. It repeatedly takes the largest overlapping pair and moves the one further from the top-left (by `x + y`) right or down, whichever is cheaper, to clear by `PUSH_GAP`. Moves only ever go right or down, so it always finishes. This pass is called without baseline pairs, so it also separates overlaps that existed before the expansion. Its moves are credited to every expanding group.

## Records and restore

Each moved box gets a push record in memory (never saved; a reload keeps everything where it is). A record holds the position before the first push, the position the latest push left it at, and `dueTo`, the set of groups whose expansion moved it.

- **Merging.** When a later expansion moves the same box again, the push merges into the existing record (keeping the original position and adding to `dueTo`) only if the box is still within `EPS` (2px) of where the last push left it. Otherwise the old record is void, because something moved the box in between (Tidy, Cleanup, align or distribute move boxes without a drag), and a fresh record starts from the current position. `groupPushRecords.test.ts` pins this.
- **Restore.** After a collapse, and when a group is deleted, `restoreSettledPushes` checks every record whose contributing groups are all collapsed or deleted. If the box is still within `EPS` of where the push left it, it slides back to its original position; if not, it stays put. Either way the record is dropped. Manual moves win.
- **Invalidation.** Dragging a node or group ends in RF's `onNodeDragStop`, which drops every record for the dragged item and every record that item's expansion caused (`groupPushStore.invalidateGroup`). A click never starts an RF drag, so only a real move invalidates.

## Entry points

`setGroupsCollapsed` is the one entry point for toggling. The group's chevron, the Outline panel and the collapse hotkey (Ctrl+Shift+E) all call it. It runs these steps:

1. Measure the collapsed card size of each group about to expand, before the flip re-renders it at full size. These are the seam origins.
2. Flip `collapsed`, recompute collapse state (`syncGroupCollapse`), wait for each group to re-render, and settle the cable endpoints (`settleCollapse`).
3. On collapse: restore settled pushes, then re-solve standoffs with `forceLock`, because the shrink moved their anchors. On expand (with `groupPush` on): run the push.
4. Schedule an autosave.

ELK (the automatic layout engine behind Tidy) is never used in this path.

`pushForGrownGroups` reuses the same engine outside a toggle, when a Tidy inside a group grows its box (`specs/auto-arrange-tidy.md`). It records nothing, so that displacement is permanent and never restores on collapse.

## Groups are React Flow sub-flows

A member is the group's RF child: it sets `parentId`, its RF position is relative to the group box, and parents come before children in the node array (`flowModel.toFlowNodes`). RF then tows members with the group and stacks them above it.

The model stays absolute. Saves, Tidy, standoffs, the lasso and docking all read `view.position` / `node.position` unchanged. Conversion lives only at the boundary:

- `toFlowPosition` / `fromFlowPosition`;
- `handlers.moveNode`, where moving a group re-bases every member, so a Tidy that moves members before their group still ends consistent;
- `onNodesChange`, which applies RF-driven moves to the model, groups first.

A membership change re-projects the nodes through the `groupMembershipStore` subscription. During a group drag, the model's member positions follow the group by its per-frame delta (`moveGroupMembers`). Selected members are skipped, because RF already moves them as part of the selection.

## Who is a member

Membership changes only on an explicit gesture ([[C86]] membershipByGesture):

- **Dragging a node in or out** (`reconcileGroupMembership`, run on RF drag stop for each dragged non-group node). Membership is exclusive and stable: a node belongs to at most one group, and keeps it while its center stays inside that group's rendered box. Once its center leaves, it leaves; it then joins the first other expanded group whose rendered box contains its center. Any FC docked to the node follows its host's membership.
- **A select-then-group action.**
- **A manual resize of the box** (`reconcileGroupBox`, from the grip drag). Every non-group node whose center is inside the new box joins, unless it already belongs to another group, and every member whose center is outside leaves.
- **Creating a node inside a group** (`absorbIntoContainingGroup`, for live creation such as the Add menu or paste). The node joins the first expanded group whose rendered box contains it entirely, unless it is already a member of some group. During a load or seed rebuild, membership comes from the saved list instead.

Groups don't nest: a group is never a member.

**Autofit does not change membership.** It wraps the box around the existing members, so `autofitGroupWithHistory` never runs `reconcileGroupBox`, which would absorb any bystander whose center the shrunk box happens to cover. It does run `rebuildGroupMembership`, which only refreshes the color markers from the unchanged list.

**A collapsed group never gains members.** All three editors guard it: `reconcileGroupMembership` skips collapsed groups as join targets, `absorbIntoContainingGroup` skips collapsed groups, and `reconcileGroupBox` does nothing while the group is collapsed (reconciling against the small card would also drop every member). To change membership, expand the group first.
