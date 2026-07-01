// Human-addressable node names + connectable endpoints, for the connection
// dialog (and later the Navigator). Names are derived live, never stored:
// the header title, with a 1-based index appended only when several nodes
// share a title (so "Annual Total" stays bare, but two "Arithmetic" become
// "Arithmetic 1" / "Arithmetic 2"). Untitled nodes fall back to their type.
import type { ClassicPreset } from "rete";
import { getEditor } from "./process";
import { SolenoidSocket, type SocketDataType } from "./sockets";
import { GroupNode, FormatControllerNode } from "./rete-nodes";

type AnyNode = {
  id: string;
  label?: string;
  inputs: Record<string, { socket?: ClassicPreset.Socket; label?: string } | undefined>;
  outputs: Record<string, { socket?: ClassicPreset.Socket; label?: string } | undefined>;
  constructor: { name: string };
};

// Readable node-type string — class name minus the "Node" suffix, camelCase
// split. Same derivation as the header hover hint; also shown in the status
// bar for a single selection.
export function nodeTypeName(n: { constructor: { name: string } }): string {
  return n.constructor.name.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}
const typeName = nodeTypeName as (n: AnyNode) => string;

function baseName(n: AnyNode): string {
  const label = (n.label ?? "").trim();
  return label || typeName(n);
}

/** Map of node id → display name (title, + index when the title isn't unique). */
export function nodeDisplayNames(nodes: AnyNode[]): Map<string, string> {
  const groups = new Map<string, AnyNode[]>();
  for (const n of nodes) {
    const b = baseName(n);
    const arr = groups.get(b);
    if (arr) arr.push(n);
    else groups.set(b, [n]);
  }
  const out = new Map<string, string>();
  for (const [base, list] of groups) {
    if (list.length === 1) out.set(list[0].id, base);
    else list.forEach((n, i) => out.set(n.id, `${base} ${i + 1}`));
  }
  return out;
}

export type Endpoint = {
  nodeId: string;
  socketKey: string;
  side: "output" | "input";
  nodeName: string;
  socketLabel: string;
  dataType?: SocketDataType;
  /** "NodeName : SocketLabel" — used for fuzzy search and display. */
  text: string;
};

/** Every wireable endpoint on one side of the graph (Groups / FCs excluded). */
export function listEndpoints(side: "output" | "input"): Endpoint[] {
  const editor = getEditor();
  if (!editor) return [];
  const nodes = editor.getNodes().filter(
    (n) => !(n instanceof GroupNode) && !(n instanceof FormatControllerNode),
  ) as unknown as AnyNode[];
  const names = nodeDisplayNames(nodes);
  const eps: Endpoint[] = [];
  for (const n of nodes) {
    const ports = side === "output" ? n.outputs : n.inputs;
    for (const [key, port] of Object.entries(ports)) {
      if (!port) continue;
      const socketLabel = port.label || key;
      const dataType = port.socket instanceof SolenoidSocket ? port.socket.dataType : undefined;
      const nodeName = names.get(n.id) ?? key;
      eps.push({ nodeId: n.id, socketKey: key, side, nodeName, socketLabel, dataType, text: `${nodeName} : ${socketLabel}` });
    }
  }
  return eps;
}

/** Resolve an endpoint by (nodeId, socketKey) on a side — for edit prefill. */
export function findEndpoint(side: "output" | "input", nodeId: string, socketKey: string): Endpoint | undefined {
  return listEndpoints(side).find((e) => e.nodeId === nodeId && e.socketKey === socketKey);
}

export type ConnRow = {
  id: string;                 // connection id
  dir: "in" | "out";          // relative to the queried node
  thisSocketLabel: string;    // the queried node's socket
  otherNodeName: string;      // the connected node's display name
  otherSocketLabel: string;   // the connected node's socket
};

/**
 * Every connection touching `nodeId`, described from that node's point of view
 * ("out" = its output feeds another's input; "in" = another's output feeds it).
 * Connections to Groups / Format Controllers are skipped (internal plumbing).
 */
export function nodeConnections(nodeId: string): ConnRow[] {
  const editor = getEditor();
  if (!editor) return [];
  const real = editor.getNodes().filter(
    (n) => !(n instanceof GroupNode) && !(n instanceof FormatControllerNode),
  ) as unknown as AnyNode[];
  const names = nodeDisplayNames(real);
  const socketLabel = (id: string, key: string, side: "output" | "input"): string => {
    const n = editor.getNode(id) as unknown as AnyNode | undefined;
    const port = (side === "output" ? n?.outputs : n?.inputs)?.[key];
    return (port?.label as string) || key;
  };
  const rows: ConnRow[] = [];
  for (const c of editor.getConnections()) {
    if (c.source === nodeId && names.has(c.target)) {
      rows.push({
        id: c.id, dir: "out",
        thisSocketLabel: socketLabel(nodeId, c.sourceOutput, "output"),
        otherNodeName: names.get(c.target)!,
        otherSocketLabel: socketLabel(c.target, c.targetInput, "input"),
      });
    } else if (c.target === nodeId && names.has(c.source)) {
      rows.push({
        id: c.id, dir: "in",
        thisSocketLabel: socketLabel(nodeId, c.targetInput, "input"),
        otherNodeName: names.get(c.source)!,
        otherSocketLabel: socketLabel(c.source, c.sourceOutput, "output"),
      });
    }
  }
  return rows;
}

