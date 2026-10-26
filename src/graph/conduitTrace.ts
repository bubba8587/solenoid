// [[C10]] socketLattice
import type { GraphSocket } from "./graphModel";
import { ConduitNode, conduitLaneOf, conduitInKey, conduitOutKey } from "./nodeClasses";


export type TypedSource = {
  socket: GraphSocket | undefined;
  source: string;
  sourceOutput: string;
};

interface TraceEditor {
  getNode(id: string): { outputs?: Record<string, { socket?: GraphSocket } | undefined> } | undefined;
  getConnections(): ReadonlyArray<{ source: string; sourceOutput: string; target: string; targetInput: string }>;
}

export function resolveTypedSource(
  editor: TraceEditor | null | undefined,
  nodeId: string,
  outputKey: string,
  depth = 0,
): TypedSource {
  const node = editor?.getNode(nodeId);
  // The depth cap keeps a Conduit loop (a #CIRC! graph) from trapping the walk.
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

export interface PathConn {
  id: string;
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export interface ConduitPathEnd {
  nodeId: string;
  key: string;
}

export interface ConduitPath {
  connIds: string[];
  origin: ConduitPathEnd;
  terminals: ConduitPathEnd[];
  conduits: string[];
}

interface PathEditor {
  getNode(id: string): unknown;
  getConnections(): ReadonlyArray<PathConn>;
}

const MAX_HOPS = 512;

export function conduitPath(editor: PathEditor | null | undefined, conn: PathConn): ConduitPath {
  const conns = editor?.getConnections() ?? [];
  const isConduit = (id: string) => editor?.getNode(id) instanceof ConduitNode;

  const climbed = new Set<string>([conn.id]);
  let head = conn;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isConduit(head.source)) break;
    const lane = conduitLaneOf(head.sourceOutput, "out");
    if (lane < 0) break;
    const inKey = conduitInKey(lane);
    const via = head.source;
    const feed = conns.find((c) => c.target === via && c.targetInput === inKey);
    if (!feed || climbed.has(feed.id)) break;
    climbed.add(feed.id);
    head = feed;
  }

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
