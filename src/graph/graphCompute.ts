// [[C23]] calcModes
import type { GraphEditor } from "./graphEditor";
import { engineOf, type DataflowEngine, type NodeOutputs } from "./dataflowEngine";
import { solError } from "./errorValue";
import { resolveTrigModes } from "./trigMode";
import { clearCollectMemo } from "./frameBackend";
import type { Schemes } from "./schemes";

type Editor = GraphEditor<Schemes>;
type Engine = DataflowEngine<Schemes>;

export type { NodeOutputs };
export type PassValues = Map<string, NodeOutputs | null>;

export const CIRC_MESSAGE =
  "This node is part of a circular dependency: the calculation feeds back into itself";

/** Every node on a cable cycle, from the editor's engine. */
export function loopMembers(editor: Editor): Set<string> {
  return engineOf(editor).loopMembers();
}

/** The node and everything its cables reach, through every cable. */
export function downstreamClosure(editor: Editor, startId: string): Set<string> {
  return engineOf(editor).downstreamClosure(startId);
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
    engine.seed(id, outputs);
  }
}

export async function computeAll(editor: Editor, engine: Engine, changedId?: string): Promise<PassValues> {
  clearCollectMemo();
  resolveTrigModes(editor);
  engine.invalidate(changedId, false);
  seedLoopErrors(editor, engine, engine.loopMembers());
  return (await engine.fetchAll())!;
}
