// [[C120]] linearWork
// Every catalog card fed long lists and extreme scalars on every input: none may run unbounded. Slow, so opt-in:
// `SWEEP=1 npx vitest run tests/graph/cardSweep.test.ts`. A card that spins synchronously stalls the run itself rather
// than failing it; `SWEEP_FROM=<catalog key>` resumes past it once it's fixed.
import { describe, it, expect } from "vitest";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";

type Card = { inputs?: Record<string, unknown>; data: (i: Record<string, unknown[]>) => unknown };

/** The cards still running after `limitMs` with every input wired to one of `values`. */
async function slowCards(values: unknown[], limitMs: number): Promise<string[]> {
  const slow: string[] = [];
  let started = !process.env.SWEEP_FROM;
  for (const [key, entry] of FLAT_CATALOG) {
    started ||= key === process.env.SWEEP_FROM;
    if (!started) continue;
    for (const value of values) {
      let card: Card;
      try { card = entry.create() as unknown as Card; } catch { continue; }
      const inputs: Record<string, unknown[]> = {};
      for (const k of Object.keys(card.inputs ?? {})) inputs[k] = [value];
      const t = performance.now();
      try {
        await Promise.race([Promise.resolve(card.data(inputs)), new Promise((r) => setTimeout(r, limitMs))]);
      } catch { /* an error answer is an answer */ }
      if (performance.now() - t >= limitMs) slow.push(`${key} on ${Array.isArray(value) ? `a ${value.length}-item list` : String(value)}`);
    }
  }
  return slow;
}

describe.runIf(!!process.env.SWEEP)("every card on hostile inputs", () => {

  it("long lists of numbers and of text", async () => {
    const nums = Array.from({ length: 300 }, (_, i) => i * 1.7 - 40);
    const words = Array.from({ length: 300 }, (_, i) => `w${i} ab`);
    expect(await slowCards([nums, words], 2000)).toEqual([]);
  }, 3_600_000);

  it("extreme scalars", async () => {
    // ODE Integrate's 100,000 RK4 steps take a few seconds by design; the limit sits above it.
    expect(await slowCards([1e9, -1e9, NaN, Infinity, 1e300], 6000)).toEqual([]);
  }, 3_600_000);
});
