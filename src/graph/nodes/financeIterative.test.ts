import { describe, it, expect } from "vitest";
import { NpvNode, IrrNode, MirrNode } from "./finance";
import { parseDateToSerial } from "./date";

// IRR/XIRR/MIRR are the finance-iterative family (own root-finder, no Formula.js). The
// defining invariant needs no oracle: IRR is the rate that zeroes NPV, XIRR the rate that
// zeroes XNPV. A solver that returns a rate NOT satisfying its own equation is broken.

const flows = [-1000, 300, 400, 500, 200];

describe("IRR zeroes NPV (its defining equation)", () => {
  it("NPV at the IRR is ~0", () => {
    const irr = new IrrNode().data({ list: [flows] }).result as number;
    expect(typeof irr).toBe("number");
    const npvAtIrr = new NpvNode().data({ rate: [irr], list: [flows] }).result as number;
    expect(npvAtIrr).toBeCloseTo(0, 5);
  });
  it("a same-sign series has no IRR (#CONV!), not a fabricated number", () => {
    const r = new IrrNode().data({ list: [[100, 200, 300]] }).result;
    expect(r && typeof r === "object" && "code" in r ? (r as { code: string }).code : r).toBe("#CONV!");
  });
});

describe("XIRR zeroes XNPV (dated, actual/365 from the first date)", () => {
  const d = (s: string) => parseDateToSerial(s);
  const dates = [d("2020-01-01"), d("2020-06-01"), d("2021-01-01"), d("2021-06-01"), d("2022-01-01")];
  it("XNPV at the XIRR is ~0", () => {
    const xirr = new IrrNode({ mode: "dates" }).data({ list: [flows], dates: [dates] }).result as number;
    expect(typeof xirr).toBe("number");
    const xnpvAtXirr = new NpvNode({ mode: "dates" }).data({ rate: [xirr], list: [flows], dates: [dates] }).result as number;
    expect(xnpvAtXirr).toBeCloseTo(0, 4);
  });
});

describe("MIRR matches an independent build of Excel's documented formula", () => {
  it("MIRR = (FVpos@reinvest / −PVneg@finance)^(1/(n−1)) − 1", () => {
    const finrate = 0.10, reinrate = 0.12, n = flows.length;
    // Independent reimplementation of the documented formula (not the node's code path).
    let fvPos = 0, pvNeg = 0;
    flows.forEach((f, i) => {
      if (f > 0) fvPos += f * (1 + reinrate) ** (n - 1 - i);
      else if (f < 0) pvNeg += f / (1 + finrate) ** i;
    });
    const expected = (-fvPos / pvNeg) ** (1 / (n - 1)) - 1;
    const mirr = new MirrNode().data({ list: [flows], finrate: [finrate], reinrate: [reinrate] }).result as number;
    expect(mirr).toBeCloseTo(expected, 9);
  });
});
