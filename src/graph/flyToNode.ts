// [[C88]] collapseIsVisual
import { zoomAt } from "./zoomAt";
import type { NodeEditor } from "rete";

import { getOwningEditor, getOwningView } from "./activeGraph";
import { groupCollapseStore } from "./groupCollapse";
import { GroupNode } from "./rete-nodes";
import type { Schemes } from "./schemes";
import { getActiveView, getActiveEditor } from "./activeGraph";

function resolveVisibleTarget(editor: NodeEditor<Schemes>, nodeId: string): string {
  let targetId = nodeId;
  const seen = new Set<string>();
  while (groupCollapseStore.isNodeHidden(targetId) && !seen.has(targetId)) {
    seen.add(targetId);
    const grp = editor
      .getNodes()
      .find((n) => n instanceof GroupNode && n.members.includes(targetId));
    if (!grp) break;
    targetId = grp.id;
  }
  return targetId;
}

// A collapsed group still carries its expanded size, so pass a sizeless ref and zoomAt uses the rendered box.
function visibleRef(editor: NodeEditor<Schemes>, nodeId: string): Schemes["Node"] | null {
  const targetId = resolveVisibleTarget(editor, nodeId);
  const node = editor.getNode(targetId);
  if (!node) return null;
  return node instanceof GroupNode && node.collapsed
    ? ({ id: targetId } as unknown as typeof node)
    : node;
}

export function flyToNode(nodeId: string): void {
  const editor = getOwningEditor(nodeId);
  const view = getOwningView(nodeId);
  if (!editor || !view) return;
  const ref = visibleRef(editor, nodeId);
  if (!ref) return;
  void zoomAt(view, [ref]);
}

/** Unknown or removed ids are skipped; an empty result does nothing. */
export function flyToNodes(nodeIds: string[]): void {
  const editor = getActiveEditor();
  const view = getActiveView();
  if (!editor || !view || nodeIds.length === 0) return;
  const refs = nodeIds
    .map((id) => visibleRef(editor, id))
    .filter((r): r is Schemes["Node"] => r !== null);
  if (refs.length === 0) return;
  void zoomAt(view, refs);
}

const FLASH_CLASS = "solenoid-node-flash";
const FLASH_MS = 1000;
const _flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** A node inside a collapsed group lights up the group box. */
export function flashNode(nodeId: string): void {
  const editor = getOwningEditor(nodeId);
  const view = getOwningView(nodeId);
  if (!editor || !view) return;
  const targetId = resolveVisibleTarget(editor, nodeId);
  const el = view.nodeElement(targetId);
  if (!el) return;

  el.classList.remove(FLASH_CLASS);
  void el.offsetWidth; // restart the CSS animation if re-triggered mid-flash
  el.classList.add(FLASH_CLASS);

  const prev = _flashTimers.get(targetId);
  if (prev) clearTimeout(prev);
  _flashTimers.set(targetId, setTimeout(() => {
    el.classList.remove(FLASH_CLASS);
    _flashTimers.delete(targetId);
  }, FLASH_MS));
}

export function flyToNodeAndFlash(nodeId: string): void {
  flyToNode(nodeId);
  flashNode(nodeId);
}
