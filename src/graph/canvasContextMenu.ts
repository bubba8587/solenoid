// Right-click routing for the canvas (extracted from Canvas.tsx): socket →
// socket menu, cable → cable menu, node body → node menu, blank → Add menu.
// Rete's synthetic React handler on the wrapper doesn't reliably resolve
// `e.target` into the node DOM, so this is a NATIVE contextmenu listener on
// the canvas element, which sees the true DOM target.
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

// Installs the native contextmenu handler on the canvas element; returns the remover.
export function installCanvasContextMenu(deps: ContextMenuDeps): () => void {
  const { el, editorRef, areaRef, setSocketCtx, setCableCtx, setNodeCtx, openAddMenu } = deps;
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Right-click / long-press inside an actively-edited text field (e.g. a Note's
    // body while editing) should get the BROWSER's native copy/paste menu, not
    // Solenoid's node menu. Bail before preventDefault so the native menu shows.
    const editable = target.closest("textarea, input, [contenteditable='true']");
    if (editable && editable === document.activeElement) return;
    e.preventDefault();
    // Socket → socket context menu (attach Format Controller, etc.).
    // The socket dot is only ~12px, and a click can land on the SVG child,
    // rete's wrapper, or the node body just off the dot. So: try an exact
    // hit first, then fall back to the nearest socket within a small radius
    // of the cursor. This makes the whole visible dot (and a little around
    // it) open the socket menu instead of falling through to Add.
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
    // Cable hit path → cable context menu (insert Conduit, delete). The menu
    // acts on the whole multi-selection when the clicked cable is part of it,
    // otherwise on just the clicked cable (which gets selected for feedback).
    // Ribbons expand to their member lanes either way.
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
    // On an item body (any node — regular, Note, or Group, but not a socket):
    // open the node menu (Isolate / Isolate chain, plus the Standoff link when
    // exactly two linkable items are selected and one of them was clicked).
    // Detect via the authoritative nodeViews map rather than a CSS class — node
    // roots vary (.solenoid-node, .solenoid-note, .solenoid-group) and rete adds
    // no shared wrapper class, so any class-based gate misses some node type.
    {
      const editor = editorRef.current;
      const area = areaRef.current;
      // Which node element (if any) was clicked?
      let clickedId: string | null = null;
      if (editor && area) {
        for (const [id, view] of area.nodeViews) {
          if (view.element.contains(target)) { clickedId = id; break; }
        }
      }
      if (editor && area && clickedId) {

      // Isolate acts on the selection if the clicked node is part of it,
      // otherwise on just the clicked node (no selection surgery on right-click).
      const selectedIds = editor.getNodes()
        .filter((n) => (n as { selected?: boolean }).selected)
        .map((n) => n.id);
      const seedIds = selectedIds.includes(clickedId) ? selectedIds : [clickedId];

      // Pinnable: a group (shows its readouts), or a real value node (has an
      // output), but not a bundler / FC.
      const clickedNode = editor.getNode(clickedId);
      const canPin = !!clickedNode && (
        clickedNode instanceof GroupNode || (
          Object.keys((clickedNode as unknown as { outputs?: Record<string, unknown> }).outputs ?? {}).length > 0
          && !(clickedNode instanceof ConduitNode)
          && !(clickedNode instanceof FormatControllerNode)
        )
      );

      // Standoff link offer: exactly two linkable items selected, one clicked.
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
    // Blank canvas → Add-node menu (suppressed while isolating — no new nodes).
    if (isolateStore.isActive()) return;
    openAddMenu(e.clientX, e.clientY);
  };
  el.addEventListener("contextmenu", handler);
  return () => el.removeEventListener("contextmenu", handler);
}
