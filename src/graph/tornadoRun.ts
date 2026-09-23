// [[D46]] freezeVolatilePerCalc
// The graph-aware half of the Tornado node, so node classes stay decoupled from the live editor.
import { getEditor, processGraph, beginGraphRebuild, endGraphRebuild } from "./process";
import { beginCompute, endCompute } from "./computeOverlayStore";
import { calcModeStore } from "./calcModeStore";
import { NumberInputNode, SliderInputNode } from "./nodes/input";
import type { TornadoNode, TornadoResult } from "./nodes/tornado";

type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;
type Leaf = { node: NumberInputNode | SliderInputNode; label: string };

/** Only Number and Slider inputs count: nothing else is a perturbable declared input. */
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
      // Stop at a Slider: perturbing what feeds its min, max or step would change its range, not its value.
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

/** One at a time: each leaf to its low and high bound, re-reading `tornado` after each recompute, then restored. */
export async function runTornado(tornado: TornadoNode): Promise<TornadoResult[]> {
  const editor = getEditor();
  if (!editor) return [];
  const leaves = findUpstreamLeaves(editor, tornado.id);
  const results: TornadoResult[] = [];

  // An outer bracket keeps the compute counter up between perturbations, or the deferred reveal cancels.
  beginCompute();
  // The rebuild gate lets passes run in manual mode and keeps Expect and Alert quiet; force-exact stops sketch sampling.
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
      const basis: "slider" | "number" = node instanceof SliderInputNode ? "slider" : "number";
      if (node instanceof SliderInputNode) {
        // effectiveMin/Max resolve wired bounds too (data() ran in the base pass).
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

        // Keep a leaf even when an extreme diverged, and mark it.
        const diverged = !Number.isFinite(highResult) || !Number.isFinite(lowResult);
        results.push({
          nodeId: node.id, label, base,
          low: lowResult, high: highResult,
          inputLow: lo, inputHigh: hi, basis, diverged,
        });
      } finally {
        node.value = original;
        await processGraph(node.id);
      }
    }
  } finally {
    calcModeStore.endForceExact();
    endGraphRebuild();
    endCompute();
  }

  return rankTornado(results);
}

/** Ranked by raw swing, not swing per perturbation width; diverged leaves come first, marked. */
export function rankTornado(results: TornadoResult[]): TornadoResult[] {
  const diverged = results.filter((r) => r.diverged);
  const finite = results.filter((r) => !r.diverged)
    .sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return [...diverged, ...finite];
}
