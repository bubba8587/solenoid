import { describe, it, expect } from "vitest";
import { decisionMatrix, decisionCriteria, decisionSensitivity } from "./frameVerbs";
import { DecisionMatrixNode } from "./rete-nodes";
import { isSolError, solError } from "./errorValue";
import { isFrameValue, isCubeValue, type FrameValue, type FrameColumn } from "./frame";

// rows are options, "name" labels them, the rest are criteria.
const f: FrameValue = {
  __frame: true,
  columns: [
    { name: "name", type: "string", values: ["A", "B", "C"] },
    { name: "quality", type: "number", values: [8, 6, 10] },
    { name: "cost", type: "number", values: [3, 1, 9] },
  ],
};

const col = (out: FrameValue, name: string): FrameColumn =>
  out.columns.find((c) => c.name === name)!;

describe("decisionMatrix", () => {
  it("outputs Option · Score · Rank, best first", () => {
    const out = decisionMatrix(f, null, "none") as FrameValue;
    expect(out.columns.map((c) => c.name)).toEqual(["name", "Score", "Rank"]);
    // equal weights → Σscore/Σ|w| = (q+c)/2 per row: A=5.5, B=3.5, C=9.5 → C,A,B
    expect(col(out, "name").values).toEqual(["C", "A", "B"]);
    expect(col(out, "Score").values).toEqual([9.5, 5.5, 3.5]);
    expect(col(out, "Rank").values).toEqual([1, 2, 3]);
  });

  it("weighted average uses Σ|weight| as the denominator", () => {
    // weights [3, 0] → only quality counts: (q*3)/3 = q → C(10),A(8),B(6)
    const out = decisionMatrix(f, [3, 0], "none") as FrameValue;
    expect(col(out, "name").values).toEqual(["C", "A", "B"]);
    expect(col(out, "Score").values).toEqual([10, 8, 6]);
  });

  it("a negative weight penalises a lower-is-better criterion", () => {
    // weights [1, -1]: score = (q - cost)/2 → A=(8-3)/2=2.5, B=(6-1)/2=2.5, C=(10-9)/2=0.5
    const out = decisionMatrix(f, [1, -1], "none") as FrameValue;
    // A and B tie at 2.5 (rank 1, shared), C at 0.5 (rank 3)
    expect(col(out, "Score").values).toEqual([2.5, 2.5, 0.5]);
    const ranks = new Map(col(out, "name").values.map((n, i) => [n, col(out, "Rank").values[i]]));
    expect(ranks.get("A")).toBe(1);
    expect(ranks.get("B")).toBe(1);
    expect(ranks.get("C")).toBe(3);
  });

  it("missing weights default to 1", () => {
    // only one weight supplied → quality weight 5, cost weight 1
    const out = decisionMatrix(f, [5], "none") as FrameValue;
    // score = (q*5 + cost*1)/6 ; A=(40+3)/6, B=(30+1)/6, C=(50+9)/6 → C best
    expect(col(out, "name").values[0]).toBe("C");
  });

  it("normalize 'rank' makes incompatible scales comparable", () => {
    // quality on a /10-ish scale, cost in raw dollars
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B", "C"] },
        { name: "quality", type: "number", values: [8, 6, 10] },
        { name: "price", type: "number", values: [100, 50, 900] },
      ],
    };
    // rank within column (best/highest → highest number): quality A=2,B=1,C=3; price A=2,B=1,C=3
    // weights [1, -1] (price lower is better): score=(qRank - priceRank)/2 → A=0,B=0,C=0 all tie
    const out = decisionMatrix(g, [1, -1], "rank") as FrameValue;
    expect(col(out, "Score").values).toEqual([0, 0, 0]);
  });

  it("normalize '÷max' scales each criterion by its largest magnitude", () => {
    const out = decisionMatrix(f, [1, 0], "max") as FrameValue;
    // quality / max(10) → A .8, B .6, C 1.0 ; cost weight 0 → score = qNorm
    const scores = new Map(col(out, "name").values.map((n, i) => [n, col(out, "Score").values[i]]));
    expect(scores.get("C")).toBe(1);
    expect(scores.get("A")).toBe(0.8);
    expect(scores.get("B")).toBe(0.6);
  });

  it("synthesizes Option labels when there is no text column", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "a", type: "number", values: [1, 5] },
        { name: "b", type: "number", values: [2, 1] },
      ],
    };
    const out = decisionMatrix(g, null, "none") as FrameValue;
    expect(out.columns[0].name).toBe("Option");
    expect(out.columns[0].values).toContain("Option 1");
    expect(out.columns[0].values).toContain("Option 2");
  });

  it("treats missing / non-numeric cells as 0 and coerces logicals", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "flag", type: "logical", values: [true, false] },
        { name: "x", type: "number", values: [null, 4] },
      ],
    };
    const out = decisionMatrix(g, null, "none") as FrameValue;
    // A: (1 + 0)/2 = 0.5 ; B: (0 + 4)/2 = 2 → B first
    expect(col(out, "name").values).toEqual(["B", "A"]);
    expect(col(out, "Score").values).toEqual([2, 0.5]);
  });

  it("breakdown shows each criterion's effective value between label and Score", () => {
    const out = decisionMatrix(f, null, "none", true) as FrameValue;
    expect(out.columns.map((c) => c.name)).toEqual(["name", "quality", "cost", "Score", "Rank"]);
    // best-first order is C, A, B; criterion values follow that row order
    expect(col(out, "name").values).toEqual(["C", "A", "B"]);
    expect(col(out, "quality").values).toEqual([10, 8, 6]);
    expect(col(out, "cost").values).toEqual([9, 3, 1]);
  });

  it("breakdown under 'rank' shows the normalized within-column rank in [0,1]", () => {
    const out = decisionMatrix(f, null, "rank", true) as FrameValue;
    // quality 8,6,10 → fraction-beaten in [0,1]: B(6)=0, A(8)=0.5, C(10)=1
    const q = new Map(col(out, "name").values.map((n, i) => [n, col(out, "quality").values[i]]));
    expect(q.get("C")).toBe(1);
    expect(q.get("A")).toBe(0.5);
    expect(q.get("B")).toBe(0);
  });

  it("breakdown de-dupes a criterion named like a result column", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "Score", type: "number", values: [1, 2] },
      ],
    };
    const out = decisionMatrix(g, null, "none", true) as FrameValue;
    // the criterion "Score" and the result "Score" can't both be "Score"
    const names = out.columns.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("per-column override ranks only the chosen column (DMBV Rank Raws)", () => {
    // quality already /10, price in dollars. Rank ONLY price; leave quality raw.
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B", "C"] },
        { name: "quality", type: "number", values: [8, 6, 10] },
        { name: "price", type: "number", values: [100, 50, 900] },
      ],
    };
    // default mode "none"; override price → rank → [0,1]: 50→0, 100→0.5, 900→1
    const out = decisionMatrix(g, [1, -1], "none", true, { price: "rank" }) as FrameValue;
    // quality stays raw in the breakdown; price shows its normalized rank, not dollars
    const byName = (c: string) => new Map(col(out, "name").values.map((n, i) => [n, col(out, c).values[i]]));
    const q = byName("quality"), p = byName("price");
    expect(q.get("A")).toBe(8);    // raw, untouched
    expect(q.get("C")).toBe(10);
    expect(p.get("B")).toBe(0);    // cheapest → 0
    expect(p.get("A")).toBe(0.5);
    expect(p.get("C")).toBe(1);    // priciest → 1 (penalised by the -1 weight)
  });

  it("override falls back to the default mode for unlisted columns", () => {
    // default rank, but force quality back to raw
    const out = decisionMatrix(f, null, "rank", true, { quality: "none" }) as FrameValue;
    const q = new Map(col(out, "name").values.map((n, i) => [n, col(out, "quality").values[i]]));
    expect(q.get("C")).toBe(10); // raw, not its normalized rank (1)
    const c = new Map(col(out, "name").values.map((n, i) => [n, col(out, "cost").values[i]]));
    expect(c.get("C")).toBe(1);  // cost still ranked (9 is the max → 1)
  });

  it("does not treat a date column as a criterion", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "released", type: "date", values: [44000, 45000] },
        { name: "rating", type: "number", values: [3, 9] },
      ],
    };
    expect(decisionCriteria(g)).toEqual(["rating"]);
    const out = decisionMatrix(g, null, "none") as FrameValue;
    // only `rating` scores → B(9) beats A(3); the date serial is ignored
    expect(col(out, "name").values).toEqual(["B", "A"]);
    expect(col(out, "Score").values).toEqual([9, 3]);
  });

  it("propagates a per-cell error in a criterion (error-in → error-out)", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "x", type: "number", values: [5, solError("#DIV/0!", "boom")] },
      ],
    };
    let err: unknown;
    try { decisionMatrix(g, null, "none"); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#DIV/0!");
  });

  it("a null criterion cell stays a blank (0), not an error", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "x", type: "number", values: [4, null] },
      ],
    };
    const out = decisionMatrix(g, null, "none") as FrameValue;
    // B's null → 0, A's 4 → A wins; no error thrown
    expect(col(out, "name").values).toEqual(["A", "B"]);
    expect(col(out, "Score").values).toEqual([4, 0]);
  });

  it("#VALUE!s when there are no numeric criteria columns", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [{ name: "name", type: "string", values: ["A", "B"] }],
    };
    let err: unknown;
    try { decisionMatrix(g, null, "none"); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#VALUE!");
  });
});

describe("DecisionMatrixNode (inline named weights)", () => {
  it("scores from the per-criterion weightMap, defaulting missing to 1", () => {
    const node = new DecisionMatrixNode({ weightMap: { quality: 3, cost: -1 } });
    const out = node.data({ frame: [f] }).frame as FrameValue;
    // detected criteria exposed for the component to render labeled boxes
    expect(node.criteria).toEqual(["quality", "cost"]);
    // weights {quality:3, cost:-1}, Σ|w|=4 → A=(8*3-3*1)/4=5.25, B=(6*3-1)/4=4.25, C=(10*3-9)/4=5.25
    const scores = new Map(col(out, "name").values.map((n, i) => [n, col(out, "Score").values[i]]));
    expect(scores.get("A")).toBe(5.25);
    expect(scores.get("C")).toBe(5.25);
    expect(scores.get("B")).toBe(4.25);
  });

  it("a wired weights list overrides the inline map positionally", () => {
    const node = new DecisionMatrixNode({ weightMap: { quality: 99, cost: 99 } });
    // wired [1, 0] → only quality counts despite the map
    const out = node.data({ frame: [f], weights: [[1, 0]] }).frame as FrameValue;
    expect(col(out, "name").values).toEqual(["C", "A", "B"]);
    expect(col(out, "Score").values).toEqual([10, 8, 6]);
  });

  it("clears detected criteria when no frame is wired", () => {
    const node = new DecisionMatrixNode();
    const out = node.data({}).frame;
    expect(out).toBeNull();
    expect(node.criteria).toEqual([]);
  });

  it("applies the per-column normMap override on top of the default mode", () => {
    const node = new DecisionMatrixNode({ detail: "breakdown", normMap: { cost: "rank" } });
    const out = node.data({ frame: [f] }).frame as FrameValue;
    // quality untouched (default none), cost ranked → [0,1]: 1→0, 3→0.5, 9→1
    const q = new Map(col(out, "name").values.map((n, i) => [n, col(out, "quality").values[i]]));
    const c = new Map(col(out, "name").values.map((n, i) => [n, col(out, "cost").values[i]]));
    expect(q.get("C")).toBe(10);
    expect(c.get("C")).toBe(1);
    expect(c.get("B")).toBe(0);
  });
});

describe("decisionSensitivity (weight scenarios → cube)", () => {
  // scenarios: each ROW is a scenario; a column named after a criterion is its weight.
  const scenarios: FrameValue = {
    __frame: true,
    columns: [
      { name: "Scenario", type: "string", values: ["Quality-first", "Cost-first"] },
      { name: "quality", type: "number", values: [3, 1] },
      { name: "cost", type: "number", values: [1, 3] },
    ],
  };

  it("emits one cube row per scenario: Scenario · Winner · Margin · Ranking", () => {
    const cube = decisionSensitivity(f, scenarios, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    expect(cube.columns.map((c) => c.name)).toEqual(["Scenario", "Winner", "Margin", "Ranking"]);
    expect(cube.columns[0].cells).toEqual(["Quality-first", "Cost-first"]);
    // Quality-first weights {quality:3,cost:1}: C(10*3+9*1)/4=9.75 wins.
    // Cost-first weights {quality:1,cost:3}: scores (q+3*cost)/4 → A=(8+9)/4=4.25,
    //   B=(6+3)/4=2.25, C=(10+27)/4=9.25 → C still wins here too.
    expect(cube.columns[1].cells).toEqual(["C", "C"]);
  });

  it("nests the full ranking frame in the Ranking cell (drill-in)", () => {
    const cube = decisionSensitivity(f, scenarios, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    const ranking0 = cube.columns[3].cells[0];
    if (!isFrameValue(ranking0)) throw new Error("Ranking cell should hold a frame");
    expect(ranking0.columns.map((c) => c.name)).toEqual(["name", "Score", "Rank"]);
    expect(ranking0.columns[0].values[0]).toBe("C"); // best-first
  });

  it("a missing weight column defaults that criterion to 1", () => {
    // scenario only weights quality; cost falls back to 1
    const scen: FrameValue = {
      __frame: true,
      columns: [
        { name: "Scenario", type: "string", values: ["only quality"] },
        { name: "quality", type: "number", values: [3] },
      ],
    };
    const cube = decisionSensitivity(f, scen, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    const ranking = cube.columns[3].cells[0] as FrameValue;
    // weights {quality:3, cost:1} → C=(30+9)/4=9.75, A=(24+3)/4=6.75, B=(18+1)/4=4.75
    const scoreCol = ranking.columns.find((c) => c.name === "Score")!;
    expect(scoreCol.values[0]).toBe(9.75);
  });

  it("Margin is the top score minus the runner-up", () => {
    const cube = decisionSensitivity(f, scenarios, "none") as ReturnType<typeof decisionSensitivity>;
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    // Quality-first: C=9.75, then A=(8*3+3)/4=6.75 → margin 3.0
    expect(cube.columns[2].cells[0]).toBe(3);
  });
});
