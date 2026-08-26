// React Flow port (C1) — editing + recompute verbs over a FlowModel.
// Mirrors process.ts's pass shape (targeted cache-cone invalidation, #CIRC!
// seeding, never engine.reset(id) — the rete-engine recursion bug) without the
// area/render half: values are RETURNED and the view re-renders from state.
import { ClassicPreset } from "rete";
import { Cancelled } from "rete-engine";
import { downstreamClosure, loopMembers } from "../process";
import { resolveTrigModes } from "../trigMode";
import { solError } from "../errorValue";
import { SolenoidSocket } from "../sockets";
import { nodeNameStore } from "../nodeNameStore";
import { extractInit } from "../copyPaste";
import { writeTextForm, readTextForm } from "../textForm";
import { CURRENT_SAVE_VERSION } from "../persistenceCore";
import type { SavedGraph, SavedNode } from "../persistence";
import { FLAT_CATALOG } from "../catalogUtils";
import type { FlowModel, SolNode } from "./flowModel";

export type Values = Map<string, Record<string, unknown> | null>;

/** Recompute and return every node's outputs. `changedId` invalidates only its
 *  downstream cone; omitted = full reset (topology changes, first load). */
export async function recompute(m: FlowModel, changedId?: string): Promise<Values> {
  resolveTrigModes(m.editor);
  const affected = changedId ? downstreamClosure(m.editor, changedId) : null;
  if (affected) for (const id of affected) m.engine.cache.delete(id);
  else m.engine.reset();

  // Loop members never run — seed their caches (and value-box fields) with
  // #CIRC! BEFORE fetching, or the pull engine deadlocks resolving the cycle.
  const circ = solError(
    "#CIRC!",
    "This node is part of a circular dependency: the calculation feeds back into itself",
  );
  for (const id of loopMembers(m.editor)) {
    const node = m.editor.getNode(id);
    if (!node) continue;
    const outputs: Record<string, unknown> = {};
    for (const k of Object.keys(node.outputs ?? {})) outputs[k] = circ;
    const n = node as unknown as { cachedResult?: unknown; cachedValue?: unknown; cachedList?: unknown };
    if ("cachedResult" in n) n.cachedResult = circ;
    if ("cachedValue" in n) n.cachedValue = circ;
    if ("cachedList" in n) n.cachedList = circ;
    const seeded = Object.assign(Promise.resolve(outputs), { cancel() {} });
    try {
      m.engine.cache.add(id, seeded);
    } catch {
      m.engine.cache.patch(id, seeded);
    }
  }

  const out: Values = new Map();
  for (const node of m.editor.getNodes()) {
    try {
      out.set(node.id, (await m.engine.fetch(node.id)) as Record<string, unknown>);
    } catch (e) {
      if (e instanceof Cancelled) out.set(node.id, null);
      else throw e;
    }
  }
  return out;
}

/** The lattice rule + no self-loop — same gate as makeSolenoidConnectionFlow. */
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

/** Add a cable; a single-connection input evicts its existing cable first
 *  (the connection plugin's behavior on the rete surface). */
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
    new ClassicPreset.Connection(sourceNode, sourceOutput, targetNode, targetInput) as Parameters<
      typeof m.editor.addConnection
    >[0],
  );
  return true;
}

export async function disconnect(m: FlowModel, connectionId: string): Promise<void> {
  if (m.editor.getConnection(connectionId)) await m.editor.removeConnection(connectionId);
}

/** Remove nodes and their cables through the editor; names and positions go too. */
export async function removeNodes(m: FlowModel, ids: string[]): Promise<void> {
  const doomed = new Set(ids);
  for (const c of m.editor.getConnections()) {
    if (doomed.has(c.source) || doomed.has(c.target)) await m.editor.removeConnection(c.id);
  }
  for (const id of ids) {
    if (!m.editor.getNode(id)) continue;
    await m.editor.removeNode(id);
    nodeNameStore.forget(id);
    m.positions.delete(id);
  }
}

/** Instantiate a catalog entry at a canvas position. */
export async function addNode(
  m: FlowModel,
  catalogType: string,
  position: { x: number; y: number },
): Promise<SolNode | null> {
  const entry = FLAT_CATALOG.get(catalogType);
  if (!entry) return null;
  const node = entry.create() as SolNode;
  await m.editor.addNode(node);
  m.positions.set(node.id, { x: Math.round(position.x), y: Math.round(position.y) });
  nodeNameStore.ensure(node.id, node.constructor.name);
  return node;
}

export function moveNode(m: FlowModel, id: string, position: { x: number; y: number }): void {
  if (m.positions.has(id)) m.positions.set(id, { x: position.x, y: position.y });
}

/** Serialize through the SAME canonicalization as the rete surface
 *  (extractInit → text form round-trip), so a flow-surface save is a normal
 *  Solenoid document. */
export function serialize(m: FlowModel): SavedGraph {
  const nodes: SavedNode[] = m.editor.getNodes().map((n) => {
    const pos = m.positions.get(n.id) ?? { x: 0, y: 0 };
    const anyN = n as unknown as Record<string, unknown>;
    const sn: SavedNode = {
      id: n.id,
      type: n.constructor.name,
      name: nodeNameStore.ensure(n.id, n.constructor.name),
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      init: extractInit(n),
    };
    if (anyN.literals && typeof anyN.literals === "object") {
      sn.literals = { ...(anyN.literals as Record<string, number>) };
    }
    if (anyN.stringLiterals && typeof anyN.stringLiterals === "object") {
      sn.stringLiterals = { ...(anyN.stringLiterals as Record<string, string>) };
    }
    return sn;
  });
  const raw: SavedGraph = {
    v: CURRENT_SAVE_VERSION,
    nodes,
    connections: m.editor.getConnections().map((c) => ({
      source: c.source,
      sourceOutput: c.sourceOutput,
      target: c.target,
      targetInput: c.targetInput,
    })),
  };
  return readTextForm(writeTextForm(raw));
}
