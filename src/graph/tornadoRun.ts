// The graph-aware half of the Tornado node: node classes stay decoupled from the live
// editor, which walking upstream connections and driving processGraph both need.
import { getEditor, processGraph, beginGraphRebuild, endGraphRebuild } from "./process";
import { beginCompute, endCompute } from "./computeOverlayStore";
import { calcModeStore } from "./calcModeStore";
import { NumberInputNode, SliderInputNode } from "./nodes/input";
import type { TornadoNode, TornadoResult } from "./nodes/tornado";

type AnyEditor = NonNullable<ReturnType<typeof getEditor>>;
type Leaf = { node: NumberInputNode | SliderInputNode; label: string };

/** Upstream sources feeding `startId`; only Number/Slider inputs count, since nothing
 *  else is a perturbable "declared input". */
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
      // Stop at a Slider rather than chasing what feeds its min/max/step sockets —
      // perturbing those would change the slider's RANGE, not its value.
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

/** One-at-a-time sweep: perturb each leaf to its low/high bound, re-read `tornado`
 *  after each recompute, restore the original; ranked by swing, biggest first. */
export async function runTornado(tornado: TornadoNode): Promise<TornadoResult[]> {
  const editor = getEditor();
  if (!editor) return [];
  const leaves = findUpstreamLeaves(editor, tornado.id);
  const results: TornadoResult[] = [];

  // An outer bracket over the whole sweep keeps the compute counter ≥1; the per-pass
  // brackets would drop it to 0 between perturbations and cancel the deferred reveal.
  beginCompute();
  // beginGraphRebuild exempts the manual-mode short-circuit (else every perturbation
  // no-ops → all-zero swings, silently) AND suppresses Expect/Alert edge-detect so
  // synthetic extremes can't raise real alerts; beginForceExact stops a sketch-sampled
  // pass returning APPROXIMATE sensitivities. Restores sit in `finally` so a throw
  // can't leave a real leaf pinned at an extreme.
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

        // KEEP the leaf even when an extreme diverged (non-finite) — mark it.
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

/** RAW swing is the ranking key, NOT swing normalized by perturbation width; diverged
 *  leaves have no finite swing, so they surface marked at the TOP. */
export function rankTornado(results: TornadoResult[]): TornadoResult[] {
  const diverged = results.filter((r) => r.diverged);
  const finite = results.filter((r) => !r.diverged)
    .sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return [...diverged, ...finite];
}
