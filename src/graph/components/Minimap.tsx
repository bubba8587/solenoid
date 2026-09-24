// [[C88]] collapseIsVisual
import { getActiveView, getActiveEditor } from "../activeGraph";
import type { SolenoidNode } from "../schemes";
import { GroupNode, NoteNode, nodeAccent } from "../rete-nodes";
import { groupCollapseStore } from "../groupCollapse";
import { themeAccent, resolveColor } from "../palette";
import "./Minimap.css";

// Shared by the RF minimaps (FlowCanvas, the drill-in) and NavMenu's fit-all math.

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

interface Fill { background: string; borderColor: string }

// One stable order shared by the geometry override and the color lookup, so the two stay index-aligned.
function minimapNodes() {
  const editor = getActiveEditor();
  const view = getActiveView();
  if (!editor || !view) return { view: null, nodes: [] as ReturnType<NonNullable<typeof editor>["getNodes"]> };
  const nodes = editor.getNodes().filter(
    (n) => view.hasNode(n.id) && !groupCollapseStore.isNodeHidden(n.id),
  );
  return { view, nodes };
}

// Skips hidden members and sizes a collapsed group to its compact box, not its stored expanded one.
export function collapsedAwareNodesRect() {
  const { view, nodes } = minimapNodes();
  if (!view) return [];
  return nodes.map((n) => {
    const pos = view.position(n.id) ?? { x: 0, y: 0 };
    let width = n.width;
    let height = n.height;
    if (n instanceof GroupNode && n.collapsed) {
      const el = view.nodeElement(n.id);
      width = el?.offsetWidth || width;
      height = el?.offsetHeight || height;
    }
    return { width, height, left: pos.x, top: pos.y };
  });
}

/** Shared with the flow surface's RF MiniMap, so the two can't drift on accent policy. */
export function minimapFillForNode(n: SolenoidNode, mode: "dark" | "light"): Fill {
  if (n instanceof GroupNode) {
    const c = themeAccent(resolveColor(n.color), mode);
    return { background: hexToRgba(c, 0.2), borderColor: hexToRgba(c, 0.75) };
  }
  if (n instanceof NoteNode) {
    const c = themeAccent(resolveColor(n.color), mode);
    return { background: hexToRgba(c, 0.35), borderColor: hexToRgba(c, 0.9) };
  }
  const accent = nodeAccent(n, mode);
  return { background: hexToRgba(accent, 0.85), borderColor: hexToRgba(accent, 0.95) };
}
