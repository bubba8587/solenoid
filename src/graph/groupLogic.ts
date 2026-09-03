import type { View } from "./view";
import type { NodeEditor } from "rete";
import type { ClassicPreset } from "rete";
import type { Schemes } from "./schemes";
import { GroupNode, nodeKindOf, NODE_KIND_SLOTS } from "./rete-nodes";
import { dockedNodeStore } from "./dockedNodeStore";
import { cableSelectionStore } from "./cableState";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse, groupCollapseStore } from "./groupCollapse";
import { scheduleAutosave } from "./persistence";

import { settleStandoffs } from "./standoffs";
import { measuredBox } from "./nodeSize";
import { getOwningEditor } from "./activeGraph";

export const GROUP_DEFAULT_COLOR = "gray"; // palette slot — neutral gray when there's no clear majority

// The color of the most common node kind in the selection; a tie (or all
// distinct) falls back to gray. Returns a palette SLOT id, not a hex.
function majorityColor(nodes: ClassicPreset.Node[]): string {
  const tally = new Map<string, number>();
  for (const n of nodes) {
    const c = NODE_KIND_SLOTS[nodeKindOf(n)];
    if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  let best = GROUP_DEFAULT_COLOR, bestN = 0, tie = false;
  for (const [c, k] of tally) {
    if (k > bestN) { best = c; bestN = k; tie = false; }
    else if (k === bestN) tie = true;
  }
  return bestN > 0 && !tie ? best : GROUP_DEFAULT_COLOR;
}

type Editor = NodeEditor<Schemes>;

// Shared by creation, the within-group tidy AND autofit — they MUST agree or a
// tidy-then-autofit cycle (Cleanup) drifts the box a few px each run.
export const GROUP_PAD = 24;     // gap between the box edge and the nodes it wraps
export const GROUP_HEADER = 34;  // header height (matches GroupNode.css)
// Shared with the resize grip so a fit can never shrink below what the grip allows.
export const GROUP_MIN_W = 140;
export const GROUP_MIN_H = 90;

/** A locked group must sit out the standoff solve as well — the position lock wins
 *  over the band, so the correction falls entirely on the other endpoint. Returns a
 *  pinned set that includes every locked group; `solveStandoffs` ignores ids that
 *  aren't standoff endpoints, so passing them all is harmless. */
export function withLockedGroupsPinned(editor: Editor, pinned: Set<string> = new Set()): Set<string> {
  const set = new Set(pinned);
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.lockedPosition) set.add(g.id);
  }
  return set;
}

/** Pin / unpin a group's top-left corner. A locked group can't be dragged
 *  (per-node `draggable: false` in `toFlowNodes`) and is skipped by global Tidy
 *  and Cleanup; it still resizes. rebuildGroupMembership fires the topology
 *  re-projection that repaints `draggable`; the rerender refreshes the header lock. */
export function setGroupLocked(editor: Editor, view: View, node: GroupNode, locked: boolean): void {
  if (node.lockedPosition === locked) return;
  node.lockedPosition = locked;
  rebuildGroupMembership(editor);
  void view.rerenderNode(node.id);
  scheduleAutosave();
}

function nodeBox(view: View, id: string): { x: number; y: number; w: number; h: number } | null {
  // measuredBox guarantees a non-zero size: an unpainted member reading
  // offsetWidth/Height = 0 collapses the wrapped bbox to that member's corner.
  return measuredBox(view, id, getOwningEditor(id) ?? undefined);
}

/** Pin a group's view element behind its members (simpleNodesOrder stacks by DOM order). */
export function sendGroupToBack(view: View, groupId: string): void {
  const el = view.nodeElement(groupId);
  // Behind members and behind member Conduits (-1) so a Conduit inside a group
  // stays selectable. The GroupNode effect keeps this in sync on later renders.
  if (el) el.style.zIndex = "-2";
}

/** Create a group wrapping the current selection. Returns the new group's id, or null. */
export async function createGroupFromSelection(editor: Editor, view: View): Promise<string | null> {
  // Clear the separate cable-selection channel first — a "selected" cable carried
  // into the group-forming reflow garbles its rendering.
  cableSelectionStore.set(null);
  // Nodes hidden inside a collapsed group are excluded: they already belong to one,
  // and any selection path (Ctrl+A + G, …) would silently absorb them.
  const sel = editor
    .getNodes()
    .filter((n) => n.selected && !(n instanceof GroupNode) && !groupCollapseStore.isNodeHidden(n.id));
  if (sel.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of sel) {
    const b = nodeBox(view, n.id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;

  const group = new GroupNode({
    members: sel.map((n) => n.id),
    color: majorityColor(sel),
    // Integer dims (same rule as the resize grips): a fractional width/height
    // puts the right/bottom edge on a half-pixel and the selection ring drifts.
    width: Math.round((maxX - minX) + GROUP_PAD * 2),
    height: Math.round((maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER),
  });
  await editor.addNode(group);
  rebuildGroupMembership(editor); // members tint now, not on the next unrelated rebuild
  await view.moveNode(group.id, { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEADER });
  sendGroupToBack(view, group.id);
  return group.id;
}

export type GroupGeom = { x: number; y: number; width: number; height: number };

/** Wrap the box tightly around the current members, using the same padding/header
 *  offsets as creation. Returns { before, after } for an undo entry, or null. */
export async function autofitGroupBox(
  _editor: Editor, view: View, group: GroupNode,
): Promise<{ before: GroupGeom; after: GroupGeom } | null> {
  const gv = view.position(group.id);
  if (!gv) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of group.members) {
    const b = nodeBox(view, id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;

  const before: GroupGeom = { x: gv.x, y: gv.y, width: group.width, height: group.height };
  const after: GroupGeom = {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD - GROUP_HEADER,
    // Clamp to the same minimums the manual resize grip enforces; integer dims
    // like every other resize source (half-pixel edges drift the selection ring).
    width:  Math.round(Math.max(GROUP_MIN_W, (maxX - minX) + GROUP_PAD * 2)),
    height: Math.round(Math.max(GROUP_MIN_H, (maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER)),
  };

  group.width = after.width;
  group.height = after.height;
  await view.moveNode(group.id, { x: after.x, y: after.y });
  await view.rerenderNode(group.id);
  return { before, after };
}

/** Autofit, then push ONE undo entry (position + size + members) so the resize-grip
 *  double-press and the autofit hotkey undo as a single step. */
export async function autofitGroupWithHistory(editor: Editor, view: View, group: GroupNode): Promise<void> {
  const res = await autofitGroupBox(editor, view, group);
  if (!res) return;
  // Autofit must NOT re-derive membership from the new geometry (no reconcileGroupBox);
  // rebuildGroupMembership only refreshes color markers from the unchanged list.
  rebuildGroupMembership(editor);
  syncGroupCollapse(editor, view);
  // Autofit moved the box edges; re-settle any standoffs anchored to this group
  // (or its members) as a rigid block, pinning the just-fitted group.
  settleStandoffs(new Set([group.id]), { forceLock: true });
  scheduleAutosave();
}

/** Move every member of a group by (dx, dy) — called as the group is dragged. */
export function moveGroupMembers(
  editor: Editor, view: View, group: GroupNode, dx: number, dy: number,
  // Rete's selector already translates selected members, so drag callers pass
  // `skipSelected` or those members move at double speed; a programmatic push isn't
  // selector-driven and leaves it off.
  skipSelected = false,
): void {
  if (dx === 0 && dy === 0) return;
  for (const id of group.members) {
    if (skipSelected && (editor.getNode(id) as { selected?: boolean } | undefined)?.selected) continue;
    const p = view.position(id);
    if (!p) continue;
    void view.moveNode(id, { x: p.x + dx, y: p.y + dy });
  }
}

// Containment must use the RENDERED element — a collapsed group draws as a small card,
// so its stored width/height would absorb nodes dropped where the box merely would be.
function groupRenderedSize(view: View, g: GroupNode): { w: number; h: number } {
  const el = view.nodeElement(g.id);
  return { w: el?.offsetWidth || g.width, h: el?.offsetHeight || g.height };
}

function centerInside(view: View, group: GroupNode, b: { x: number; y: number; w: number; h: number }): boolean {
  const gv = view.position(group.id);
  if (!gv) return false;
  const { w, h } = groupRenderedSize(view, group);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= gv.x && cx <= gv.x + w &&
         cy >= gv.y && cy <= gv.y + h;
}

/** EXCLUSIVE and STABLE: a node belongs to at most one group and keeps it while its
 *  center is inside, so an overlapping group can never steal it. */
export function reconcileGroupMembership(editor: Editor, view: View, draggedId: string): void {
  const dn = editor.getNode(draggedId);
  if (!dn || dn instanceof GroupNode) return; // groups don't nest
  const b = nodeBox(view, draggedId);
  if (!b) return;

  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  const current = groups.find((g) => g.members.includes(draggedId));
  let host = current;
  if (current && !centerInside(view, current, b)) {
    current.members = current.members.filter((m) => m !== draggedId);
    host = undefined;
  }
  if (!host) {
    // Never join a COLLAPSED group — the next syncGroupCollapse would hide the new
    // member, so the node visibly vanishes.
    const target = groups.find((g) => g !== current && !g.collapsed && centerInside(view, g, b));
    if (target) { target.members = [...target.members, draggedId]; host = target; }
  }
  // A docked FC follows its host's group membership (it moves programmatically
  // with the host, so it never gets its own reconcile).
  for (const rel of dockedNodeStore.getDockedTo(draggedId)) {
    for (const g of groups) {
      const has = g.members.includes(rel.id);
      if (g === host) { if (!has) g.members = [...g.members, rel.id]; }
      else if (has) g.members = g.members.filter((m) => m !== rel.id);
    }
  }
}

/** Re-evaluate a single group's membership against all nodes — after its box is resized. */
export function reconcileGroupBox(editor: Editor, view: View, group: GroupNode): void {
  // Membership only reconciles while EXPANDED — against the collapsed card every
  // member would fall outside and every bystander under it would be absorbed.
  if (group.collapsed) return;
  const gv = view.position(group.id);
  if (!gv) return;
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) continue;
    const b = nodeBox(view, n.id);
    if (!b) continue;
    const inside = centerInside(view, group, b);
    const isMember = group.members.includes(n.id);
    if (inside && !isMember) {
      // Don't steal a node that already belongs to another group.
      if (!groups.some((g) => g !== group && g.members.includes(n.id))) {
        group.members = [...group.members, n.id];
      }
    } else if (!inside && isMember) {
      group.members = group.members.filter((m) => m !== n.id);
    }
  }
}

/** For LIVE creation (Add menu, paste) ONLY — during a load/seed rebuild membership
 *  is restored from the saved list instead. Returns true if added. */
export function absorbIntoContainingGroup(editor: Editor, view: View, nodeId: string): boolean {
  const n = editor.getNode(nodeId);
  if (!n || n instanceof GroupNode) return false;
  // Already in a group (e.g. a pasted member of its pasted group) → leave it.
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.includes(nodeId)) return false;
  }
  const b = nodeBox(view, nodeId);
  if (!b) return false;
  for (const g of editor.getNodes()) {
    // Skip collapsed groups — absorbing a fresh node would immediately hide it, so it
    // looks like the new node never appeared.
    if (!(g instanceof GroupNode) || g.collapsed) continue;
    const gv = view.position(g.id);
    if (!gv) continue;
    const { w, h } = groupRenderedSize(view, g);
    const fully = b.x >= gv.x && b.y >= gv.y &&
                  b.x + b.w <= gv.x + w &&
                  b.y + b.h <= gv.y + h;
    if (fully && !g.members.includes(nodeId)) {
      g.members = [...g.members, nodeId];
      return true;
    }
  }
  return false;
}

/** Drop a removed node's id from every group's member list. */
export function dropFromGroups(editor: Editor, removedId: string): void {
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.includes(removedId)) {
      g.members = g.members.filter((m) => m !== removedId);
    }
  }
}
