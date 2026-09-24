// [[C86]] membershipByGesture, [[D63]] lockedGroupIsObstacle, [[B10]] reactFlowView, [[C52]] visibleSelection, [[C112]] noOverlapsEver
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
import { settleOverlaps } from "./groupPush";

export const GROUP_DEFAULT_COLOR = "gray";

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

// Creation, within-group Tidy and autofit must share these, or Cleanup's tidy-then-autofit cycle drifts the box each run.
export const GROUP_PAD = 24;
export const GROUP_HEADER = 34; // matches GroupNode.css
export const GROUP_MIN_W = 140;
export const GROUP_MIN_H = 90;

export function withLockedGroupsPinned(editor: Editor, pinned: Set<string> = new Set()): Set<string> {
  const set = new Set(pinned);
  for (const g of editor.getNodes()) {
    if (!(g instanceof GroupNode) || !g.lockedPosition) continue;
    set.add(g.id);
    for (const m of g.members) set.add(m);
  }
  return set;
}

export function setGroupLocked(editor: Editor, view: View, node: GroupNode, locked: boolean): void {
  if (node.lockedPosition === locked) return;
  node.lockedPosition = locked;
  rebuildGroupMembership(editor);
  void view.rerenderNode(node.id);
  scheduleAutosave();
}

function nodeBox(view: View, id: string): { x: number; y: number; w: number; h: number } | null {
  return measuredBox(view, id, getOwningEditor(id) ?? undefined);
}

export function sendGroupToBack(view: View, groupId: string): void {
  const el = view.nodeElement(groupId);
  if (el) el.style.zIndex = "-2";
}

export async function createGroupFromSelection(editor: Editor, view: View): Promise<string | null> {
  // Clear the cable selection first: a selected cable carried into the group-forming reflow garbles its rendering.
  cableSelectionStore.set(null);
  const sel = editor
    .getNodes()
    .filter((n) => n.selected && !(n instanceof GroupNode) && !groupCollapseStore.isNodeHidden(n.id));
  if (sel.length === 0) return null;
  const selIds = new Set(sel.map((n) => n.id));
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.some((m) => selIds.has(m))) {
      g.members = g.members.filter((m) => !selIds.has(m));
    }
  }

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
    width: Math.round((maxX - minX) + GROUP_PAD * 2),
    height: Math.round((maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER),
  });
  await editor.addNode(group);
  rebuildGroupMembership(editor);
  await view.moveNode(group.id, { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEADER });
  sendGroupToBack(view, group.id);
  settleOverlaps(editor, view, new Set([group.id]));
  return group.id;
}

export type GroupGeom = { x: number; y: number; width: number; height: number };

export async function autofitGroupBox(
  editor: Editor, view: View, group: GroupNode,
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
    width:  Math.round(Math.max(GROUP_MIN_W, (maxX - minX) + GROUP_PAD * 2)),
    height: Math.round(Math.max(GROUP_MIN_H, (maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER)),
  };
  if (group.lockedPosition) {
    // [[D63]] lockedGroupIsObstacle: the lock holds the corner, so the members come to it.
    moveGroupMembers(editor, view, group, gv.x - after.x, gv.y - after.y);
    after.x = gv.x;
    after.y = gv.y;
  }

  group.width = after.width;
  group.height = after.height;
  await view.moveNode(group.id, { x: after.x, y: after.y });
  await view.rerenderNode(group.id);
  return { before, after };
}

export async function autofitGroupWithHistory(editor: Editor, view: View, group: GroupNode): Promise<void> {
  const res = await autofitGroupBox(editor, view, group);
  if (!res) return;
  rebuildGroupMembership(editor);
  syncGroupCollapse(editor, view);
  settleStandoffs(new Set([group.id]), { forceLock: true });
  settleOverlaps(editor, view, new Set([group.id]));
  scheduleAutosave();
}

export function moveGroupMembers(
  editor: Editor, view: View, group: GroupNode, dx: number, dy: number,
  // Drag callers pass `skipSelected`, because RF already moves selected members; a programmatic push leaves it off.
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

function groupRenderedSize(view: View, g: GroupNode): { w: number; h: number } {
  const el = view.nodeElement(g.id);
  // measuredBox exception: containment wants the RENDERED box, falling back to the stored one.
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

export function reconcileGroupMembership(editor: Editor, view: View, draggedId: string): void {
  const dn = editor.getNode(draggedId);
  if (!dn || dn instanceof GroupNode) return;
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
    const target = groups.find((g) => g !== current && !g.collapsed && centerInside(view, g, b));
    if (target) { target.members = [...target.members, draggedId]; host = target; }
  }
  for (const rel of dockedNodeStore.getDockedTo(draggedId)) {
    for (const g of groups) {
      const has = g.members.includes(rel.id);
      if (g === host) { if (!has) g.members = [...g.members, rel.id]; }
      else if (has) g.members = g.members.filter((m) => m !== rel.id);
    }
  }
}

export function reconcileGroupBox(editor: Editor, view: View, group: GroupNode): void {
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
      if (!groups.some((g) => g !== group && g.members.includes(n.id))) {
        group.members = [...group.members, n.id];
      }
    } else if (!inside && isMember) {
      group.members = group.members.filter((m) => m !== n.id);
    }
  }
}

export function absorbIntoContainingGroup(editor: Editor, view: View, nodeId: string): boolean {
  const n = editor.getNode(nodeId);
  if (!n || n instanceof GroupNode) return false;
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.includes(nodeId)) return false;
  }
  const b = nodeBox(view, nodeId);
  if (!b) return false;
  for (const g of editor.getNodes()) {
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

export function dropFromGroups(editor: Editor, removedId: string): void {
  for (const g of editor.getNodes()) {
    if (g instanceof GroupNode && g.members.includes(removedId)) {
      g.members = g.members.filter((m) => m !== removedId);
    }
  }
}
