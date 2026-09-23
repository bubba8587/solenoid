// [[C98]] paletteMirrorsMenubar (the one menu model)
import type { NodeEditor } from "rete";
import type { Schemes, SolenoidNode } from "./schemes";
import type { SocketContextTarget, CableContextTarget, NodeContextTarget } from "./components";
import { ConduitNode, FormatControllerNode, GroupNode, CompositeNode } from "./rete-nodes";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import { ribbonForConnection } from "./ribbonCable";
import { standoffStore } from "./standoffs";
import { dockedNodeStore } from "./dockedNodeStore";
import { isFlippableNode } from "./flippableNodes";
import { socketFlipStore } from "./socketFlipStore";
import { unselectAllNodes as unselectAllNodesFromProcess } from "./canvasCommands";
import { canAttachFc } from "./canvasActions";
type Point = { clientX: number; clientY: number; target: EventTarget | null };

export function keepsNativeMenu(e: Point): boolean {
  const target = e.target as HTMLElement | null;
  const editable = target?.closest?.("textarea, input, [contenteditable='true']");
  return !!editable && editable === document.activeElement;
}

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

/** The Attach Format Controller menu, or null: it adds a node, so a locked canvas never offers it. */
export function socketMenuFor(editor: NodeEditor<Schemes>, sock: SocketContextTarget | null, locked: boolean): SocketContextTarget | null {
  return sock && !locked && canAttachFc(editor, sock.nodeId) ? sock : null;
}

/** Null on a locked canvas: every cable item edits, and resolving the target would select the cable. */
export function cableTargetFor(editor: NodeEditor<Schemes>, clickedConnId: string, e: Point, locked = false): CableContextTarget | null {
  if (locked || cableGhostStore.isGhost(clickedConnId)) return null;
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

export function nodeTargetFor(editor: NodeEditor<Schemes>, clickedId: string, e: Point, locked = false): NodeContextTarget | null {
  const clickedNode = editor.getNode(clickedId);
  if (!clickedNode) return null;
  const selectedIds = editor.getNodes()
    .filter((n) => (n as { selected?: boolean }).selected)
    .map((n) => n.id);
  const seedIds = selectedIds.includes(clickedId) ? selectedIds : [clickedId];

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
    !locked &&
    linkableSel.length === 2 &&
    linkableSel.some((n) => n.id === clickedId) &&
    !standoffStore.hasPair(linkableSel[0].id, linkableSel[1].id)
  ) {
    standoff = { aId: linkableSel[0].id, bId: linkableSel[1].id };
  }

  const isComposite = clickedNode instanceof CompositeNode;
  const isGroup = clickedNode instanceof GroupNode;
  const lockedPosition = isGroup ? clickedNode.lockedPosition : undefined;
  const isFlippable = isFlippableNode(clickedNode);
  const flipped = isFlippable ? socketFlipStore.get(clickedId) : undefined;
  return { nodeId: clickedId, seedIds, screenX: e.clientX, screenY: e.clientY, canPin, isComposite, isGroup, lockedPosition, isFlippable, flipped, standoff, viewOnly: locked };
}
