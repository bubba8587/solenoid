// [[C25]] firstClassUnits: the finance functions carry the currency their money arguments share.
import { describe, it, expect } from "vitest";
import { dimWithCode } from "./coreDims";
import { isSolError } from "../../src/graph/errorValue";

const CUR = { currency: 1 };
const code = (v: unknown) => (isSolError(v) ? v.code : v);

const dimOf = (src: string, env: Record<string, Record<string, number>>, codes: Record<string, string> = {}) => dimWithCode(src, env, codes);

describe("the formula's dimension pass", () => {
  it("money in is money out, in the money's currency", () => {
    expect(dimOf("PMT(r, n, p)", { p: CUR }, { p: "usd" })).toEqual({ dim: CUR, code: "usd" });
    expect(dimOf("NPV(r, xs)", { xs: CUR }, { xs: "eur" })).toEqual({ dim: CUR, code: "eur" });
    expect(dimOf("SLN(c, s, 5)", { c: CUR, s: CUR }, { c: "usd", s: "usd" })).toEqual({ dim: CUR, code: "usd" });
  });
  it("a rate or a count of periods from money is a plain number", () => {
    expect(dimOf("IRR(xs)", { xs: CUR }, { xs: "usd" })).toEqual({ dim: {} });
    expect(dimOf("NPER(r, pm, p)", { pm: CUR, p: CUR }, { pm: "usd", p: "usd" })).toEqual({ dim: {} });
  });
  it("a plain number where money goes reads in the money's currency", () => {
    expect(dimOf("PMT(r, n, p, 0)", { p: CUR }, { p: "usd" })).toEqual({ dim: CUR, code: "usd" });
  });
  it("two currencies, money that isn't a currency, or a unit on a rate or period count is #UNIT!", () => {
    expect(code(dimOf("PMT(r, n, p, f)", { p: CUR, f: CUR }, { p: "usd", f: "eur" }))).toBe("#UNIT!");
    expect(code(dimOf("PMT(r, n, p)", { p: { length: 1 } }))).toBe("#UNIT!");
    expect(code(dimOf("PMT(r, n, p)", { n: { time: 1 }, p: CUR }, { p: "usd" }))).toBe("#UNIT!");
  });
  it("all plain numbers stay plain", () => {
    expect(dimOf("PMT(r, n, p)", {})).toEqual({ dim: {} });
  });
});


