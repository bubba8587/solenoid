// [[B10]] reactFlowView, [[C65]] domOrderStacking, [[C43]] oneFlowSurface, [[C87]] groupsAreSubflows
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode } from "../schemes";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import * as Nodes from "../rete-nodes";
import { ctorRegistry, type NodeCtor } from "../nodeCtorRegistry";
import { nodeNameStore } from "../nodeNameStore";
import { groupCollapseStore } from "../groupCollapse";
import { isolateStore } from "../isolateStore";
import { SolenoidSocket } from "../sockets";
import { FLAT_CATALOG } from "../catalogUtils";

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

  nodeNameStore.clear();
  const byId = new Map<string, SolenoidNode>();
  for (const sn of g.nodes) {
    const Ctor = resolveCtor(sn.type);
    if (!Ctor) throw new Error(`Unknown node type "${sn.type}" (id ${sn.id}).`);
    const node = new Ctor({ ...sn.init }) as SolenoidNode;
    const anyNode = node as unknown as Record<string, unknown>;
    if (sn.literals && "literals" in anyNode) anyNode.literals = { ...sn.literals };
    if (sn.stringLiterals && "stringLiterals" in anyNode) {
      anyNode.stringLiterals = { ...sn.stringLiterals };
    }
    byId.set(sn.id, node);
    node.position = { x: sn.x ?? 0, y: sn.y ?? 0 };
    await editor.addNode(node);
    nodeNameStore.claim(node.id, sn.name, sn.type);
  }
  for (const c of g.connections) {
    const source = byId.get(c.source);
    const target = byId.get(c.target);
    if (!source || !target) continue;
    await editor.addConnection(
      new ClassicPreset.Connection(source, c.sourceOutput, target, c.targetInput) as Schemes["Connection"],
    );
  }
  return { editor, engine };
}


export function canConnect(
  m: FlowModel,
  source: string,
  sourceOutput: string,
  target: string,
  targetInput: string,
): boolean {
  if (source === target) return false;
  const src = m.editor.getNode(source)?.outputs[sourceOutput]?.socket;
  const tgt = m.editor.getNode(target)?.inputs[targetInput]?.socket;
  if (src instanceof SolenoidSocket && tgt instanceof SolenoidSocket) {
    return src.canConnectTo(tgt);
  }
  return !!(src && tgt);
}

export async function connect(
  m: FlowModel,
  source: string,
  sourceOutput: string,
  target: string,
  targetInput: string,
): Promise<boolean> {
  if (!canConnect(m, source, sourceOutput, target, targetInput)) return false;
  const sourceNode = m.editor.getNode(source);
  const targetNode = m.editor.getNode(target);
  if (!sourceNode || !targetNode) return false;
  const input = targetNode.inputs[targetInput] as { multipleConnections?: boolean } | undefined;
  if (!input?.multipleConnections) {
    for (const c of m.editor.getConnections()) {
      if (c.target === target && c.targetInput === targetInput) {
        await m.editor.removeConnection(c.id);
      }
    }
  }
  await m.editor.addConnection(
    new ClassicPreset.Connection(sourceNode, sourceOutput, targetNode, targetInput) as Schemes["Connection"],
  );
  return true;
}

export async function disconnect(m: FlowModel, connectionId: string): Promise<void> {
  if (m.editor.getConnection(connectionId)) await m.editor.removeConnection(connectionId);
}

export async function removeNodes(m: FlowModel, ids: string[]): Promise<void> {
  const doomed = new Set(ids);
  for (const c of m.editor.getConnections()) {
    if (doomed.has(c.source) || doomed.has(c.target)) await m.editor.removeConnection(c.id);
  }
  for (const id of ids) {
    if (!m.editor.getNode(id)) continue;
    await m.editor.removeNode(id);
    nodeNameStore.forget(id);
  }
}

export async function addNode(
  m: FlowModel,
  catalogType: string,
  position: { x: number; y: number },
): Promise<SolenoidNode | null> {
  const entry = FLAT_CATALOG.get(catalogType);
  if (!entry) return null;
  const node = entry.create() as SolenoidNode;
  node.position = { x: Math.round(position.x), y: Math.round(position.y) };
  await m.editor.addNode(node);
  nodeNameStore.ensure(node.id, node.constructor.name);
  return node;
}

export function moveNode(m: FlowModel, id: string, position: { x: number; y: number }): void {
  const node = m.editor.getNode(id);
  if (node) node.position = { x: position.x, y: position.y };
}

// RF-shaped without importing RF, so these stay testable in the node vitest env.
export type RFNodeLite = {
  id: string;
  type: "sol";
  position: { x: number; y: number };
  parentId?: string;
  zIndex: number;
  className?: string;
  draggable?: boolean;
  data: { node: SolenoidNode; version: number };
};

export function parentGroupOf(m: FlowModel, id: string): Nodes.GroupNode | undefined {
  for (const g of m.editor.getNodes()) {
    if (g instanceof Nodes.GroupNode && g.members.includes(id)) return g;
  }
  return undefined;
}

export function toFlowPosition(m: FlowModel, id: string, abs: { x: number; y: number }): { x: number; y: number } {
  const g = parentGroupOf(m, id);
  const gp = g ? (g as SolenoidNode).position : undefined;
  return gp ? { x: abs.x - gp.x, y: abs.y - gp.y } : { x: abs.x, y: abs.y };
}

export function fromFlowPosition(
  m: FlowModel,
  rel: { x: number; y: number },
  parentId: string | undefined,
): { x: number; y: number } {
  const gp = parentId ? m.editor.getNode(parentId)?.position : undefined;
  return gp ? { x: rel.x + gp.x, y: rel.y + gp.y } : { x: rel.x, y: rel.y };
}

export function nodeClassName(node: SolenoidNode): string | undefined {
  const cls = [];
  if (groupCollapseStore.isNodeHidden(node.id)) cls.push("sol-member-hidden");
  if (!isolateStore.isVisible(node.id)) cls.push("sol-isolate-dim");
  if (node instanceof Nodes.ConduitNode) cls.push("sol-conduit-node");
  if (node instanceof Nodes.GroupNode && !node.collapsed) cls.push("sol-group-open");
  return cls.length ? cls.join(" ") : undefined;
}

export function nodeZIndex(node: SolenoidNode): number {
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
  const ordered: SolenoidNode[] = [
    ...nodes.filter((n) => n instanceof Nodes.GroupNode),
    ...nodes.filter((n) => !(n instanceof Nodes.GroupNode)),
  ];
  return ordered.map((node) => {
    const abs = node.position ?? { x: 0, y: 0 };
    const parentId = groupOf.get(node.id);
    const parentPos = parentId ? m.editor.getNode(parentId)?.position : undefined;
    const locked = node instanceof Nodes.GroupNode && node.lockedPosition;
    return {
      id: node.id,
      type: "sol",
      position: parentPos ? { x: abs.x - parentPos.x, y: abs.y - parentPos.y } : { x: abs.x, y: abs.y },
      parentId: parentPos ? parentId : undefined,
      zIndex: nodeZIndex(node),
      className: nodeClassName(node),
      draggable: locked ? false : undefined,
      data: { node, version: 0 },
    };
  });
}

type MergedNode = Omit<RFNodeLite, "type" | "zIndex"> & { type?: string; zIndex?: number; selected?: boolean };

/** Keeps the object of every unchanged node, so RF's memo skips it. RF's selection wins for a node it already holds; a node it hasn't seen takes the model's flag, since a paste selects its clones before RF has them. */
export function mergeFlowNodes<T extends MergedNode>(prev: readonly T[], next: readonly RFNodeLite[]): T[] {
  const prevById = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const old = prevById.get(n.id);
    if (
      old &&
      old.position.x === n.position.x &&
      old.position.y === n.position.y &&
      old.parentId === n.parentId &&
      old.zIndex === n.zIndex &&
      old.className === n.className &&
      old.draggable === n.draggable
    ) {
      return old;
    }
    return {
      ...n,
      selected: old ? old.selected ?? false : n.data.node.selected === true,
      data: { ...n.data, version: old?.data.version ?? 0 },
    } as unknown as T;
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
