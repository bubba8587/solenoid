// [[C23]] calcModes
import type { NodeEditor } from "rete";
import type { DataflowEngine } from "rete-engine";
import { Cancelled } from "rete-engine";
import { solError } from "./errorValue";
import { resolveTrigModes } from "./trigMode";
import { clearCollectMemo } from "./frameBackend";
import type { Schemes } from "./schemes";

type Editor = NodeEditor<Schemes>;
type Engine = DataflowEngine<Schemes>;

export type NodeOutputs = Record<string, unknown>;
export type PassValues = Map<string, NodeOutputs | null>;

export const CIRC_MESSAGE =
  "This node is part of a circular dependency: the calculation feeds back into itself";

export function loopMembers(editor: Editor): Set<string> {
  const ids = editor.getNodes().map((n) => n.id);
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  const selfLoops = new Set<string>();
  for (const c of editor.getConnections()) {
    if (c.source === c.target) { selfLoops.add(c.source); continue; }
    if (adj.has(c.source) && adj.get(c.source)!.indexOf(c.target) === -1 && ids.includes(c.target)) {
      adj.get(c.source)!.push(c.target);
    }
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const members = new Set<string>(selfLoops);
  let counter = 0;
  // Iterative: recursion would overflow the stack on a large graph.
  for (const start of ids) {
    if (index.has(start)) continue;
    const work: Array<{ node: string; i: number }> = [{ node: start, i: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame.node;
      if (frame.i === 0) {
        index.set(v, counter); low.set(v, counter); counter++;
        stack.push(v); onStack.add(v);
      }
      const neighbors = adj.get(v)!;
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i];
        frame.i++;
        if (!index.has(w)) {
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      } else {
        if (low.get(v) === index.get(v)) {
          const comp: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
          if (comp.length > 1) for (const id of comp) members.add(id);
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
      }
    }
  }
  return members;
}

export function downstreamClosure(editor: Editor, startId: string): Set<string> {
  const out = new Map<string, string[]>();
  for (const c of editor.getConnections()) {
    (out.get(c.source) ?? out.set(c.source, []).get(c.source)!).push(c.target);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of out.get(id) ?? []) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  }
  return seen;
}

// Never `engine.reset(id)`: it recurses with no visited set and overflows on a cable cycle.
export function invalidate(editor: Editor, engine: Engine, changedId?: string, keepCaches = false): Set<string> | null {
  if (!changedId) { if (!keepCaches) engine.reset(); return null; }
  const cone = downstreamClosure(editor, changedId);
  for (const id of cone) engine.cache.delete(id);
  return cone;
}

export function seedLoopErrors(editor: Editor, engine: Engine, loop: Set<string>, message = CIRC_MESSAGE): void {
  if (loop.size === 0) return;
  const circ = solError("#CIRC!", message);
  for (const id of loop) {
    const node = editor.getNode(id);
    if (!node) continue;
    const outputs: NodeOutputs = {};
    for (const k of Object.keys(node.outputs ?? {})) outputs[k] = circ;
    const n = node as unknown as { cachedResult?: unknown; cachedValue?: unknown; cachedList?: unknown; cachedChart?: unknown; cachedPayload?: unknown };
    if ("cachedResult" in n) n.cachedResult = circ;
    if ("cachedValue" in n) n.cachedValue = circ;
    if ("cachedList" in n) n.cachedList = circ;
    if ("cachedChart" in n) n.cachedChart = circ;
    if ("cachedPayload" in n) n.cachedPayload = null;
    const seeded = Object.assign(Promise.resolve(outputs), { cancel() {} });
    try { engine.cache.add(id, seeded); } catch { engine.cache.patch(id, seeded); }
  }
}

export async function fetchAll(
  editor: Editor,
  engine: Engine,
  onNode?: (id: string, outputs: NodeOutputs) => void,
  opts: { stopOnCancel?: boolean } = {},
): Promise<PassValues | null> {
  const out: PassValues = new Map();
  for (const node of editor.getNodes()) {
    if (!editor.getNode(node.id)) continue;
    try {
      const outputs = (await engine.fetch(node.id)) as NodeOutputs;
      out.set(node.id, outputs);
      onNode?.(node.id, outputs);
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      if (opts.stopOnCancel) return null;
      out.set(node.id, null);
    }
  }
  return out;
}

export async function computeAll(editor: Editor, engine: Engine, changedId?: string): Promise<PassValues> {
  clearCollectMemo();
  resolveTrigModes(editor);
  invalidate(editor, engine, changedId);
  seedLoopErrors(editor, engine, loopMembers(editor));
  return (await fetchAll(editor, engine))!;
}
