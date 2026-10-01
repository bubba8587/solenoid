// [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { MakeArrayNode } from "../../src/graph/nodes/tableLambda";

const ev = (expr: string) => compileEvaluator(expr)!({});

describe("a generator's cap and shape are the same on the card and in a formula", () => {
  it("MAKEARRAY takes the shared million-element cap and truncates its size, as Excel does", () => {
    const card = (r: number, c: number) => new MakeArrayNode().data({ rows: [r], cols: [c] }).result;
    expect(card(300, 300)).toEqual(ev("MAKEARRAY(300,300,LAMBDA(r,c,r*c))"));
    expect(card(2.5, 2.5)).toEqual(ev("MAKEARRAY(2.5,2.5,LAMBDA(r,c,r*c))"));
    expect((card(1001, 1000) as { code?: string }).code).toBe("#OVERFLOW!");
    expect((ev("MAKEARRAY(1001,1000,LAMBDA(r,c,r*c))") as { code?: string }).code).toBe("#OVERFLOW!");
  });
  it("a fractional count is capped after rounding, as the builder rounds it", () => {
    expect((ev("LINSPACE(0,1,1000000.4)") as unknown[]).length).toBe(1_000_000);
    expect((ev("LINSPACE(0,1,1000000.6)") as { code?: string }).code).toBe("#OVERFLOW!");
  });
});
