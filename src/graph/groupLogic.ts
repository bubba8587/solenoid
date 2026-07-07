import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { ClassicPreset } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import { GroupNode, nodeKindOf, NODE_KIND_SLOTS } from "./rete-nodes";
import { dockedNodeStore } from "./dockedNodeStore";
import { cableSelectionStore } from "./cableState";
import { rebuildGroupMembership } from "./groupMembership";
import { syncGroupCollapse } from "./groupCollapse";
import { scheduleAutosave } from "./persistence";
import { pushHistory, getEditor } from "./process";
import { settleStandoffs } from "./standoffs";
import { measuredBox } from "./nodeSize";

export const GROUP_DEFAULT_COLOR = "gray"; // palette slot — neutral gray when there's no clear majority

// The group takes the colour of the most common node kind in the selection — a
// chain of mostly-number nodes reads as a number-colored group. A tie (or all
// distinct) falls back to gray. Returns a palette SLOT id (the group stores the
// slot, like every other color in the app), not a hex.
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

// ─── Group geometry + membership (the "hybrid" model) ───────────────────────────
// A group is a frame around a set of member node ids. The set is seeded from the
// selection at creation, then reconciled as nodes are dragged in/out of the box.

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;

// Shared group-box geometry, used by creation, the within-group tidy, AND
// autofit — they MUST agree or a tidy-then-autofit cycle (Cleanup) drifts the
// box a few px each run. GROUP_HEADER matches `.solenoid-group__header` (34px).
export const GROUP_PAD = 24;     // gap between the box edge and the nodes it wraps
export const GROUP_HEADER = 34;  // header height (matches GroupNode.css)

function nodeBox(area: Area, id: string): { x: number; y: number; w: number; h: number } | null {
  // measuredBox guarantees a non-zero size: an unpainted member used to read
  // offsetWidth/Height = 0, collapsing the wrapped bbox to that member's corner.
  return measuredBox(area, id, getEditor() ?? undefined);
}

/** Pin a group's view element behind its members (simpleNodesOrder stacks by DOM order). */
export function sendGroupToBack(area: Area, groupId: string): void {
  const el = area.nodeViews.get(groupId)?.element;
  // Behind members and behind member Conduits (-1) so a Conduit inside a group
  // stays selectable. The GroupNode effect keeps this in sync on later renders.
  if (el) el.style.zIndex = "-2";
}

/** Create a group wrapping the current selection. Returns the new group's id, or null. */
export async function createGroupFromSelection(editor: Editor, area: Area): Promise<string | null> {
  // A group is built only from selected NODES. Clear any lingering cable
  // selection first: it's a separate selection channel that can survive a
  // lasso/multi-select, and carrying a "selected" cable into the group-forming
  // reflow garbles its rendering. (Membership never includes cables — this just
  // drops the stale highlight state.)
  cableSelectionStore.set(null);
  const sel = editor.getNodes().filter((n) => n.selected && !(n instanceof GroupNode));
  if (sel.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of sel) {
    const b = nodeBox(area, n.id);
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
    width: (maxX - minX) + GROUP_PAD * 2,
    height: (maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER,
  });
  await editor.addNode(group);
  await area.translate(group.id, { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEADER });
  sendGroupToBack(area, group.id);
  return group.id;
}

export type GroupGeom = { x: number; y: number; width: number; height: number };

/**
 * Resize + reposition a group's box to tightly wrap its current members (shrinks
 * if the box is too big, grows if a member has drifted outside). Uses the same
 * padding/header offsets as group creation so an autofit looks like a fresh
 * group around the members. Returns { before, after } geometry for an undo
 * entry, or null if the group has no measurable members.
 */
export async function autofitGroupBox(
  _editor: Editor, area: Area, group: GroupNode,
): Promise<{ before: GroupGeom; after: GroupGeom } | null> {
  const gv = area.nodeViews.get(group.id);
  if (!gv) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of group.members) {
    const b = nodeBox(area, id);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null; // nothing to wrap

  const before: GroupGeom = { x: gv.position.x, y: gv.position.y, width: group.width, height: group.height };
  const after: GroupGeom = {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD - GROUP_HEADER,
    // Clamp to the same minimums the manual resize grip enforces.
    width:  Math.max(140, (maxX - minX) + GROUP_PAD * 2),
    height: Math.max(90,  (maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER),
  };
  group.width = after.width;
  group.height = after.height;
  await area.translate(group.id, { x: after.x, y: after.y });
  await area.update("node", group.id);
  return { before, after };
}

/**
 * Autofit a group's box to its members, then reconcile membership and push a
 * single undo entry (position + size + members). Shared by the resize-grip
 * double-press and the autofit hotkey so both behave identically and undo as
 * one step. No-op if the group has no measurable members.
 */
export async function autofitGroupWithHistory(editor: Editor, area: Area, group: GroupNode): Promise<void> {
  const res = await autofitGroupBox(editor, area, group);
  if (!res) return;
  // Autofit ONLY resizes the box around the EXISTING members — it must NOT
  // re-derive membership from the new geometry (no reconcileGroupBox here).
  // Membership changes only on an explicit drag in/out or a select→group action,
  // so a bystander sitting among the members isn't silently absorbed when the box
  // shrinks to wrap them. (rebuildGroupMembership just refreshes the colour
  // markers from the unchanged members list.)
  rebuildGroupMembership(editor);
  syncGroupCollapse(editor, area);
  // Autofit moved the box edges; re-settle any standoffs anchored to this group
  // (or its members) as a rigid block, pinning the just-fitted group.
  settleStandoffs(new Set([group.id]), { forceLock: true });
  scheduleAutosave();
  const apply = (g: GroupGeom) => {
    group.width = g.width;
    group.height = g.height;
    void area.translate(group.id, { x: g.x, y: g.y });
    void area.update("node", group.id);
    syncGroupCollapse(editor, area);
    scheduleAutosave();
  };
  pushHistory(
    () => apply(res.before),
    () => apply(res.after),
  );
}

/** Move every member of a group by (dx, dy) — called as the group is dragged. */
export function moveGroupMembers(
  editor: Editor, area: Area, group: GroupNode, dx: number, dy: number,
  // When a user DRAGS a group whose members are ALSO selected, rete's selector
  // already translates those members by the same delta (it moves the whole
  // selection off the picked/lead node). Moving them again here doubles their
  // speed — the recurring "members outrun their group" bug. So the drag + drop-snap
  // callers pass `skipSelected` to move ONLY the members the group is solely
  // responsible for. A programmatic push (translatePushed) is NOT selector-driven,
  // so it leaves this off and moves every member.
  skipSelected = false,
): void {
  if (dx === 0 && dy === 0) return;
  for (const id of group.members) {
    if (skipSelected && (editor.getNode(id) as { selected?: boolean } | undefined)?.selected) continue;
    const v = area.nodeViews.get(id);
    if (!v) continue;
    void area.translate(id, { x: v.position.x + dx, y: v.position.y + dy });
  }
}

// The group's CURRENT on-screen size. A collapsed group renders as a small
// compact box, not its (expanded) width/height — so containment must use the
// rendered element, or a node dropped where the expanded box *would* be gets
// wrongly absorbed.
function groupRenderedSize(area: Area, g: GroupNode): { w: number; h: number } {
  const el = area.nodeViews.get(g.id)?.element;
  return { w: el?.offsetWidth || g.width, h: el?.offsetHeight || g.height };
}

function centerInside(area: Area, group: GroupNode, b: { x: number; y: number; w: number; h: number }): boolean {
  const gv = area.nodeViews.get(group.id);
  if (!gv) return false;
  const { w, h } = groupRenderedSize(area, group);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= gv.position.x && cx <= gv.position.x + w &&
         cy >= gv.position.y && cy <= gv.position.y + h;
}

/**
 * After a node is dragged, reconcile its group membership — but EXCLUSIVELY and
 * STABLY: a node belongs to at most one group, and it stays in its current group
 * as long as its center is inside it (so an overlapping group can't steal it).
 * Only when it has left its current group does it join another it now sits in.
 */
export function reconcileGroupMembership(editor: Editor, area: Area, draggedId: string): void {
  const dn = editor.getNode(draggedId);
  if (!dn || dn instanceof GroupNode) return; // groups don't nest
  const b = nodeBox(area, draggedId);
  if (!b) return;

  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  const current = groups.find((g) => g.members.includes(draggedId));
  let host = current;
  if (current && !centerInside(area, current, b)) {
    current.members = current.members.filter((m) => m !== draggedId); // left → leave it
    host = undefined;
  }
  if (!host) {
    const target = groups.find((g) => g !== current && centerInside(area, g, b));
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
export function reconcileGroupBox(editor: Editor, area: Area, group: GroupNode): void {
  const gv = area.nodeViews.get(group.id);
  if (!gv) return;
  const groups = editor.getNodes().filter((n): n is GroupNode => n instanceof GroupNode);
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) continue;
    const b = nodeBox(area, n.id);
    if (!b) continue;
    const inside = centerInside(area, group, b);
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

/**
 * If a (just-created) node sits FULLY inside a group's box, make it a member.
 * Returns true if added. Only for LIVE creation (Add menu, paste) — never during
 * a graph load/seed rebuild, where membership is restored from the saved list.
 */
export function absorbIntoContainingGroup(editor: Editor, area: Area, nodeId: string): boolean {
  const n = editor.getNode(nodeId);
  if (!n || n instanceof GroupNode) return false;
  // Already in a group (e.g. a pasted member of its pasted group) → leave it.
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.includes(nodeId)) return false;
  }
  const b = nodeBox(area, nodeId);
  if (!b) return false;
  for (const g of editor.getNodes()) {
    if (!(g instanceof GroupNode)) continue;
    const gv = area.nodeViews.get(g.id);
    if (!gv) continue;
    const { w, h } = groupRenderedSize(area, g);
    const fully = b.x >= gv.position.x && b.y >= gv.position.y &&
                  b.x + b.w <= gv.position.x + w &&
                  b.y + b.h <= gv.position.y + h;
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
