// [[B17]]
import { describe, it, expect } from "vitest";
import { decisionMatrix, decisionCriteria, decisionSensitivity, flipPoints, decisionCube } from "../../src/graph/frameVerbs";
import { DecisionMatrixNode, DecisionSensitivityNode } from "../../src/graph/rete-nodes";
import { isSolError, solError } from "../../src/graph/errorValue";
import { isFrameValue, isCubeValue, relateFramesToCube, relateCubeToFrame, type FrameValue, type FrameColumn, type CubeValue } from "../../src/graph/frame";

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

  it("a negative weight penalizes a lower-is-better criterion", () => {
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

  it("ranks on the ROUNDED score, so options that display equal share a rank", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "x", type: "number", values: [1.00001, 1.00002] }, // both display 1
      ],
    };
    const out = decisionMatrix(g, null, "none") as FrameValue;
    expect(col(out, "Score").values).toEqual([1, 1]);
    expect(col(out, "Rank").values).toEqual([1, 1]);
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

  it("scores a cell with no number as the column's median and a logical as 1 or 0 ([[C123]] decisionBlanks)", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B", "C"] },
        { name: "flag", type: "logical", values: [true, false, null] },
        { name: "x", type: "number", values: [null, 4, 2] },
      ],
    };
    const out = decisionMatrix(g, null, "none") as FrameValue;
    // A: (1 + 3)/2 = 2 ; B: (0 + 4)/2 = 2 ; C: (0 + 2)/2 = 1
    expect(col(out, "name").values).toEqual(["A", "B", "C"]);
    expect(col(out, "Score").values).toEqual([2, 2, 1]);
  });

  it("an unpriced option is typical on price, not the cheapest", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["Unpriced", "Cheap", "Mid", "Dear"] },
        { name: "price", type: "number", values: [null, 10, 20, 30] },
      ],
    };
    const out = decisionMatrix(g, [-1], "max") as FrameValue;
    expect(col(out, "name").values[0]).toBe("Cheap");
    expect(col(out, "Score").values[col(out, "name").values.indexOf("Unpriced")]).toBe(col(out, "Score").values[col(out, "name").values.indexOf("Mid")]);
  });

  it("a criterion no option has a number for counts as 0", () => {
    const g: FrameValue = { __frame: true, columns: [
      { name: "name", type: "string", values: ["A", "B"] },
      { name: "x", type: "number", values: [null, "n/a"] },
      { name: "y", type: "number", values: [1, 2] },
    ] };
    expect(col(decisionMatrix(g, null, "none") as FrameValue, "Score").values).toEqual([1, 0.5]);
  });

  it("breakdown inserts each criterion's signed contribution, and they sum to the Score", () => {
    const out = decisionMatrix(f, null, "none", true) as FrameValue;
    expect(out.columns.map((c) => c.name)).toEqual(["name", "quality", "cost", "Score", "Rank"]);
    // best-first order is C, A, B; contribution = value × weight / Σ|w| (weights 1,1)
    expect(col(out, "name").values).toEqual(["C", "A", "B"]);
    expect(col(out, "quality").values).toEqual([5, 4, 3]);
    expect(col(out, "cost").values).toEqual([4.5, 1.5, 0.5]);
    const score = col(out, "Score").values as number[];
    (col(out, "quality").values as number[]).forEach((q, i) =>
      expect(q + (col(out, "cost").values as number[])[i]).toBeCloseTo(score[i], 4));
  });

  it("a negative-weight criterion's contribution reads as a penalty (negative)", () => {
    // weights [1, -1]: cost contributes −cost/2 — the breakdown must NOT show the
    // bare post-normalize value, which would read as a high score for the worst row
    const out = decisionMatrix(f, [1, -1], "none", true) as FrameValue;
    const c = new Map(col(out, "name").values.map((n, i) => [n, col(out, "cost").values[i]]));
    expect(c.get("C")).toBe(-4.5); // costliest → the largest penalty
    expect(c.get("B")).toBe(-0.5);
  });

  it("breakdown under 'rank' contributes the weighted within-column rank", () => {
    const out = decisionMatrix(f, null, "rank", true) as FrameValue;
    // quality 8,6,10 → fraction-beaten B=0, A=0.5, C=1, then × w(1) / Σ|w|(2)
    const q = new Map(col(out, "name").values.map((n, i) => [n, col(out, "quality").values[i]]));
    expect(q.get("C")).toBe(0.5);
    expect(q.get("A")).toBe(0.25);
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
    // default mode "none"; override price → rank → [0,1]: 50→0, 100→0.5, 900→1;
    // contributions then apply weight/Σ|w| = ±1/2
    const out = decisionMatrix(g, [1, -1], "none", true, { price: "rank" }) as FrameValue;
    // quality contributes raw/2; price contributes −rank/2, never dollars
    const byName = (c: string) => new Map(col(out, "name").values.map((n, i) => [n, col(out, c).values[i]]));
    const q = byName("quality"), p = byName("price");
    expect(q.get("A")).toBe(4);
    expect(q.get("C")).toBe(5);
    expect(p.get("B")).toBe(0);      // cheapest → no penalty
    expect(p.get("A")).toBe(-0.25);
    expect(p.get("C")).toBe(-0.5);   // priciest → the largest penalty
  });

  it("override falls back to the default mode for unlisted columns", () => {
    // default rank, but force quality back to raw (contributions halve: Σ|w| = 2)
    const out = decisionMatrix(f, null, "rank", true, { quality: "none" }) as FrameValue;
    const q = new Map(col(out, "name").values.map((n, i) => [n, col(out, "quality").values[i]]));
    expect(q.get("C")).toBe(5);   // raw 10 × 1/2, not its normalized rank
    const c = new Map(col(out, "name").values.map((n, i) => [n, col(out, "cost").values[i]]));
    expect(c.get("C")).toBe(0.5); // cost still ranked (9 is the max → 1), × 1/2
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

  it("a null criterion cell is a missing score (the median), not an error", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B"] },
        { name: "x", type: "number", values: [4, null] },
      ],
    };
    const out = decisionMatrix(g, null, "none") as FrameValue;
    // B's null takes the median of the known values, 4; no error thrown
    expect(col(out, "Score").values).toEqual([4, 4]);
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

// A DM weights frame: Criterion | Weight | (optional) Norm, keyed by criterion name.
const wframe = (rows: [string, number, string?][]): FrameValue => ({
  __frame: true,
  columns: [
    { name: "Criterion", type: "string", values: rows.map((r) => r[0]) },
    { name: "Weight", type: "number", values: rows.map((r) => r[1]) },
    { name: "Norm", type: "string", values: rows.map((r) => r[2] ?? "") },
  ],
});

describe("DecisionMatrixNode (criterion-keyed weights frame)", () => {
  it("scores from the weights frame, keyed by criterion name", () => {
    const node = new DecisionMatrixNode({ normalize: "none" });
    const w = wframe([["quality", 3], ["cost", -1]]);
    const out = node.data({ frame: [f], weights: [w] }).frame as FrameValue;
    // weights {quality:3, cost:-1}, Σ|w|=4 → A=(8*3-3*1)/4=5.25, B=(6*3-1)/4=4.25, C=(10*3-9)/4=5.25
    const scores = new Map(col(out, "name").values.map((n, i) => [n, col(out, "Score").values[i]]));
    expect(scores.get("A")).toBe(5.25);
    expect(scores.get("C")).toBe(5.25);
    expect(scores.get("B")).toBe(4.25);
  });

  it("a criterion omitted from the weights frame weighs 1", () => {
    const node = new DecisionMatrixNode({ normalize: "none" });
    // only quality is listed (weight 5); cost falls back to 1
    const out = node.data({ frame: [f], weights: [wframe([["quality", 5]])] }).frame as FrameValue;
    // score = (q*5 + cost*1)/6 → C=(50+9)/6 best
    expect(col(out, "name").values[0]).toBe("C");
  });

  it("no weights frame means equal weights", () => {
    const node = new DecisionMatrixNode({ normalize: "none" });
    const out = node.data({ frame: [f] }).frame as FrameValue;
    // equal weights → (q+c)/2: A=5.5, B=3.5, C=9.5 → C,A,B
    expect(col(out, "name").values).toEqual(["C", "A", "B"]);
    expect(col(out, "Score").values).toEqual([9.5, 5.5, 3.5]);
  });

  it("no Scores frame yields null", () => {
    expect(new DecisionMatrixNode().data({}).frame).toBeNull();
  });

  it("reads the per-criterion normalize from the Norm column", () => {
    const node = new DecisionMatrixNode({ normalize: "none", detail: "breakdown" });
    // cost normalized to rank via the Norm cell; quality left raw (blank → default "none")
    const out = node.data({ frame: [f], weights: [wframe([["quality", 1, ""], ["cost", 1, "Rank"]])] }).frame as FrameValue;
    // contributions at Σ|w|=2: quality raw/2, cost ranked ([0,1]: 1→0, 3→0.5, 9→1) /2
    const q = new Map(col(out, "name").values.map((n, i) => [n, col(out, "quality").values[i]]));
    const c = new Map(col(out, "name").values.map((n, i) => [n, col(out, "cost").values[i]]));
    expect(q.get("C")).toBe(5);
    expect(c.get("C")).toBe(0.5);
    expect(c.get("B")).toBe(0);
  });
});

describe("decisionSensitivity (weight scenarios → cube)", () => {
  // scenarios inverted: rows are criteria, each NUMBER column is one scenario's weights.
  const scenarios: FrameValue = {
    __frame: true,
    columns: [
      { name: "Criterion", type: "string", values: ["quality", "cost"] },
      { name: "Quality-first", type: "number", values: [3, 1] },
      { name: "Cost-first", type: "number", values: [1, 3] },
    ],
  };

  it("emits one cube row per scenario column: Scenario · Winner · Margin · Ranking", () => {
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

  it("a criterion with no row in a scenario defaults to 1", () => {
    // the scenario column only carries a quality weight (cost row absent → 1)
    const scen: FrameValue = {
      __frame: true,
      columns: [
        { name: "Criterion", type: "string", values: ["quality"] },
        { name: "only quality", type: "number", values: [3] },
      ],
    };
    const cube = decisionSensitivity(f, scen, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    const ranking = cube.columns[3].cells[0] as FrameValue;
    // weights {quality:3, cost:1} → C=(30+9)/4=9.75, A=(24+3)/4=6.75, B=(18+1)/4=4.75
    const scoreCol = ranking.columns.find((c) => c.name === "Score")!;
    expect(scoreCol.values[0]).toBe(9.75);
  });

  it("a shared Norm column normalizes per criterion across every scenario", () => {
    const g: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B", "C"] },
        { name: "quality", type: "number", values: [8, 6, 10] },
        { name: "price", type: "number", values: [100, 50, 900] },
      ],
    };
    // Norm ranks price only; the scenario weights price negatively (lower is better)
    const scen: FrameValue = {
      __frame: true,
      columns: [
        { name: "Criterion", type: "string", values: ["quality", "price"] },
        { name: "Norm", type: "string", values: ["Raw", "Rank"] },
        { name: "Balanced", type: "number", values: [1, -1] },
      ],
    };
    const cube = decisionSensitivity(g, scen, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    const ranking = cube.columns[3].cells[0] as FrameValue;
    // quality raw, price ranked → contributions (q − priceRank)/2; the winner is A (cheap-ish, good quality)
    const scoreCol = ranking.columns.find((c) => c.name === "Score")!;
    // priceRank: 50→0,100→0.5,900→1; scores (q − rank)/2 → A=(8−0.5)/2=3.75, B=(6−0)/2=3, C=(10−1)/2=4.5
    expect(ranking.columns[0].values[0]).toBe("C");
    expect(scoreCol.values[0]).toBe(4.5);
  });

  it("Margin is the top score minus the runner-up", () => {
    const cube = decisionSensitivity(f, scenarios, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    // Quality-first: C=9.75, then A=(8*3+3)/4=6.75 → margin 3.0
    expect(cube.columns[2].cells[0]).toBe(3);
  });

  it("a dead tie for first lists every tied option in Winner, Margin 0", () => {
    const tie: FrameValue = {
      __frame: true,
      columns: [
        { name: "name", type: "string", values: ["A", "B", "C"] },
        { name: "quality", type: "number", values: [7, 7, 2] },
      ],
    };
    const scen: FrameValue = {
      __frame: true,
      columns: [
        { name: "Criterion", type: "string", values: ["quality"] },
        { name: "only", type: "number", values: [1] },
      ],
    };
    const cube = decisionSensitivity(tie, scen, "none");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    expect(cube.columns[1].cells[0]).toBe("A = B");
    expect(cube.columns[2].cells[0]).toBe(0);
  });

  it("#VALUE!s when no Scenarios row is named after a criterion", () => {
    // every weight would default to 1 and all scenarios would come out identical —
    // the renamed-criteria trap, not a sensitivity run
    const scen: FrameValue = {
      __frame: true,
      columns: [
        { name: "Criterion", type: "string", values: ["qualty"] },
        { name: "typo", type: "number", values: [3] },
      ],
    };
    let err: unknown;
    try { decisionSensitivity(f, scen, "none"); } catch (e) { err = e; }
    if (!isSolError(err)) throw new Error("expected SolError");
    expect(err.code).toBe("#VALUE!");
  });
});

describe("deal-breakers ([[C124]] dealBreakers)", () => {
  const apartments: FrameValue = { __frame: true, columns: [
    { name: "Place", type: "string", values: ["Loft", "Studio", "Garden", "Tower"] },
    { name: "Rent", type: "number", values: [2400, 1500, 1800, null] },
    { name: "Light", type: "number", values: [9, 4, 7, 8] },
    { name: "Commute", type: "number", values: [20, 50, 30, 25] },
  ] };
  const bounds = [{ atLeast: null, atMost: 2000 }, { atLeast: null, atMost: null }, { atLeast: null, atMost: 45 }];

  it("rules out an option outside a bound before weighing: listed last, unscored, naming the criteria", () => {
    const out = decisionMatrix(apartments, [-1, 2, -1], "max", false, {}, bounds);
    expect(col(out, "Place").values.slice(-2)).toEqual(["Loft", "Studio"]);
    expect(col(out, "Score").values.slice(-2)).toEqual([null, null]);
    expect(col(out, "Rank").values).toEqual([1, 2, null, null]);
    expect(col(out, "Ruled out by").values).toEqual([null, null, "Rent", "Commute"]);
  });

  it("a ruled-out option doesn't shape the scaling of the rest", () => {
    const kept: FrameValue = { __frame: true, columns: apartments.columns.map((c) => ({ ...c, values: [c.values[2], c.values[3]] })) };
    const screened = decisionMatrix(apartments, [-1, 2, -1], "max", false, {}, bounds);
    const alone = decisionMatrix(kept, [-1, 2, -1], "max");
    expect(col(screened, "Score").values.slice(0, 2)).toEqual(col(alone, "Score").values);
  });

  it("a missing value never rules an option out", () => {
    const out = decisionMatrix(apartments, [-1, 2, -1], "max", false, {}, bounds);
    expect(col(out, "Rank").values[col(out, "Place").values.indexOf("Tower")]).not.toBeNull();
  });

  it("a weight of 0 makes a criterion a screen only", () => {
    const out = decisionMatrix(apartments, [0, 1, 0], "max", false, {}, bounds);
    expect(col(out, "Place").values.slice(0, 2)).toEqual(["Tower", "Garden"]);
  });

  it("no bound set adds no column, and everyone ruled out still lists everyone", () => {
    expect(decisionMatrix(apartments, null, "max").columns.map((c) => c.name)).toEqual(["Place", "Score", "Rank", "Filled in"]);
    const none = decisionMatrix(apartments, null, "max", false, {}, [{ atLeast: null, atMost: 1 }, { atLeast: null, atMost: null }, { atLeast: null, atMost: null }]);
    expect(col(none, "Rank").values.filter((v) => v != null)).toEqual([1]); // Tower's rent is missing
  });

  it("the node reads At least and At most from the Weights table, and they are never weights", () => {
    const n = new DecisionMatrixNode();
    const out = n.data({ frame: [apartments], weights: [{ __frame: true, columns: [
      { name: "Criterion", type: "string", values: ["Rent", "Light", "Commute"] },
      { name: "At most", type: "number", values: [2000, null, 45] },
      { name: "Weight", type: "number", values: [-1, 2, -1] },
    ] }] }).frame as FrameValue;
    expect(col(out, "Ruled out by").values.slice(-2)).toEqual(["Rent", "Commute"]);
    expect(col(out, "Place").values[0]).toBe("Tower");
  });

  it("Sensitivity skips the bound columns as scenarios and applies them", () => {
    const cube = decisionSensitivity(apartments, { __frame: true, columns: [
      { name: "Criterion", type: "string", values: ["Rent", "Light", "Commute"] },
      { name: "At most", type: "number", values: [2000, null, 45] },
      { name: "Light-first", type: "number", values: [-1, 3, -1] },
    ] }, "max");
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    expect(cube.columns[0].cells).toEqual(["Light-first"]);
    expect(cube.columns[1].cells).toEqual(["Tower"]);
  });
});

describe("flip points ([[C125]] flipPoints)", () => {
  const cars: FrameValue = { __frame: true, columns: [
    { name: "Car", type: "string", values: ["Civic", "Model 3", "RAV4", "Miata", "Outback"] },
    { name: "Price", type: "number", values: [26, 42, 31, 30, 29] },
    { name: "Range", type: "number", values: [450, 500, 520, 400, 480] },
    { name: "Fun", type: "number", values: [6, 9, 4, 10, 5] },
    { name: "Space", type: "number", values: [6, 6, 9, 2, 9] },
  ] };
  const weights: FrameValue = { __frame: true, columns: [
    { name: "Criterion", type: "string", values: ["Price", "Range", "Fun", "Space"] },
    { name: "Weight", type: "number", values: [-3, 1, 2, 2] },
  ] };
  const w0 = [-3, 1, 2, 2];
  // An unrounded oracle: ÷Max values weighted and summed, the first strict best winning.
  const winnerAt = (j: number, t: number) => {
    const crit = cars.columns.slice(1).map((c) => { const v = c.values as number[]; const m = Math.max(...v.map(Math.abs)); return v.map((x) => x / m); });
    const w = w0.map((x, k) => (k === j ? t : x));
    const tot = (cars.columns[0].values as string[]).map((_, i) => crit.reduce((s, e, k) => s + e[i] * w[k], 0));
    return cars.columns[0].values[tot.reduce((b, v, i) => (v > tot[b] ? i : b), 0)];
  };

  it("names, per criterion, the nearest weights either side where another option takes first place", () => {
    const out = flipPoints(cars, weights, "max");
    expect(out.columns.map((c) => c.name)).toEqual(["Criterion", "Weight", "Flips below", "Winner below", "Flips above", "Winner above"]);
    const now = winnerAt(0, -3);
    let checked = 0;
    out.columns[0].values.forEach((_, j) => {
      for (const [side, dir] of [["below", -1], ["above", 1]] as const) {
        const t = col(out, `Flips ${side}`).values[j] as number | null;
        const who = col(out, `Winner ${side}`).values[j];
        if (t == null) continue;
        checked++;
        expect(winnerAt(j, t + dir * 1e-3)).toBe(who);
        expect(winnerAt(j, t - dir * 1e-3)).toBe(now);
      }
    });
    expect(checked).toBeGreaterThan(2);
  });

  it("never crosses zero: a cost stays a cost", () => {
    const out = flipPoints(cars, weights, "max");
    const above = col(out, "Flips above").values[0];
    expect(above == null || (above as number) <= 0).toBe(true);
    for (let j = 1; j < 4; j++) {
      const below = col(out, "Flips below").values[j];
      expect(below == null || (below as number) >= 0).toBe(true);
    }
  });

  it("a ruled-out option never wins, and one option left flips nowhere", () => {
    const capped: FrameValue = { ...weights, columns: [...weights.columns, { name: "At most", type: "number", values: [27, null, null, null] }] };
    const out = flipPoints(cars, capped, "max");
    expect([...col(out, "Flips below").values, ...col(out, "Flips above").values].every((v) => v == null)).toBe(true);
  });

  it("the node's Flip points mode swaps its output to a frame and reads the Weights table", () => {
    const n = new DecisionSensitivityNode();
    expect(n.outputs.cube!.label).toBe("By scenario");
    expect(n.setMode("flips")).toEqual({ outputChanged: true });
    expect(n.inputs.scenarios!.label).toBe("Weights");
    const out = n.data({ scores: [cars], scenarios: [weights] }).cube;
    expect(isFrameValue(out)).toBe(true);
    expect(isFrameValue(n.data({ scores: [cars] }).cube)).toBe(true);
    expect(new DecisionSensitivityNode({ mode: "flips" }).outputs.cube!.label).toBe("Flip points");
  });
});

describe("Range normalize", () => {
  it("maps each column's lowest to 0 and highest to 1, and a flat column to 0", () => {
    const g: FrameValue = { __frame: true, columns: [
      { name: "name", type: "string", values: ["A", "B", "C"] },
      { name: "rating", type: "number", values: [6, 8, 10] },
      { name: "flat", type: "number", values: [5, 5, 5] },
    ] };
    const out = decisionMatrix(g, [1, 1], "range", true);
    expect(col(out, "rating").values).toEqual([0.5, 0.25, 0]);
    expect(col(out, "flat").values).toEqual([0, 0, 0]);
  });
  it("a Norm cell reads Range or MinMax", () => {
    const n = new DecisionMatrixNode({ detail: "breakdown" });
    const out = n.data({ frame: [{ __frame: true, columns: [
      { name: "name", type: "string", values: ["A", "B"] }, { name: "x", type: "number", values: [2, 4] },
    ] }], weights: [{ __frame: true, columns: [
      { name: "Criterion", type: "string", values: ["x"] }, { name: "Weight", type: "number", values: [1] }, { name: "Norm", type: "string", values: ["MinMax"] },
    ] }] }).frame as FrameValue;
    expect(col(out, "x").values).toEqual([1, 0]);
  });
});

describe("chained decisions ([[C126]] chainedDecisions)", () => {
  const hoods: FrameValue = { __frame: true, columns: [
    { name: "Neighborhood", type: "string", values: ["Hillside", "Riverside", "Old Town"] },
    { name: "Safety", type: "number", values: [9, 7, 6] },
    { name: "Commute", type: "number", values: [20, 30, 25] },
  ] };
  const apts: FrameValue = { __frame: true, columns: [
    { name: "Apartment", type: "string", values: ["Hill 1", "Hill 2", "River 1", "River 2", "Old 1"] },
    { name: "Neighborhood", type: "string", values: ["Hillside", "Hillside", "Riverside", "Riverside", "Old Town"] },
    { name: "Rent", type: "number", values: [2600, 2500, 1700, 1900, 3200] },
    { name: "Light", type: "number", values: [3, 4, 9, 7, 8] },
  ] };
  const cube = relateFramesToCube(hoods, apts, "Neighborhood", "Apartments")!;
  const weights = (rows: [string, number, number | null][]): FrameValue => ({ __frame: true, columns: [
    { name: "Criterion", type: "string", values: rows.map((r) => r[0]) },
    { name: "Weight", type: "number", values: rows.map((r) => r[1]) },
    { name: "At most", type: "number", values: rows.map((r) => r[2]) },
  ] });
  const cubeCol = (c: CubeValue, name: string) => c.columns.find((x) => x.name === name)!.cells;

  it("scores each row with the best option inside it, so a safe area with poor apartments loses", () => {
    const w = weights([["Safety", 2, null], ["Commute", -1, null], ["Rent", -1, null], ["Light", 2, null], ["Apartments", 3, null]]);
    const out = decisionCube(cube, w, "max");
    expect(out.columns.map((c) => c.name)).toEqual(["Neighborhood", "Best in Apartments", "Score", "Rank", "Apartments"]);
    expect(cubeCol(out, "Neighborhood")[0]).toBe("Riverside");
    expect(cubeCol(out, "Best in Apartments")[0]).toBe("River 1");
    const alone = decisionMatrix(hoods, [2, -1], "max");
    expect(col(alone, "Neighborhood").values[0]).toBe("Hillside");
  });

  it("keeps every nested table, ranked best first", () => {
    const out = decisionCube(cube, weights([["Rent", -1, null], ["Light", 2, null]]), "max");
    const hill = cubeCol(out, "Apartments")[cubeCol(out, "Neighborhood").indexOf("Hillside")] as FrameValue;
    expect(col(hill, "Apartment").values).toEqual(["Hill 2", "Hill 1"]);
    expect(col(hill, "Rank").values).toEqual([1, 2]);
  });

  it("a row with nothing acceptable inside is ruled out by the nested column", () => {
    const out = decisionCube(cube, weights([["Rent", -1, 3000], ["Light", 2, null]]), "max");
    const names = cubeCol(out, "Neighborhood");
    const i = names.indexOf("Old Town");
    expect(i).toBe(names.length - 1);
    expect(cubeCol(out, "Rank")[i]).toBeNull();
    expect(cubeCol(out, "Ruled out by")[i]).toBe("Apartments");
  });

  it("chains to any depth: a city counts its best neighborhood, which counts its best apartment", () => {
    const cities: FrameValue = { __frame: true, columns: [
      { name: "City", type: "string", values: ["North", "South"] },
      { name: "Jobs", type: "number", values: [8, 6] },
    ] };
    const hoodsByCity: FrameValue = { ...hoods, columns: [...hoods.columns, { name: "City", type: "string", values: ["North", "South", "South"] }] };
    const deep = relateCubeToFrame(relateFramesToCube(cities, hoodsByCity, "City", "Neighborhoods")!, apts, "Neighborhood", "Apartments");
    const out = decisionCube(deep, weights([["Jobs", 1, null], ["Safety", 2, null], ["Commute", -1, null], ["Rent", -1, null], ["Light", 2, null], ["Apartments", 3, null], ["Neighborhoods", 3, null]]), "max");
    expect(cubeCol(out, "City")[0]).toBe("South");
    expect(cubeCol(out, "Best in Neighborhoods")[0]).toBe("Riverside");
    const inner = cubeCol(out, "Neighborhoods")[0] as CubeValue;
    expect(cubeCol(inner, "Best in Apartments")[0]).toBe("River 1");
  });

  it("the node takes a Cube and gives one back", () => {
    const n = new DecisionMatrixNode();
    expect(isCubeValue(n.data({ frame: [cube], weights: [weights([["Rent", -1, null]])] }).frame)).toBe(true);
    expect(isFrameValue(n.data({ frame: [hoods] }).frame)).toBe(true);
  });
});

describe("a guessed value is said ([[C123]] decisionBlanks)", () => {
  it("Filled in names the criteria whose blank took the median, and only when there is one", () => {
    const g: FrameValue = { __frame: true, columns: [
      { name: "Bid", type: "string", values: ["North", "South", "East"] },
      { name: "Price", type: "number", values: [100, null, 140] },
      { name: "Rating", type: "number", values: [7, 8, null] },
    ] };
    const out = decisionMatrix(g, [-1, 1], "max");
    const by = (n: string) => col(out, "Filled in").values[col(out, "Bid").values.indexOf(n)];
    expect([by("North"), by("South"), by("East")]).toEqual([null, "Price", "Rating"]);
    expect(decisionMatrix(f, null, "max").columns.map((c) => c.name)).not.toContain("Filled in");
  });
});
