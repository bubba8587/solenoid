import { describe, it, expect } from "vitest";
import { SeriesNode, RandArrayNode, AggregateNode, NestJoinNode, CorrelNode, ModeNode, RankPercentileNode, NpvNode } from "./rete-nodes";
import { isSolError, solError } from "./errorValue";
import type { FrameValue } from "./frame";

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

  it("a normal SEQUENCE still produces the list", () => {
    const out = new SeriesNode({ op: "sequence" }).data({ count: [4], start: [1], step: [2] });
    expect(out.list).toEqual([1, 3, 5, 7]);
  });
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
    const e = new NpvNode().data({ rate: [0], list: [[100, err]] });
    if (!isSolError(e.result)) throw new Error("expected SolError");
    expect(e.result.code).toBe("#DIV/0!");
    const r = new NpvNode().data({ rate: [0], list: [[100, null, 100]] });
    expect(r.result).toBe(200); // null period → 0; 100 + 0 + 100
  });
});
