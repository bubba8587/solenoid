// React Flow port (C0) — the headless graph model.
// Same compute spine as scripts/run-graph.ts: real NodeEditor + DataflowEngine
// with coercion + error guards, NO area/react plugins. React Flow is the view;
// this module is the seam it reads. Projections return plain RF-shaped objects
// (no @xyflow import) so they stay testable in the node vitest env.
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../schemes";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import * as Nodes from "../rete-nodes";
import { ctorRegistry, type NodeCtor } from "../nodeCtorRegistry";
import { nodeNameStore } from "../nodeNameStore";
import { groupCollapseStore } from "../groupCollapse";

export type SolNode = Schemes["Node"];

export type SavedNodeLite = {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
export type SavedConnectionLite = {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
};
export type SavedGraphLite = {
  v?: number;
  nodes: SavedNodeLite[];
  connections: SavedConnectionLite[];
};

export type FlowModel = {
  editor: NodeEditor<Schemes>;
  engine: DataflowEngine<Schemes>;
  /** live node id → canvas position from the save */
  positions: Map<string, { x: number; y: number }>;
};

export function resolveCtor(type: string): NodeCtor | undefined {
  const fromBarrel = (Nodes as unknown as Record<string, unknown>)[type];
  if (typeof fromBarrel === "function") return fromBarrel as NodeCtor;
  return ctorRegistry().get(type);
}

export async function buildModel(g: SavedGraphLite): Promise<FlowModel> {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);

  // One document at a time: a fresh build owns the addressable-name space.
  nodeNameStore.clear();
  const byId = new Map<string, SolNode>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const sn of g.nodes) {
    const Ctor = resolveCtor(sn.type);
    if (!Ctor) throw new Error(`Unknown node type "${sn.type}" (id ${sn.id}).`);
    const node = new Ctor({ ...sn.init }) as SolNode;
    const anyNode = node as unknown as Record<string, unknown>;
    // Inline literal maps restore ONLY onto declaring classes (persistence rule).
    if (sn.literals && "literals" in anyNode) anyNode.literals = { ...sn.literals };
    if (sn.stringLiterals && "stringLiterals" in anyNode) {
      anyNode.stringLiterals = { ...sn.stringLiterals };
    }
    byId.set(sn.id, node);
    await editor.addNode(node);
    nodeNameStore.claim(node.id, sn.name, sn.type);
    positions.set(node.id, { x: sn.x ?? 0, y: sn.y ?? 0 });
  }
  for (const c of g.connections) {
    const source = byId.get(c.source);
    const target = byId.get(c.target);
    if (!source || !target) continue;
    await editor.addConnection(
      new ClassicPreset.Connection(source, c.sourceOutput, target, c.targetInput) as Schemes["Connection"],
    );
  }
  return { editor, engine, positions };
}

// RF-shaped without the RF dependency; FlowApp hands these to <ReactFlow> as-is.
export type RFNodeLite = {
  id: string;
  type: "sol";
  /** Relative to the group box for a member (RF sub-flow), else absolute. */
  position: { x: number; y: number };
  parentId?: string;
  zIndex: number;
  className?: string;
  data: { node: SolNode; version: number };
};

/** The group a node belongs to (groups don't nest). */
export function parentGroupOf(m: FlowModel, id: string): Nodes.GroupNode | undefined {
  for (const g of m.editor.getNodes()) {
    if (g instanceof Nodes.GroupNode && g.members.includes(id)) return g;
  }
  return undefined;
}

/** The MODEL keeps absolute positions; RF positions a member relative to its group
 *  (`parentId`), so the group's own drag tows it. Convert at the boundary only. */
export function toFlowPosition(m: FlowModel, id: string, abs: { x: number; y: number }): { x: number; y: number } {
  const g = parentGroupOf(m, id);
  const gp = g ? m.positions.get(g.id) : undefined;
  return gp ? { x: abs.x - gp.x, y: abs.y - gp.y } : { x: abs.x, y: abs.y };
}

export function fromFlowPosition(
  m: FlowModel,
  rel: { x: number; y: number },
  parentId: string | undefined,
): { x: number; y: number } {
  const gp = parentId ? m.positions.get(parentId) : undefined;
  return gp ? { x: rel.x + gp.x, y: rel.y + gp.y } : { x: rel.x, y: rel.y };
}

/** Collapsed-group member hiding rides RF's own `className` — the wrapper's
 *  inline `visibility` belongs to RF (it stamps `visible` after measuring), so
 *  any imperative stamp gets overwritten; the class + `!important` rule
 *  (flow.css) is the one channel RF preserves. */
export function nodeClassName(node: SolNode): string | undefined {
  const cls = [];
  if (groupCollapseStore.isNodeHidden(node.id)) cls.push("sol-member-hidden");
  // A Conduit's node box is a fixed 92 square around a much smaller block, so the box
  // itself must not take pointers — the painted shell and lane squares do (conduit.css).
  if (node instanceof Nodes.ConduitNode) cls.push("sol-conduit-node");
  return cls.length ? cls.join(" ") : undefined;
}

/** The rete surface's area-plane z-order (groups −2 < conduits −1 < nodes 0);
 *  without it a group's body sits level with its members and eats their
 *  pointer events. */
export function nodeZIndex(node: SolNode): number {
  if (node instanceof Nodes.GroupNode) return -2;
  if (node instanceof Nodes.ConduitNode) return -1;
  return 0;
}
export type RFEdgeLite = {
  id: string;
  type: "cable";
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export function toFlowNodes(m: FlowModel): RFNodeLite[] {
  const nodes = m.editor.getNodes();
  const groupOf = new Map<string, string>();
  for (const g of nodes) {
    if (g instanceof Nodes.GroupNode) for (const member of g.members) groupOf.set(member, g.id);
  }
  // RF requires a parent before its children in the array.
  const ordered = [
    ...nodes.filter((n) => n instanceof Nodes.GroupNode),
    ...nodes.filter((n) => !(n instanceof Nodes.GroupNode)),
  ];
  return ordered.map((node) => {
    const abs = m.positions.get(node.id) ?? { x: 0, y: 0 };
    const parentId = groupOf.get(node.id);
    const parentPos = parentId ? m.positions.get(parentId) : undefined;
    return {
      id: node.id,
      type: "sol",
      position: parentPos ? { x: abs.x - parentPos.x, y: abs.y - parentPos.y } : { x: abs.x, y: abs.y },
      parentId: parentPos ? parentId : undefined,
      zIndex: nodeZIndex(node),
      className: nodeClassName(node),
      data: { node, version: 0 },
    };
  });
}

export function toFlowEdges(m: FlowModel): RFEdgeLite[] {
  return m.editor.getConnections().map((c) => ({
    id: c.id,
    type: "cable",
    source: c.source,
    sourceHandle: c.sourceOutput,
    target: c.target,
    targetHandle: c.targetInput,
  }));
}
