import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";

// The complex (IM*) family is internal — tagged Cx values (tagSpecialScalars). These invariants hold
// by the algebra of complex numbers, so they need no oracle: inverses round-trip, Euler's
// identity holds, sin²+cos²=1. Two complex results are equal iff |a−b| = 0, so `same`
// asserts the magnitude of their difference is ~0.
const ev = (e: string) => compileEvaluator(e)!({}) as number;
const z = "COMPLEX(3, 4)", w = "COMPLEX(1, -2)";
const same = (a: string, b: string) => expect(ev(`IMABS(IMSUB(${a}, ${b}))`)).toBeCloseTo(0, 8);

describe("complex algebra invariants (IM* family)", () => {
  it("modulus and part extraction", () => {
    expect(ev(`IMABS(${z})`)).toBeCloseTo(5, 9);        // |3+4i| = 5
    expect(ev(`IMREAL(${z})`)).toBeCloseTo(3, 9);
    expect(ev(`IMAGINARY(${z})`)).toBeCloseTo(4, 9);
  });
  it("sum/difference are inverse; product/quotient are inverse", () => {
    same(`IMSUB(IMSUM(${z}, ${w}), ${w})`, z);
    same(`IMDIV(IMPRODUCT(${z}, ${w}), ${w})`, z);
  });
  it("power 2 equals self-product; sqrt squares back", () => {
    same(`IMPOWER(${z}, 2)`, `IMPRODUCT(${z}, ${z})`);
    same(`IMPOWER(IMSQRT(${z}), 2)`, z);
  });
  it("exp and ln are inverse; conjugate is an involution", () => {
    same(`IMEXP(IMLN(${z}))`, z);
    same(`IMCONJUGATE(IMCONJUGATE(${z}))`, z);
    // conjugate flips the imaginary sign
    same(`IMCONJUGATE(${z})`, "COMPLEX(3, -4)");
  });
  it("Euler: e^(iπ) = −1", () => {
    same("IMEXP(COMPLEX(0, PI()))", "COMPLEX(-1, 0)");
  });
  it("sin² + cos² = 1 over the complex plane", () => {
    same(`IMSUM(IMPRODUCT(IMSIN(${z}), IMSIN(${z})), IMPRODUCT(IMCOS(${z}), IMCOS(${z})))`, "COMPLEX(1, 0)");
  });
});
