// Context-menu TARGET resolution for the flow surface: React Flow says which
// layer was hit (node / edge / pane); these resolve the app's finer targets — a
// socket dot (or the nearest one within reach), a cable + its ribbon lanes, a
// node with its standoff / pin / composite affordances.
import type { NodeEditor } from "rete";
import type { Schemes, SolenoidNode } from "./schemes";
import type { SocketContextTarget, CableContextTarget, NodeContextTarget } from "./components";
import { ConduitNode, FormatControllerNode, GroupNode, CompositeNode } from "./rete-nodes";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import { ribbonForConnection } from "./ribbonCable";
import { standoffStore } from "./standoffs";
import { dockedNodeStore } from "./dockedNodeStore";
import { unselectAllNodes as unselectAllNodesFromProcess } from "./canvasCommands";
type Point = { clientX: number; clientY: number; target: EventTarget | null };

/** An actively-edited field keeps the browser's own menu. */
export function keepsNativeMenu(e: Point): boolean {
  const target = e.target as HTMLElement | null;
  const editable = target?.closest?.("textarea, input, [contenteditable='true']");
  return !!editable && editable === document.activeElement;
}

/** The socket under the pointer — or the nearest within a small radius, since the dot
 *  is ~12px and a press can land beside it. */
export function socketTargetAt(container: HTMLElement, e: Point): SocketContextTarget | null {
  const target = e.target as HTMLElement | null;
  let socketEl = target?.closest?.("[data-socket-key][data-socket-side][data-node-id]") as HTMLElement | null;
  if (!socketEl) {
    const SOCKET_HIT_PX = 11;
    let bestD = SOCKET_HIT_PX;
    container.querySelectorAll<HTMLElement>("[data-socket-key][data-socket-side][data-node-id]").forEach((s) => {
      const r = s.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
      if (d <= bestD) { bestD = d; socketEl = s; }
    });
  }
  if (!socketEl) return null;
  return {
    nodeId:    socketEl.dataset.nodeId    ?? "",
    socketKey: socketEl.dataset.socketKey ?? "",
    side:      (socketEl.dataset.socketSide ?? "output") as "input" | "output",
    screenX: e.clientX, screenY: e.clientY,
  };
}

/** Acts on the whole multi-selection when the clicked cable is part of it, else on just
 *  that cable; ribbons expand to their member lanes either way. Ghosts: no menu. */
export function cableTargetFor(editor: NodeEditor<Schemes>, clickedConnId: string, e: Point): CableContextTarget | null {
  if (cableGhostStore.isGhost(clickedConnId)) return null;
  const conns = editor.getConnections();
  const expand = (id: string): string[] => {
    const conn = conns.find((c) => c.id === id);
    if (!conn || cableGhostStore.isGhost(id)) return [];
    const ribbon = ribbonForConnection(editor, conn);
    return ribbon ? ribbon.members.map((m) => m.id) : [id];
  };
  const clickedIds = expand(clickedConnId);
  if (clickedIds.length === 0) return null;
  const selectedIds = new Set(cableSelectionStore.ids().flatMap(expand));
  let connIds: string[];
  if (clickedIds.some((id) => selectedIds.has(id))) {
    for (const id of clickedIds) selectedIds.add(id);
    connIds = [...selectedIds];
  } else {
    const clicked = conns.find((c) => c.id === clickedConnId)!;
    const ribbon = ribbonForConnection(editor, clicked);
    cableSelectionStore.set(ribbon ? ribbon.repId : clickedConnId);
    unselectAllNodesFromProcess();
    connIds = clickedIds;
  }
  return { connIds, screenX: e.clientX, screenY: e.clientY };
}

/** No selection surgery on right-click: acts on the selection only if it contains the node. */
export function nodeTargetFor(editor: NodeEditor<Schemes>, clickedId: string, e: Point): NodeContextTarget | null {
  const clickedNode = editor.getNode(clickedId);
  if (!clickedNode) return null;
  const selectedIds = editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected)
    .map((n) => n.id);
  const seedIds = selectedIds.includes(clickedId) ? selectedIds : [clickedId];

  // Pinnable = a group or a real value node, but never a bundler / FC.
  const canPin =
    clickedNode instanceof GroupNode || (
      Object.keys((clickedNode as unknown as { outputs?: Record<string, unknown> }).outputs ?? {}).length > 0
      && !(clickedNode instanceof ConduitNode)
      && !(clickedNode instanceof FormatControllerNode)
    );

  const grouped = new Set<string>();
  for (const n of editor.getNodes()) {
    if (n instanceof GroupNode) for (const m of n.members) grouped.add(m);
  }
  const linkable = (n: SolenoidNode) =>
    !(n instanceof ConduitNode) &&
    !(n instanceof FormatControllerNode) &&
    !grouped.has(n.id) &&
    !dockedNodeStore.get(n.id);
  const linkableSel = editor.getNodes().filter(
    (n) => (n as { selected?: boolean }).selected && linkable(n),
  );
  let standoff: { aId: string; bId: string } | undefined;
  if (
    linkableSel.length === 2 &&
    linkableSel.some((n) => n.id === clickedId) &&
    !standoffStore.hasPair(linkableSel[0].id, linkableSel[1].id)
  ) {
    standoff = { aId: linkableSel[0].id, bId: linkableSel[1].id };
  }

  const isComposite = clickedNode instanceof CompositeNode;
  return { nodeId: clickedId, seedIds, screenX: e.clientX, screenY: e.clientY, canPin, isComposite, standoff };
}
