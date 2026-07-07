// The graph-aware half of the Tornado node (see nodes/tornado.ts for why it's a
// separate module — walking upstream connections and driving processGraph needs
// the live editor, which node classes stay decoupled from).
import { getEditor, processGraph, beginGraphRebuild, endGraphRebuild } from "./process";
import { calcModeStore } from "./calcModeStore";
import { NumberInputNode, SliderInputNode } from "./nodes/input";
import type { TornadoNode, TornadoResult } from "./nodes/tornado";

type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;
type Leaf = { node: NumberInputNode | SliderInputNode; label: string };

/** Upstream leaf source nodes (no inputs of their own) feeding `startId`, walked
 *  backward over connections — only Number/Slider inputs are perturbable; a
 *  Constant is fixed and any other producer isn't a "declared input" to sweep. */
export function findUpstreamLeaves(editor: AnyEditor, startId: string): Leaf[] {
  const incoming = new Map<string, string[]>();
  for (const c of editor.getConnections()) {
    (incoming.get(c.target) ?? incoming.set(c.target, []).get(c.target)!).push(c.source);
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  const leaves: Leaf[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    for (const s of incoming.get(id) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      const node = editor.getNode(s);
      if (!node) continue;
      // A Number/Slider IS the perturbable input to sweep — even though a Slider
      // carries its own (usually unwired) min/max/step config sockets. Stop the
      // walk here (don't chase whatever feeds those bounds — that would change the
      // slider's RANGE, not its value). Any other producer isn't a "declared
      // input", so keep walking upstream through it.
      if (node instanceof NumberInputNode || node instanceof SliderInputNode) {
        const label = (node.label ?? "").trim() || (node instanceof SliderInputNode ? "Slider" : "Number");
        leaves.push({ node, label });
      } else {
        queue.push(s);
      }
    }
  }
  return leaves;
}

/** Run the one-at-a-time sensitivity sweep: perturb each upstream leaf to its
 *  low/high bound, re-read `tornado`'s own value after each targeted recompute,
 *  then restore the original. Ranked by swing magnitude, biggest first. */
export async function runTornado(tornado: TornadoNode): Promise<TornadoResult[]> {
  const editor = getEditor();
  if (!editor) return [];
  const leaves = findUpstreamLeaves(editor, tornado.id);
  const results: TornadoResult[] = [];

  // Drive the sweep the way modelFuzz does. beginGraphRebuild exempts the manual-mode
  // short-circuit in processGraph (else EVERY perturbation recompute no-ops → base ==
  // high == low → all-zero swings, silently) AND suppresses Expect/Alert edge-detect
  // so synthetic extremes can't raise real HUD alerts. beginForceExact keeps a sketch-
  // sampled pass from returning APPROXIMATE sensitivities. Every value restore is in a
  // `finally` so a throw mid-sweep can't leave the user's real leaf pinned at an extreme.
  beginGraphRebuild();
  calcModeStore.beginForceExact();
  try {
    await processGraph(tornado.id);
    const base = typeof tornado.cachedResult === "number" ? tornado.cachedResult : NaN;
    if (!Number.isFinite(base)) return results;

    for (const { node, label } of leaves) {
      const original = node.value;
      if (typeof original !== "number" || !Number.isFinite(original)) continue;

      let lo: number, hi: number;
      if (node instanceof SliderInputNode) {
        // effectiveMin/Max resolve wired bounds too (data() ran in the base pass);
        // fall back to the literals, then the current value if unset.
        lo = node.effectiveMin ?? node.literals.min ?? original;
        hi = node.effectiveMax ?? node.literals.max ?? original;
      } else {
        const delta = original !== 0 ? Math.abs(original) * 0.1 : 1;
        lo = original - delta;
        hi = original + delta;
      }
      if (lo === hi) continue;

      try {
        node.value = hi;
        await processGraph(node.id);
        const highResult = typeof tornado.cachedResult === "number" ? tornado.cachedResult : NaN;

        node.value = lo;
        await processGraph(node.id);
        const lowResult = typeof tornado.cachedResult === "number" ? tornado.cachedResult : NaN;

        if (Number.isFinite(highResult) && Number.isFinite(lowResult)) {
          results.push({ nodeId: node.id, label, base, low: lowResult, high: highResult });
        }
      } finally {
        node.value = original;
        await processGraph(node.id);
      }
    }
  } finally {
    calcModeStore.endForceExact();
    endGraphRebuild();
  }

  results.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return results;
}
