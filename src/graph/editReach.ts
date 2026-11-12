// [[A1]] visualGraphCalculator, [[compute-pass#What triggers a pass]]
// What a bulk edit on the main canvas changes the answer of, so the one pass after it computes that and keeps every
// other card's cache: each card whose inputs lost or gained a cable, and each card new to the canvas, cleared with
// everything downstream of it.
import type { GraphEditor } from "./graphEditor";
import type { Schemes } from "./schemes";

/** Every cable on the canvas and the card it feeds, taken before the edit. */
export function cableTargets(editor: GraphEditor<Schemes>): Map<string, string> {
  return new Map(editor.getConnections().map((c) => [c.id, c.target]));
}

/** The cards to render after the edit, their caches already cleared: the reach of every card whose input cables
 *  changed since `before` and of every card in `added`. */
export function changedReach(editor: GraphEditor<Schemes>, before: ReadonlyMap<string, string>, added: Iterable<string> = []): Set<string> {
  const engine = editor.engine;
  const reach = new Set<string>();
  if (!engine) return reach;
  const after = cableTargets(editor);
  const touched = new Set<string>(added);
  for (const [id, target] of before) if (!after.has(id)) touched.add(target);
  for (const [id, target] of after) if (!before.has(id)) touched.add(target);
  for (const id of touched) {
    if (!editor.getNode(id) || reach.has(id)) continue;
    engine.reset(id);
    for (const r of engine.downstreamClosure(id)) reach.add(r);
  }
  return reach;
}
