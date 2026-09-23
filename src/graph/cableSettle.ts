// [[C43]] oneFlowSurface, [[D16]] retypeReconciles, [[D41]] formatFlowsDownstream
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import type { View } from "./view";
import { FormatControllerNode } from "./rete-nodes";
import { formatAnnotationStore, formatMismatchStore, unitsCompatible } from "./formatAnnotationStore";
import { reconcileFcTypes } from "./fcReconcile";
import { bumpConnectionVersion } from "./graphSignals";
import { recomputeGroupCollapse } from "./groupCollapse";
import { isGraphRebuilding, markBulkTopoDirty } from "./process";

/** Badges every FC in `editor` whose unit disagrees with an annotated socket at the other end of a cable on its annotated socket. */
export function rescanUnitMismatches(editor: NodeEditor<Schemes>): void {
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    const mine = n.annotatedSocket();
    if (!mine) { formatMismatchStore.setMismatch(n.id, false); continue; }
    const myAnn = formatAnnotationStore.get(mine.nodeId, mine.socketKey);
    if (!myAnn || myAnn.unit === "none") { formatMismatchStore.setMismatch(n.id, false); continue; }
    let hasMismatch = false;
    for (const conn of editor.getConnections()) {
      const other =
        conn.source === mine.nodeId && conn.sourceOutput === mine.socketKey ? { id: conn.target, key: conn.targetInput }
        : conn.target === mine.nodeId && conn.targetInput === mine.socketKey ? { id: conn.source, key: conn.sourceOutput }
        : null;
      if (!other) continue;
      const otherAnn = formatAnnotationStore.get(other.id, other.key);
      if (otherAnn && !unitsCompatible(myAnn.unit, otherAnn.unit)) { hasMismatch = true; break; }
    }
    formatMismatchStore.setMismatch(n.id, hasMismatch);
  }
}

/** The settle every surface runs after a cable change, before its own recompute. */
export function settleCableChange(editor: NodeEditor<Schemes>, view: View | null): void {
  reconcileFcTypes(editor, view);
  bumpConnectionVersion();
  rescanUnitMismatches(editor);
  recomputeGroupCollapse(editor);
}

export type CableEnds = { source?: string; target?: string };

export type CableSettleStack = {
  editor: NodeEditor<Schemes>;
  view: View;
  isRebuilding?: () => boolean;
  /** The host's recompute after a live cable change has settled. A stack field, not a hook, because the pipe outlives a mount; a stack without it gets no cable pipe. */
  afterCableChange?: (cable: CableEnds) => void;
  cablePipeInstalled?: boolean;
};

/** Every live cable change on the stack settles here, the ones components make included ([[D16]] retypeReconciles). Once per stack: rete can't remove a pipe. */
export function installCableSettlePipe(s: CableSettleStack): void {
  if (s.cablePipeInstalled || !s.afterCableChange) return;
  s.cablePipeInstalled = true;
  s.editor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (t !== "connectioncreated" && t !== "connectionremoved") return ctx;
    if (isGraphRebuilding()) markBulkTopoDirty();
    else if (!s.isRebuilding?.()) {
      settleCableChange(s.editor, s.view);
      s.afterCableChange?.((ctx as unknown as { data: CableEnds }).data);
    }
    return ctx;
  });
}
