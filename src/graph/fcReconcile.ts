import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./rete-nodes";
import { SolenoidSocket, canConnect } from "./sockets";
import { reconcileConduitTypes } from "./conduitTrace";

/**
 * Re-adapt every Format Controller's socket type to whatever it's now attached to
 * and re-project its annotation, then re-render. This is the type-propagation pass:
 * an FC adopts the CONCRETE type flowing into it (resolving through passthrough
 * wildcard sockets), so when an upstream output's type changes — a new/removed cable,
 * a Cast, or a Note frontmatter key retyped from date→number — the downstream FCs
 * must re-resolve or they keep formatting by the stale type (a number still shown
 * as a date). Shared by the Canvas connection-event pipe AND any code that mutates
 * a socket's type without a connection event (e.g. NoteNode.syncFields).
 *
 * Does NOT call processGraph / bumpConnectionVersion — the caller owns the recompute
 * (Canvas batches more work into the same pass; the Note already recomputes).
 */
/**
 * Call after an OUTPUT socket's type is changed IN PLACE (a Cast target, a LAMBDA/
 * Expression result type, a Get Column read-as, a Note frontmatter retype). None of
 * those fire a connection event, so on their own the cables wouldn't re-validate and
 * downstream FCs wouldn't re-resolve. Reads the new type off the (already-swapped)
 * socket, keeps every outgoing cable the new type can still feed — an `any` input
 * always survives, as does same-family widening — drops only the now-incompatible
 * ones, and re-adapts the Format Controllers. The caller swaps the socket first and
 * owns the node re-render + recompute.
 */
export async function retypeOutputCables(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
  nodeId: string,
  outKey: string,
): Promise<void> {
  const outSock = editor.getNode(nodeId)?.outputs[outKey]?.socket;
  const newType = outSock instanceof SolenoidSocket ? outSock.dataType : "trueany";
  for (const c of [...editor.getConnections()]) {
    if (c.source !== nodeId || c.sourceOutput !== outKey) continue;
    const inSock = editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket;
    const inType = inSock instanceof SolenoidSocket ? inSock.dataType : undefined;
    if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
  }
  reconcileFcTypes(editor, area);
}

export function reconcileFcTypes(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): void {
  // Conduits FIRST: each lane's output socket adopts the type feeding its input,
  // so a lane carries its real type downstream (an FC docked past a Conduit, or a
  // Display, then sees the true type instead of `any`). Fixpoint over chained
  // Conduits. On a change, re-render the Conduit cards + their cables so the new
  // lane types/colours show and downstream FCs (below) resolve against them.
  if (reconcileConduitTypes(editor)) {
    for (const n of editor.getNodes()) {
      if (!(n instanceof ConduitNode)) continue;
      void area.update("node", n.id);
      for (const c of editor.getConnections()) {
        if (c.source === n.id || c.target === n.id) void area.update("connection", c.id);
      }
    }
  }
  // Convert is a hybrid node+FC with unit primacy — refresh its arrows first so the
  // chain settles in one pass (mirrors the Canvas ordering).
  for (const n of editor.getNodes()) {
    if (n instanceof ConvertNode) {
      n.syncUnitArrows(editor);
      void area.update("node", n.id);
    }
  }
  for (const n of editor.getNodes()) {
    if (!(n instanceof FormatControllerNode)) continue;
    const retyped = n.adaptTypeFromConnections(editor);
    n.refreshAnnotation(editor);
    const fcId = n.id;
    void area.update("node", fcId);
    if (retyped) {
      // A socket retype/re-render detaches cables touching it until paths recompute.
      requestAnimationFrame(() => {
        for (const conn of editor.getConnections()) {
          if (conn.source === fcId || conn.target === fcId) void area.update("connection", conn.id);
        }
      });
    }
  }
}
