import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { FormatControllerNode, ConvertNode, ConduitNode } from "./rete-nodes";
import { SolenoidSocket, canConnect } from "./sockets";
import { settleWildcardTypes } from "./trueAnyAdopt";

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
  // Derived socket types FIRST: Conduit lanes adopt the type feeding them, and
  // every trueany PLACEHOLDER port adopts the wired cable's type (trueAnyAdopt —
  // D17), alternated to a joint fixpoint so chains through both settle. On a
  // change, re-render the affected cards + their cables so the new types/colors
  // show and downstream FCs (below) resolve against them.
  const settled = settleWildcardTypes(editor);
  if (settled.conduitChanged) {
    for (const n of editor.getNodes()) {
      if (!(n instanceof ConduitNode)) continue;
      void area.update("node", n.id);
      for (const c of editor.getConnections()) {
        if (c.source === n.id || c.target === n.id) void area.update("connection", c.id);
      }
    }
  }
  for (const id of settled.adopted) {
    void area.update("node", id);
    for (const c of editor.getConnections()) {
      if (c.source === id || c.target === id) void area.update("connection", c.id);
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

/**
 * Call after a LITERAL edit commits (an inline field, a config dropdown) — the value
 * path, where no connection event fires. Most literals move only VALUES, and this is a
 * no-op; some move a SOCKET TYPE, because a socket type can be derived from static
 * CONFIG as well as from wiring: INDEX reads its Column literal plus the static column
 * shape of the frame upstream, and that shape is itself built out of every frame verb's
 * literal config (Select Columns' list, Rename's map, a Frame Input's text). Editing
 * any of them can retype an INDEX three nodes downstream.
 *
 * Cheap by construction: the settle is a pure socket walk, and the FULL reconcile (FC
 * re-adaptation + the re-renders) is paid ONLY when a type actually moved — so the
 * overwhelmingly common "a literal changed a number" edit costs one settle pass.
 */
export function reconcileTypesAfterEdit(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
): void {
  const settled = settleWildcardTypes(editor);
  if (!settled.conduitChanged && settled.adopted.size === 0) return;
  reconcileFcTypes(editor, area); // re-settles (a no-op fixpoint) and owns the renders
}
