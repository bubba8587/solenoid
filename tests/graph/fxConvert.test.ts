// [[D47]] noMixCurrencies, [[D35]] errorInErrorOut
import { describe, it, expect, vi, afterEach } from "vitest";
import { FxNode } from "../../src/graph/nodes/connection";
import { wrapNodeData } from "../../src/graph/coerceInputs";
import { magnitudeOf, isUnitCell } from "../../src/graph/unitValue";
import { solError, isSolError } from "../../src/graph/errorValue";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** A spot card with its rate already in, wrapped as the engine wraps it. */
function fx(from: string, to: string, rate: number): FxNode {
  globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const n = new FxNode();
  n.stringLiterals.from = from;
  n.stringLiterals.to = to;
  n.data({});
  n.cached = { rate, serial: 46000 } as FxNode["cached"];
  wrapNodeData(n as never);
  return n;
}

describe("Currency reads the amount's currency", () => {
  it("chains: a USD→EUR answer feeds an EUR→GBP card", () => {
    const eur = fx("USD", "EUR", 0.9).data({ amount: [100] }).converted;
    expect(isUnitCell(eur)).toBe(true);
    const gbp = fx("EUR", "GBP", 0.8).data({ amount: [eur] }).converted;
    expect(magnitudeOf(gbp)).toBeCloseTo(72, 9);
  });
  it("refuses an amount in another currency than From", () => {
    const eur = fx("USD", "EUR", 0.9).data({ amount: [100] }).converted;
    const out = fx("USD", "GBP", 0.75).data({ amount: [eur] }).converted;
    expect(isSolError(out) && out.code).toBe("#UNIT!");
  });
  it("passes an error amount on", () => {
    const err = solError("#DIV/0!", "x");
    expect(fx("USD", "EUR", 0.5).data({ amount: [err] }).converted).toEqual(err);
  });
});
