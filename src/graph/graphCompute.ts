// [[C23]] calcModes
import type { GraphEditor } from "./graphEditor";
import { engineOf, type DataflowEngine, type NodeOutputs } from "./dataflowEngine";
import { resolveTrigModes } from "./trigMode";
import { clearCollectMemo } from "./frameBackend";
import type { Schemes } from "./schemes";

type Editor = GraphEditor<Schemes>;
type Engine = DataflowEngine<Schemes>;

export type { NodeOutputs };
export type PassValues = Map<string, NodeOutputs | null>;

/** Every node on a cable cycle, from the editor's engine. */
export function loopMembers(editor: Editor): Set<string> {
  return engineOf(editor).loopMembers();
}

/** The node and everything its cables reach, through every cable. */
export function downstreamClosure(editor: Editor, startId: string): Set<string> {
  return engineOf(editor).downstreamClosure(startId);
}

/** The model pass: what `changedId` reaches cleared (everything without one), the loops seeded with `#CIRC!`, every
 *  node fetched ([[compute-pass]] § The model pass); the walk and the seeding are the engine's. */
export async function computeAll(editor: Editor, engine: Engine, changedId?: string): Promise<PassValues> {
  clearCollectMemo();
  resolveTrigModes(editor);
  return (await engine.computeAll(changedId))!;
}
