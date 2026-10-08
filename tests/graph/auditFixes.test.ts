// [[C17]], [[B16]] oneFormulaSurface
import { describe, it, expect, vi } from "vitest";
import { SeriesNode, RandArrayNode, AggregateNode, NestJoinNode, CorrelNode, ModeNode, RankPercentileNode, NPVNode } from "../../src/graph/rete-nodes";
import { extractInit } from "../../src/graph/copyPaste";
import { isSolError, solError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { TableUnitNode, TableOuterNode } from "../../src/graph/nodes/matrix";
import { PadNode } from "../../src/graph/nodes/list";

// Regressions from the data-pathway audit (empty / null / error / large-list).

describe("generator element caps (#5)", () => {
  it("SEQUENCE over the cap returns #OVERFLOW! instead of a giant array", () => {
    const out = new SeriesNode({ op: "sequence" }).data({ count: [5_000_000] });
    if (!isSolError(out.list)) throw new Error("expected SolError");
    expect(out.list.code).toBe("#OVERFLOW!");
  });

  it("RANDARRAY over the cap returns #OVERFLOW!", () => {
    const out = new RandArrayNode().data({ count: [5_000_000] });
    if (!isSolError(out.list)) throw new Error("expected SolError");
    expect(out.list.code).toBe("#OVERFLOW!");
  });

  it("RANDARRAY Integer flag draws whole numbers (Excel's 5th arg; a card checkbox)", () => {
    const cont = new RandArrayNode().data({ count: [50], min: [0], max: [100] }).list as number[];
    expect(cont.every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(cont.some((v) => !Number.isInteger(v))).toBe(true); // fractional by default
    const ints = new RandArrayNode({ integer: true }).data({ count: [50], min: [0], max: [100] }).list as number[];
    expect(ints.every((v) => Number.isInteger(v) && v >= 0 && v <= 100)).toBe(true);
    // integer:false (the default) stays fractional, and the flag round-trips via extractInit.
    const off = new RandArrayNode({ integer: false }).data({ count: [30], min: [0], max: [1] }).list as number[];
    expect(off.some((v) => v > 0 && v < 1)).toBe(true);
    expect(extractInit(new RandArrayNode({ integer: true }) as never).integer).toBe(true);
  });

  it("RANDARRAY whole numbers are uniform: each endpoint as likely as any inside value, card and formula alike", () => {
    const N = 400;
    const tally = (draw: () => number[]) => {
      let i = 0;
      const spy = vi.spyOn(Math, "random").mockImplementation(() => (i++ % N) / N);
      try {
        const counts = new Map<number, number>();
        for (const v of draw()) counts.set(v, (counts.get(v) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => a[0] - b[0]);
      } finally { spy.mockRestore(); }
    };
    const even = [[1, 100], [2, 100], [3, 100], [4, 100]];
    expect(tally(() => new RandArrayNode({ integer: true }).data({ count: [N], min: [1], max: [4] }).list as number[])).toEqual(even);
    expect(tally(() => compileEvaluator("RANDARRAY(n, 1, 1, 4, TRUE)")!({ n: N }) as number[])).toEqual(even);
  });

  it("the 2-D builders cap their cell count on both surfaces instead of exhausting memory", () => {
    const code = (v: unknown) => (isSolError(v) ? v.code : "no error");
    for (const f of ["EXPAND(x, 100000, 100000)", "MUNIT(100000)", "DIAGONAL(SEQUENCE(2000))", "OUTER(SEQUENCE(2000), SEQUENCE(2000))"]) {
      expect(code(compileEvaluator(f)!({ x: [1] })), f).toBe("#OVERFLOW!");
    }
    expect(code(new TableUnitNode().data({ n: [100_000] }).result)).toBe("#OVERFLOW!");
    const long = Array.from({ length: 2000 }, (_, i) => i);
    expect(code(new TableOuterNode().data({ a: [long], b: [long] }).result)).toBe("#OVERFLOW!");
  });

  it("Linspace and Pad cap their length on the card as the formulas do", () => {
    const code = (v: unknown) => (isSolError(v) ? v.code : "no error");
    expect(code(new SeriesNode({ op: "linspace" }).data({ count: [5_000_000] }).list)).toBe("#OVERFLOW!");
    expect(code(new PadNode().data({ list: [[1]], n: [5_000_000] }).result)).toBe("#OVERFLOW!");
    expect(code(compileEvaluator("PADRIGHT(x, 5000000)")!({ x: [1] }))).toBe("#OVERFLOW!");
  });

  // A normal SEQUENCE's values are pinned (node ≡ formula) in formulaMatrix.test.ts.
});

describe("Aggregate min/max over a large list (#5 — no Math.min spread RangeError)", () => {
  it("does not throw and returns the right extremes", () => {
    const big = Array.from({ length: 200_000 }, (_, i) => i);
    expect(new AggregateNode({ op: "min" }).data({ list: [big] }).result).toBe(0);
    expect(new AggregateNode({ op: "max" }).data({ list: [big] }).result).toBe(199_999);
  });
});

describe("Nest Join parent type guard (#8)", () => {
  it("a non-frame/cube parent returns #TYPE!, not a silent blank", () => {
    const child: FrameValue = { __frame: true, columns: [{ name: "k", type: "number", values: [1] }] };
    const n = new NestJoinNode();
    n.stringLiterals.key = "k";
    const out = n.data({ parent: [[1, 2, 3]], child: [child], key: ["k"], name: ["x"] });
    if (!isSolError(out.cube)) throw new Error("expected SolError");
    expect(out.cube.code).toBe("#TYPE!");
  });

  it("an UNWIRED parent stays blank (incomplete input)", () => {
    const child: FrameValue = { __frame: true, columns: [{ name: "k", type: "number", values: [1] }] };
    const n = new NestJoinNode();
    n.stringLiterals.key = "k";
    const out = n.data({ child: [child], key: ["k"], name: ["x"] });
    expect(out.cube).toBeNull();
  });
});

describe("list reducers honor null / error (#3)", () => {
  const err = solError("#DIV/0!", "boom");

  it("CORREL propagates an embedded error and drops null pairs", () => {
    // error in either list → propagate
    const e = new CorrelNode().data({ x: [[1, err, 3]], y: [[1, 2, 3]] });
    if (!isSolError(e.result)) throw new Error("expected SolError");
    expect(e.result.code).toBe("#DIV/0!");
    // the (null, 100) pair is dropped → the remaining points are perfectly correlated
    const r = new CorrelNode().data({ x: [[1, 2, 3, null]], y: [[2, 4, 6, 100]] });
    expect(r.result).toBeCloseTo(1, 10);
  });

  it("MODE skips null instead of counting it as the most frequent value", () => {
    const out = new ModeNode().data({ list: [[1, 1, 2, null, null, null]] });
    expect(out.result).toBe(1); // not null, even though null appears most
  });

  it("QUARTILE skips null before ranking", () => {
    const out = new RankPercentileNode({ op: "quartile-inc" }).data({ list: [[1, 2, 3, 4, null]], q: [2] });
    expect(out.result).toBe(2.5); // median of [1,2,3,4]
  });

  it("NPV propagates an embedded error; a null period counts as 0", () => {
    const e = new NPVNode().data({ rate: [0], list: [[100, err]] });
    if (!isSolError(e.result)) throw new Error("expected SolError");
    expect(e.result.code).toBe("#DIV/0!");
    const r = new NPVNode().data({ rate: [0], list: [[100, null, 100]] });
    expect(r.result).toBe(200); // null period → 0; 100 + 0 + 100
  });
});
