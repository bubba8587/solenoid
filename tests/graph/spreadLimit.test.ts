// [[C15]] matricesInFormulas, [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { SetCellNode } from "../../src/graph/nodes/matrix";
import { coerceScriptResult } from "../../src/graph/nodes/scriptCoerce";
import { pivotFrame } from "./coreVerbs";

// A call takes about 125k arguments, so JavaScript that spreads a list into one throws past that. The kernels run in
// Rust now; what these hold is each path a long value crosses between JavaScript and the core: a formula's nested
// column and flat list, a wide row, a frame, a card's table input, a script's answer.
const N = 150_000;
const ev = (expr: string, env: Record<string, unknown>) => compileEvaluator(expr)!(env);
const list = Array.from({ length: N }, (_, i) => i);
const col = list.map((v) => [v]);

describe("kernels take a list longer than a call's argument limit", () => {
  it("a long column into a formula and back, and BYCOL over it", () => {
    const mapped = ev("x + 1", { x: col }) as number[][];
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
    const out = new SetCellNode().data({ matrix: [col.map(() => [null])], value0: [col], row0: [1], col0: [1] }).result as number[][];
    expect(out[N - 1]).toEqual([N - 1]);
  });

  it("a pivot with one group holding every row", () => {
    const f = { __frame: true as const, columns: [
      { name: "k", type: "string" as const, values: list.map(() => "a") },
      { name: "x", type: "number" as const, values: list },
    ] };
    const out = pivotFrame(f, { rowFields: ["k"], colFields: [], values: ["x"], funcs: ["sum"] } as never);
    expect(out.columns[out.columns.length - 1].values[0]).toBe((N * (N - 1)) / 2);
  });

  it("a script returning many rows", () => {
    const r = coerceScriptResult(col);
    expect((r as number[][]).length).toBe(N);
  });
});
