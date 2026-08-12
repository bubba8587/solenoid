import type { ClassicPreset, NodeEditor } from "rete";
import { ConduitNode, conduitLaneOf, conduitInKey, conduitOutKey, CONDUIT_MAX_LANES } from "./rete-nodes";
import { SolenoidSocket, MutableSocket, type SocketDataType } from "./sockets";
import type { Schemes } from "./schemes";

// A Conduit's lane sockets are all `any`, so typing a leaving value by its JS VALUE
// is lossy (a date is a number, a frame an object). Tracing the lane back to its real
// source keeps the type through the Conduit unchanged. Pure module — no React.

export type TypedSource = {
  socket: ClassicPreset.Socket | undefined;
  source: string;
  sourceOutput: string;
};

interface TraceEditor {
  getNode(id: string): { outputs?: Record<string, { socket?: ClassicPreset.Socket } | undefined> } | undefined;
  getConnections(): ReadonlyArray<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
}

export function resolveTypedSource(
  editor: TraceEditor | null | undefined,
  nodeId: string,
  outputKey: string,
  depth = 0,
): TypedSource {
  const node = editor?.getNode(nodeId);
  // depth cap guards against a Conduit loop (a #CIRC! graph) trapping the walk.
  if (node instanceof ConduitNode && depth < 16) {
    const lane = conduitLaneOf(outputKey, "out");
    if (lane >= 0) {
      const inKey = conduitInKey(lane);
      const feed = editor?.getConnections().find((c) => c.target === nodeId && c.targetInput === inKey);
      if (feed) return resolveTypedSource(editor, feed.source, feed.sourceOutput, depth + 1);
    }
  }
  return { socket: node?.outputs?.[outputKey]?.socket, source: nodeId, sourceOutput: outputKey };
}

/** Mutates each lane's MutableSocket in place and returns true if ANY type changed,
 *  so the caller can loop to a fixpoint; an unwired lane reverts to `any`. The
 *  caller owns re-render, recompute, and re-validating downstream cables/FCs. */
function reconcileConduitTypesOnce(editor: NodeEditor<Schemes>): boolean {
  let changed = false;
  const conns = editor.getConnections();
  for (const node of editor.getNodes()) {
    if (!(node instanceof ConduitNode)) continue;
    for (let i = 0; i < CONDUIT_MAX_LANES; i++) {
      const outSock = node.outputs[conduitOutKey(i)]?.socket;
      if (!(outSock instanceof MutableSocket)) continue;
      const feed = conns.find((c) => c.target === node.id && c.targetInput === conduitInKey(i));
      let newType: SocketDataType = "trueany";
      if (feed) {
        const resolved = resolveTypedSource(editor, feed.source, feed.sourceOutput);
        if (resolved.socket instanceof SolenoidSocket) newType = resolved.socket.dataType;
      }
      if (outSock.dataType !== newType) { outSock.setType(newType); changed = true; }
    }
  }
  return changed;
}

// A Conduit is WIRING, not computation, so a clicked cable is one SEGMENT of a run:
// `conduitPath` walks upstream to the real producer and downstream (fanning out) to
// every real consumer.

/** The subset of a rete connection the walk needs. */
export interface PathConn {
  id: string;
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

/** A node + port the run terminates on. */
export interface ConduitPathEnd {
  nodeId: string;
  key: string;
}

export interface ConduitPath {
  /** Every cable on the run, upstream-first, the clicked one included. */
  connIds: string[];
  /** Where the value is really produced — a Conduit only if its lane is unfed. */
  origin: ConduitPathEnd;
  /** Every input the run really reaches — a Conduit only if its lane is unused. */
  terminals: ConduitPathEnd[];
  /** Conduits the run passes THROUGH, upstream → downstream. */
  conduits: string[];
}

interface PathEditor {
  getNode(id: string): unknown;
  getConnections(): ReadonlyArray<PathConn>;
}

// The `seen` set already breaks true cycles; this just caps pathological fan-out.
const MAX_HOPS = 512;

export function conduitPath(editor: PathEditor | null | undefined, conn: PathConn): ConduitPath {
  const conns = editor?.getConnections() ?? [];
  const isConduit = (id: string) => editor?.getNode(id) instanceof ConduitNode;

  // Upstream is a plain chain — a Conduit input lane takes at most one cable.
  const climbed = new Set<string>([conn.id]);
  let head = conn;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isConduit(head.source)) break;
    const lane = conduitLaneOf(head.sourceOutput, "out");
    if (lane < 0) break;
    const inKey = conduitInKey(lane);
    const via = head.source;
    const feed = conns.find((c) => c.target === via && c.targetInput === inKey);
    // No feed → the lane is unwired and the Conduit itself IS the origin.
    if (!feed || climbed.has(feed.id)) break;
    climbed.add(feed.id);
    head = feed;
  }

  // Downstream is a tree, walked from the ORIGIN cable rather than the clicked one,
  // so every segment of a run resolves to the SAME run and no fan-out sibling hides.
  const connIds: string[] = [head.id];
  const seen = new Set<string>([head.id]);
  const conduits: string[] = [];
  const terminals: ConduitPathEnd[] = [];
  const queue: PathConn[] = [head];
  for (let hop = 0; queue.length > 0 && hop < MAX_HOPS; hop++) {
    const cur = queue.shift()!;
    const lane = isConduit(cur.target) ? conduitLaneOf(cur.targetInput, "in") : -1;
    if (lane < 0) {
      terminals.push({ nodeId: cur.target, key: cur.targetInput });
      continue;
    }
    const outKey = conduitOutKey(lane);
    const outs = conns.filter((c) => c.source === cur.target && c.sourceOutput === outKey && !seen.has(c.id));
    if (outs.length === 0) {
      // The lane dies inside the Conduit — nothing consumes it further on.
      terminals.push({ nodeId: cur.target, key: cur.targetInput });
      continue;
    }
    if (!conduits.includes(cur.target)) conduits.push(cur.target);
    for (const o of outs) {
      seen.add(o.id);
      connIds.push(o.id);
      queue.push(o);
    }
  }

  return { connIds, origin: { nodeId: head.source, key: head.sourceOutput }, terminals, conduits };
}

export function reconcileConduitTypes(editor: NodeEditor<Schemes>): boolean {
  // A chain of Conduits settles in as many passes as it is deep; the cap sits well
  // above any real chain and also bounds a #CIRC! loop.
  let anyChanged = false;
  for (let pass = 0; pass < 32; pass++) {
    if (!reconcileConduitTypesOnce(editor)) break;
    anyChanged = true;
  }
  return anyChanged;
}
