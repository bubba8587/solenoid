// [[C15]] matricesInFormulas, [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { setCells } from "../../src/graph/nodes/matrixOps";
import { coerceScriptResult } from "../../src/graph/nodes/scriptCoerce";

// A call takes about 125k arguments, so a kernel that spreads a list into one throws past that.
const N = 150_000;
const ev = (expr: string, env: Record<string, unknown>) => compileEvaluator(expr)!(env);
const list = Array.from({ length: N }, (_, i) => i);
const col = list.map((v) => [v]);

describe("kernels take a list longer than a call's argument limit", () => {
  it("MAP and BYCOL over a long column", () => {
    const mapped = ev("MAP(x, LAMBDA(v, v + 1))", { x: col }) as number[][];
    expect(mapped.length).toBe(N);
    expect(mapped[N - 1]).toEqual([N]);
    expect(ev("BYCOL(x, LAMBDA(c, COUNT(c)))", { x: col })).toEqual([N]);
  });

  it("HSTACK of two long lists", () => {
    const m = ev("HSTACK(x, x)", { x: list }) as number[][];
    expect(m[0].length).toBe(2 * N);
  });

  it("CONCATLISTS of two long lists", () => {
    expect((ev("CONCATLISTS(x, x)", { x: list }) as number[]).length).toBe(2 * N);
  });

  it("Set Cells writing a long block", () => {
    const out = setCells(col.map(() => [null]), [{ r: 1, c: 1, v: col }]) as number[][];
    expect(out[N - 1]).toEqual([N - 1]);
  });

  it("a script returning many rows", () => {
    const r = coerceScriptResult(col);
    expect((r.value as number[][]).length).toBe(N);
  });
});
