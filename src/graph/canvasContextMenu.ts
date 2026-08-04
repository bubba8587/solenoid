// A NATIVE contextmenu listener, not rete's synthetic React handler — that one doesn't
// reliably resolve `e.target` into the node DOM.
import type { MutableRefObject } from "react";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra, SolenoidNode } from "./schemes";
import type { SocketContextTarget, CableContextTarget, NodeContextTarget } from "./components";
import { ConduitNode, FormatControllerNode, GroupNode, CompositeNode } from "./rete-nodes";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import { ribbonForConnection } from "./ribbonCable";
import { standoffStore } from "./standoffs";
import { dockedNodeStore } from "./dockedNodeStore";
import { isolateStore } from "./isolateStore";
import { unselectAllNodes as unselectAllNodesFromProcess } from "./process";

export interface ContextMenuDeps {
  el: HTMLElement;
  editorRef: MutableRefObject<NodeEditor<Schemes> | null>;
  areaRef: MutableRefObject<AreaPlugin<Schemes, AreaExtra> | null>;
  setSocketCtx: (t: SocketContextTarget) => void;
  setCableCtx: (t: CableContextTarget) => void;
  setNodeCtx: (t: NodeContextTarget) => void;
  openAddMenu: (screenX: number, screenY: number) => void;
}

export function installCanvasContextMenu(deps: ContextMenuDeps): () => void {
  const { el, editorRef, areaRef, setSocketCtx, setCableCtx, setNodeCtx, openAddMenu } = deps;
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Bail BEFORE preventDefault so an actively-edited field keeps the browser's own menu.
    const editable = target.closest("textarea, input, [contenteditable='true']");
    if (editable && editable === document.activeElement) return;
    e.preventDefault();
    // The socket dot is only ~12px and a click can land on a child element, so fall back to
    // the nearest socket within a small radius rather than dropping through to Add.
    let socketEl = target.closest("[data-socket-key][data-socket-side][data-node-id]") as HTMLElement | null;
    if (!socketEl) {
      const SOCKET_HIT_PX = 11;
      let bestD = SOCKET_HIT_PX;
      el.querySelectorAll<HTMLElement>("[data-socket-key][data-socket-side][data-node-id]").forEach((s) => {
        const r = s.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
        if (d <= bestD) { bestD = d; socketEl = s; }
      });
    }
    if (socketEl) {
      setSocketCtx({
        nodeId:    socketEl.dataset.nodeId    ?? "",
        socketKey: socketEl.dataset.socketKey ?? "",
        side:      (socketEl.dataset.socketSide ?? "output") as "input" | "output",
        screenX: e.clientX, screenY: e.clientY,
      });
      return;
    }
    // Acts on the whole multi-selection when the clicked cable is part of it, else on just
    // that cable; ribbons expand to their member lanes either way.
    const cablePath = target.closest("path.solenoid-cable-hit") as SVGPathElement | null;
    const clickedConnId = cablePath?.dataset.connId;
    if (clickedConnId) {
      const editor = editorRef.current;
      if (!editor || cableGhostStore.isGhost(clickedConnId)) return; // ghosts: no menu
      const conns = editor.getConnections();
      const expand = (id: string): string[] => {
        const conn = conns.find((c) => c.id === id);
        if (!conn || cableGhostStore.isGhost(id)) return [];
        const ribbon = ribbonForConnection(editor, conn);
        return ribbon ? ribbon.members.map((m) => m.id) : [id];
      };
      const clickedIds = expand(clickedConnId);
      if (clickedIds.length === 0) return;
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
      setCableCtx({ connIds, screenX: e.clientX, screenY: e.clientY });
      return;
    }
    // Detect via the authoritative nodeViews map, NEVER a CSS class — node roots vary and
    // rete adds no shared wrapper, so any class-based gate misses some node type.
    {
      const editor = editorRef.current;
      const area = areaRef.current;
      let clickedId: string | null = null;
      if (editor && area) {
        for (const [id, view] of area.nodeViews) {
          if (view.element.contains(target)) { clickedId = id; break; }
        }
      }
      if (editor && area && clickedId) {

      // No selection surgery on right-click: act on the selection only if it contains the node.
      const selectedIds = editor.getNodes()
        .filter((n) => (n as { selected?: boolean }).selected)
        .map((n) => n.id);
      const seedIds = selectedIds.includes(clickedId) ? selectedIds : [clickedId];

      // Pinnable = a group or a real value node, but never a bundler / FC.
      const clickedNode = editor.getNode(clickedId);
      const canPin = !!clickedNode && (
        clickedNode instanceof GroupNode || (
          Object.keys((clickedNode as unknown as { outputs?: Record<string, unknown> }).outputs ?? {}).length > 0
          && !(clickedNode instanceof ConduitNode)
          && !(clickedNode instanceof FormatControllerNode)
        )
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
      setNodeCtx({ nodeId: clickedId, seedIds, screenX: e.clientX, screenY: e.clientY, canPin, isComposite, standoff });
      return;
      }
    }
    // Suppressed while isolating — no new nodes there.
    if (isolateStore.isActive()) return;
    openAddMenu(e.clientX, e.clientY);
  };
  el.addEventListener("contextmenu", handler);
  return () => el.removeEventListener("contextmenu", handler);
}
