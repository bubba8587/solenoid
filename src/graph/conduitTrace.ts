import type { ClassicPreset, NodeEditor } from "rete";
import { ConduitNode, conduitLaneOf, conduitInKey, conduitOutKey, CONDUIT_MAX_LANES } from "./rete-nodes";
import { SolenoidSocket, MutableSocket, type SocketDataType } from "./sockets";
import type { Schemes } from "./schemes";

// ─── Conduit type tracing ──────────────────────────────────────────────────────
// A Conduit is a pure passthrough (out_i = in_i), but its lane sockets are all
// `any`, so a value leaving a Conduit resolves its cable color by the JS VALUE
// type — lossy: a date is a serial number, a boolean/frame/cube an object, so
// they'd all color as number/gray. Trace a Conduit output lane back to whatever
// feeds the matching input lane (recursively, for chained Conduits) so the cable
// takes the REAL source socket's type + value — the type color carries through
// the Conduit unchanged (date stays pink, logical purple, frame violet, …).
// Kept in a pure module (no React) so it's unit-testable.

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

/**
 * Make every Conduit's OUTPUT lanes adopt the type feeding the matching input
 * lane (via resolveTypedSource, so it sees through upstream Conduits), so a lane
 * carries its real type downstream instead of an opaque `any`. Mutates the lane's
 * MutableSocket in place. Returns true if ANY lane's type changed — the caller
 * loops to a fixpoint (chained Conduits settle over a couple of passes) and then
 * re-validates downstream cables + Format Controllers. An unwired lane reverts to
 * `any`. Pure w.r.t. the store; the caller owns re-render + recompute.
 */
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

// ─── Conduit path tracing ──────────────────────────────────────────────────────
// A Conduit is WIRING, not computation, so the cable you clicked is one SEGMENT
// of a longer run. `conduitPath` walks that whole run: upstream along each lane
// to the node that actually PRODUCES the value, and downstream — fanning out,
// since one output lane can feed several cables — to every input that actually
// CONSUMES it. Two callers: the Cable inspector (report the real ends, not the
// Conduit sitting in the middle) and double-click cable selection (light up the
// whole run). Pure; the editor is read-only here.

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

// Bounds the walk on a #CIRC! conduit loop and on a pathological fan-out; the
// `seen` set already breaks true cycles, this just caps the work.
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

  // Downstream is a tree — one output lane can drive many cables — and it is
  // walked from the ORIGIN cable, not from the clicked one, so EVERY segment of
  // a run resolves to the same run (clicking one branch of a fan-out must not
  // hide its siblings, which carry the very same value). The walk from the head
  // re-crosses the Conduits climbed above, so they need no separate bookkeeping.
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
  // Fixpoint: a chain of Conduits settles in as many passes as the chain is deep
  // (each pass resolves through one more already-adapted Conduit). Capped well
  // above any real chain length (a #CIRC! conduit loop is also bounded by the cap).
  let anyChanged = false;
  for (let pass = 0; pass < 32; pass++) {
    if (!reconcileConduitTypesOnce(editor)) break;
    anyChanged = true;
  }
  return anyChanged;
}
