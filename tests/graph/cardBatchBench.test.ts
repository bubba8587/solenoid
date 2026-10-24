// [[C120]] linearWork, [[D99]] rustIsSpec
// Timing, not a check: cards mapping one core body over a 50,000-item list.
// `BENCH=1 npx vitest run tests/graph/cardBatchBench.test.ts` prints the table; a plain run skips it.
import { describe, it } from "vitest";
import { TextTransformNode } from "../../src/graph/nodes/text";
import { RoundNNode } from "../../src/graph/nodes/scalar";
import { IsEvenOddNode } from "../../src/graph/nodes/logic";

const N = Number(process.env.BENCH_ITEMS ?? 50_000);
const words = Array.from({ length: N }, (_, i) => `item ${i} straße`);
const nums = Array.from({ length: N }, (_, i) => i * 1.2345 - 7000);

function time(run: () => unknown, reps = 3): number {
  run();
  let best = Infinity;
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    run();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}

describe.skipIf(!process.env.BENCH)("cards over a list on the core", () => {

  it("prints the table", () => {
    const upper = new TextTransformNode({ op: "upper" });
    const round = new RoundNNode({ op: "round" });
    const even = new IsEvenOddNode({ op: "iseven" });
    const rows: [string, number][] = [
      ["Text Transform UPPER", time(() => upper.data({ text: [words] }))],
      ["ROUND(x, 2)", time(() => round.data({ value: [nums], digits: [2] }))],
      ["ISEVEN", time(() => even.data({ in: [nums] }))],
    ];
    console.log(`\n${N} items, best of 3\n` + rows.map(([k, ms]) => `${k.padEnd(24)} ${ms.toFixed(1)} ms`).join("\n"));
  }, 120_000);
});
