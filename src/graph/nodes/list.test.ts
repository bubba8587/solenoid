import { describe, it, expect } from "vitest";
import type { CondAggOp } from "./list";
import {
  RangeNode,
  LinSpaceNode,
  NormalizeNode,
  DiffNode,
  CumulativeNode,
  RollingNode,
  WeightedNode,
  ArgMinMaxNode,
  AggregateNode,
  FilterNode,
  SumIfsNode,
  FillNode,
  SortNode,
  SortByNode,
  InterleaveNode,
  ListInputNode,
  SetOpNode,
  SET_OP_META,
  SetRelationNode,
  SET_RELATION_META,
  IsInNode,
  TallyNode,
  type ReduceOp,
  type FillOp,
} from "./list";
import { broadcast, broadcastErr } from "./shared";
import { solError, isSolError } from "../errorValue";
import katex from "katex";

describe("Range", () => {
  it("counts up, stop-exclusive", () => {
    expect(new RangeNode().data({ start: [0], stop: [5], step: [1] }).list).toEqual([0, 1, 2, 3, 4]);
    expect(new RangeNode().data({ start: [0], stop: [10], step: [2] }).list).toEqual([0, 2, 4, 6, 8]);
  });
  it("counts down with a negative step", () => {
    expect(new RangeNode().data({ start: [5], stop: [0], step: [-1] }).list).toEqual([5, 4, 3, 2, 1]);
  });
  it("is empty when stop is unreachable or step is 0", () => {
    expect(new RangeNode().data({ start: [0], stop: [5], step: [-1] }).list).toEqual([]);
    expect(new RangeNode().data({ start: [0], stop: [5], step: [0] }).list).toEqual([]);
  });
});

describe("LinSpace", () => {
  it("includes both endpoints", () => {
    expect(new LinSpaceNode().data({ start: [0], end: [1], count: [5] }).result).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("handles count 1 and 0", () => {
    expect(new LinSpaceNode().data({ start: [3], end: [9], count: [1] }).result).toEqual([3]);
    expect(new LinSpaceNode().data({ start: [3], end: [9], count: [0] }).result).toEqual([]);
  });
});

describe("Normalize", () => {
  it("maps min→0 and max→1", () => {
    expect(new NormalizeNode().data({ list: [[10, 20, 30]] }).result).toEqual([0, 0.5, 1]);
  });
  it("maps a constant list to all zeros", () => {
    expect(new NormalizeNode().data({ list: [[7, 7, 7]] }).result).toEqual([0, 0, 0]);
  });
});

describe("Diff", () => {
  it("is the first difference, one shorter than the input", () => {
    expect(new DiffNode().data({ list: [[1, 3, 6, 10]] }).result).toEqual([2, 3, 4]);
  });
});

describe("List Input (multi-type)", () => {
  const sockType = (s: unknown) => (s as { dataType?: string } | undefined)?.dataType;
  it("defaults to a single number row + numlist output", () => {
    const n = new ListInputNode();
    expect(Object.keys(n.inputs).length).toBe(1);
    expect(n.dataType).toBe("number");
    expect(sockType(n.outputs.list?.socket)).toBe("numlist");
  });
  it("parses a comma-separated number list", () => {
    const n = new ListInputNode();
    n.stringLiterals["v0"] = "1, 2.5, 3";
    expect(n.data({}).list).toEqual([1, 2.5, 3]);
  });
  it("switches to text: re-types row + output sockets and parses a CSV of strings", () => {
    const n = new ListInputNode();
    expect(n.setDataType("string")).toBe(true);
    expect(sockType(n.outputs.list?.socket)).toBe("strlist");
    expect(sockType(n.inputs.v0?.socket)).toBe("strlist");
    n.stringLiterals["v0"] = "apple, pear, fig";
    expect(n.data({}).list).toEqual(["apple", "pear", "fig"]);
  });
  it("date type parses to ascending serials", () => {
    const n = new ListInputNode({ dataType: "date" });
    n.stringLiterals["v0"] = "01-Jan-2026, 02-Jan-2026";
    const out = n.data({}).list;
    expect(out.length).toBe(2);
    expect(typeof out[0]).toBe("number");
    expect(out[1] as number).toBeGreaterThan(out[0] as number);
  });
  it("logical type parses booleans (true/false/1/0/yes/no) and drops junk", () => {
    const n = new ListInputNode({ dataType: "logical" });
    n.stringLiterals["v0"] = "true, false, 1, 0, yes, no, maybe";
    expect(n.data({}).list).toEqual([true, false, true, false, true, false]);
  });
  it("setDataType is a no-op (returns false) when unchanged", () => {
    expect(new ListInputNode().setDataType("number")).toBe(false);
  });
  it("concatenates rows + a wired list, keeping only elements of the current type", () => {
    const n = new ListInputNode();
    const k2 = n.addValueInput();
    n.stringLiterals["v0"] = "1, 2";
    expect(n.data({ [k2]: [[3, 4]] }).list).toEqual([1, 2, 3, 4]);
  });
});

describe("Set operations (two lists)", () => {
  const run = (op: "union" | "intersect" | "difference" | "symdiff", a: unknown[], b: unknown[]) =>
    new SetOpNode({ op }).data({ a: [a as number[]], b: [b as number[]] }).result;

  it("difference — in A but not B (the headline op), first-seen order", () => {
    expect(run("difference", [1, 2, 3, 4], [2, 4])).toEqual([1, 3]);
    expect(run("difference", ["apple", "pear", "fig"], ["pear"])).toEqual(["apple", "fig"]);
  });
  it("intersection — in both", () => {
    expect(run("intersect", [1, 2, 3, 4], [2, 4, 9])).toEqual([2, 4]);
  });
  it("union — in either, deduped, A's order then B's new ones", () => {
    expect(run("union", [1, 2, 2, 3], [3, 4, 1])).toEqual([1, 2, 3, 4]);
  });
  it("symmetric difference — in exactly one", () => {
    expect(run("symdiff", [1, 2, 3], [2, 3, 4])).toEqual([1, 4]);
  });
  it("dedupes within a side (like UNIQUE)", () => {
    expect(run("intersect", [1, 1, 2, 2], [2, 2])).toEqual([2]);
    expect(run("difference", [5, 5, 6], [])).toEqual([5, 6]);
  });
  it("ignores blank (null) cells — they are not members", () => {
    expect(run("union", [1, null, 2], [null, 3])).toEqual([1, 2, 3]);
    expect(run("difference", [1, null, 2], [2])).toEqual([1]);
  });
  it("errors survive union + A-side difference, drop from intersection (never match)", () => {
    const e = solError("#REF!", "bad");
    // union: A's error passes through (not deduped against values)
    const u = run("union", [1, e], [2]);
    expect(u.filter((v) => isSolError(v)).length).toBe(1);
    expect(u.filter((v) => !isSolError(v))).toEqual([1, 2]);
    // difference: A's error is "not in B" → kept
    expect(run("difference", [e, 1], [1]).some((v) => isSolError(v))).toBe(true);
    // intersection: an error can't be "in both" → dropped
    expect(run("intersect", [e, 2], [e, 2])).toEqual([2]);
  });

  it("complex numbers compare by VALUE, not array identity (Set-node fix)", () => {
    // A complex is an [re, im] array; each 3+4i below is a SEPARATE array instance,
    // so a reference-keyed Set would never match them. They must intersect/dedupe.
    expect(run("intersect", [[3, 4], [1, 2]], [[3, 4], [5, 6]])).toEqual([[3, 4]]);
    expect(run("union", [[3, 4], [1, 2]], [[3, 4]])).toEqual([[3, 4], [1, 2]]);
    expect(run("difference", [[3, 4], [1, 2]], [[3, 4]])).toEqual([[1, 2]]);
    // Is In: membership by value across distinct instances.
    expect(new IsInNode().data({ a: [[[3, 4], [9, 9]]], b: [[[3, 4]]] }).result).toEqual([true, false]);
    // Tally: equal complexes count together — two distinct rows, not three.
    // (The frame Value column stringifies complex since frames have no complex
    // type — a separate limitation; the fix is that the COUNT groups by value.)
    const tally = new TallyNode().data({ list: [[[3, 4], [3, 4], [1, 2]]] }).frame;
    expect(tally?.columns[0].values.length).toBe(2);
    expect(tally?.columns[1].values).toEqual([2, 1]);
  });

  it("every op's set notation is valid KaTeX (else the card silently shows plain text)", () => {
    for (const meta of Object.values(SET_OP_META)) {
      expect(() => katex.renderToString(meta.tex, { throwOnError: true })).not.toThrow();
    }
  });
});

describe("Set relation tests (two lists → TRUE/FALSE)", () => {
  const run = (op: "equal" | "subset" | "superset" | "disjoint", a: unknown[], b: unknown[]) =>
    new SetRelationNode({ op }).data({ a: [a as number[]], b: [b as number[]] }).result;

  it("equal — same set regardless of order or duplicates", () => {
    expect(run("equal", [1, 2, 3], [3, 2, 1])).toBe(true);
    expect(run("equal", [1, 1, 2], [2, 1])).toBe(true);
    expect(run("equal", [1, 2], [1, 2, 3])).toBe(false);
  });
  it("subset — every A is in B", () => {
    expect(run("subset", [1, 2], [1, 2, 3])).toBe(true);
    expect(run("subset", [1, 4], [1, 2, 3])).toBe(false);
  });
  it("superset — A contains all of B", () => {
    expect(run("superset", [1, 2, 3], [1, 2])).toBe(true);
    expect(run("superset", [1, 2], [1, 2, 3])).toBe(false);
  });
  it("disjoint — no shared members", () => {
    expect(run("disjoint", [1, 2], [3, 4])).toBe(true);
    expect(run("disjoint", [1, 2], [2, 3])).toBe(false);
  });
  it("empty-set edge cases follow set theory", () => {
    expect(run("subset", [], [1, 2])).toBe(true);    // ∅ ⊆ anything
    expect(run("disjoint", [], [1, 2])).toBe(true);  // ∅ disjoint with anything
    expect(run("equal", [], [])).toBe(true);         // ∅ = ∅
    expect(run("superset", [1], [])).toBe(true);     // anything ⊇ ∅
  });
  it("blanks and errors are not members", () => {
    const e = solError("#REF!", "bad");
    expect(run("equal", [1, null, 2], [2, 1])).toBe(true);
    expect(run("equal", [1, 2, e], [1, 2])).toBe(true);       // the error isn't a value
    expect(run("subset", [1, e], [1])).toBe(true);            // A's members are just {1}
  });
  it("both inputs unwired → null (indeterminate)", () => {
    expect(new SetRelationNode().data({}).result).toBe(null);
  });
  it("every relation's notation is valid KaTeX", () => {
    for (const meta of Object.values(SET_RELATION_META)) {
      expect(() => katex.renderToString(meta.tex, { throwOnError: true })).not.toThrow();
    }
  });
});

describe("Cumulative", () => {
  it("cumsum", () => {
    expect(new CumulativeNode({ op: "cumsum" }).data({ list: [[1, 2, 3, 4]] }).result).toEqual([1, 3, 6, 10]);
  });
  it("cumprod", () => {
    expect(new CumulativeNode({ op: "cumprod" }).data({ list: [[1, 2, 3, 4]] }).result).toEqual([1, 2, 6, 24]);
  });
  it("cummax / cummin", () => {
    expect(new CumulativeNode({ op: "cummax" }).data({ list: [[3, 1, 4, 1, 5]] }).result).toEqual([3, 3, 4, 4, 5]);
    expect(new CumulativeNode({ op: "cummin" }).data({ list: [[5, 3, 4, 1, 2]] }).result).toEqual([5, 3, 3, 1, 1]);
  });
});

describe("Rolling", () => {
  it("trailing-window sum grows then slides", () => {
    expect(new RollingNode({ op: "sum" }).data({ list: [[1, 2, 3, 4, 5]], window: [3] }).result).toEqual([1, 3, 6, 9, 12]);
  });
  it("trailing-window average", () => {
    expect(new RollingNode({ op: "avg" }).data({ list: [[2, 4, 6, 8]], window: [2] }).result).toEqual([2, 3, 5, 7]);
  });

  // v1.0 audit finding 14: each window runs through forAggregate.
  it("a per-cell error lands in exactly the windows that contain it", () => {
    const err = solError("#DIV/0!", "boom");
    const r = new RollingNode({ op: "sum" }).data({ list: [[1, err, 3, 4]], window: [2] }).result as unknown[];
    expect(r[0]).toBe(1);
    expect(isSolError(r[1])).toBe(true); // window [1, err]
    expect(isSolError(r[2])).toBe(true); // window [err, 3]
    expect(r[3]).toBe(7);                // window [3, 4] — error slid out
  });

  it("nulls are skipped, not counted as 0 (average divides by present count)", () => {
    const r = new RollingNode({ op: "avg" }).data({ list: [[2, null, 4]], window: [2] }).result;
    expect(r).toEqual([2, 2, 4]); // [2], [2,·], [·,4]
  });

  it("an all-null window is 0 for sum, null otherwise", () => {
    const r1 = new RollingNode({ op: "sum" }).data({ list: [[null, null, 5]], window: [1] }).result;
    expect(r1).toEqual([0, 0, 5]);
    const r2 = new RollingNode({ op: "max" }).data({ list: [[null, 5]], window: [1] }).result;
    expect(r2).toEqual([null, 5]);
  });
});

describe("Weighted", () => {
  it("weighted average", () => {
    const r = new WeightedNode({ op: "wavg" }).data({ values: [[1, 2, 3, 4]], weights: [[4, 3, 2, 1]] });
    expect(r.result).toBeCloseTo(2, 9);
  });
  it("equal weights reproduce the sample variance", () => {
    const r = new WeightedNode({ op: "wvar" }).data({ values: [[1, 2, 3, 4]], weights: [[1, 1, 1, 1]] });
    expect(r.result).toBeCloseTo(5 / 3, 9);
  });
  it("skips a pair when either the value or its weight is null", () => {
    // weight[2] is null → pair (3,·) dropped. Survivors (1,4)(2,3)(4,1):
    // WAVG = (1·4 + 2·3 + 4·1) / (4+3+1) = 14/8 = 1.75.
    const r = new WeightedNode({ op: "wavg" }).data({ values: [[1, 2, 3, 4]], weights: [[4, 3, null, 1]] });
    expect(r.result).toBeCloseTo(1.75, 9);
  });
  it("propagates a SolError in either list", () => {
    const err = solError("#DIV/0!", "boom");
    const r = new WeightedNode({ op: "wavg" }).data({ values: [[1, err, 3]], weights: [[1, 1, 1]] });
    expect(isSolError(r.result) && r.result.code).toBe("#DIV/0!");
  });
});

describe("ArgMax / ArgMin", () => {
  it("returns a 1-based position", () => {
    expect(new ArgMinMaxNode({ op: "argmax" }).data({ list: [[3, 1, 4, 1, 5, 9, 2]] }).result).toBe(6);
    expect(new ArgMinMaxNode({ op: "argmin" }).data({ list: [[3, 1, 4, 1, 5, 9, 2]] }).result).toBe(2);
  });
});

describe("Reduce — basic aggregates", () => {
  const list = [[2, 4, 4, 4, 5, 5, 7, 9]];
  const reduce = (op: ReduceOp) =>
    new AggregateNode({ op }).data({ list }).result;

  it("sum / avg / min / max / count", () => {
    expect(reduce("sum")).toBe(40);
    expect(reduce("avg")).toBe(5);
    expect(reduce("min")).toBe(2);
    expect(reduce("max")).toBe(9);
    expect(reduce("count")).toBe(8);
  });
  it("median (even length averages the middle pair)", () => {
    expect(reduce("median")).toBe(4.5);
  });
  it("sumsq / devsq / avedev", () => {
    expect(reduce("sumsq")).toBe(232);
    expect(reduce("devsq")).toBe(32);
    expect(reduce("avedev")).toBeCloseTo(1.5, 9);
  });
});

describe("Aggregate — null skipped, errors propagated (array-semantics policy)", () => {
  const agg = (op: ReduceOp, list: (number | null | ReturnType<typeof solError>)[][]) =>
    new AggregateNode({ op }).data({ list }).result;

  it("skips null (missing) — SUM/AVG/COUNT ignore the gaps", () => {
    expect(agg("sum", [[10, null, 20, 30, null]])).toBe(60);
    // AVERAGE divides by the count of PRESENT values (3), not the list length.
    expect(agg("avg", [[10, null, 20, 30, null]])).toBe(20);
    expect(agg("count", [[10, null, 20, 30, null]])).toBe(3);
    expect(agg("min", [[null, 5, 2, null]])).toBe(2);
  });

  it("an all-null list reduces like an empty list (sum→0, count→0, avg→null)", () => {
    // Empty-list identities per audit finding 30: sum 0, product 1, count 0 —
    // matching the formula path and aggregateGroup; the rest stay null.
    expect(agg("sum", [[null, null]])).toBe(0);
    expect(agg("count", [[null, null]])).toBe(0);
    expect(agg("avg", [[null, null]])).toBeNull();
  });

  it("propagates a SolError anywhere in the list", () => {
    const err = solError("#DIV/0!", "boom");
    const out = agg("sum", [[1, 2, err, 4]]);
    expect(isSolError(out) && out.code).toBe("#DIV/0!");
  });
});

describe("Reduce — variance / stdev (sample vs population)", () => {
  const list = [[2, 4, 4, 4, 5, 5, 7, 9]]; // mean 5, Σdev² = 32, n = 8
  const reduce = (op: ReduceOp) =>
    new AggregateNode({ op }).data({ list }).result;

  it("population divides by n", () => {
    expect(reduce("var_p")).toBeCloseTo(4, 9);
    expect(reduce("stdev_p")).toBeCloseTo(2, 9);
  });
  it("sample divides by n-1", () => {
    expect(reduce("var_s")).toBeCloseTo(32 / 7, 9);
    expect(reduce("stdev")).toBeCloseTo(Math.sqrt(32 / 7), 9);
  });
});

describe("Reduce — means and shape", () => {
  it("GEOMEAN / HARMEAN", () => {
    expect(new AggregateNode({ op: "geomean" }).data({ list: [[1, 2, 4]] }).result).toBeCloseTo(2, 9);
    expect(new AggregateNode({ op: "harmean" }).data({ list: [[1, 2, 4]] }).result).toBeCloseTo(12 / 7, 9);
  });
  it("SKEW is 0 for a symmetric set", () => {
    expect(new AggregateNode({ op: "skew" }).data({ list: [[1, 2, 3, 4, 5]] }).result).toBeCloseTo(0, 9);
    expect(new AggregateNode({ op: "skew_p" }).data({ list: [[1, 2, 3, 4, 5]] }).result).toBeCloseTo(0, 9);
  });
  it("KURT matches Excel for 1..5", () => {
    expect(new AggregateNode({ op: "kurt" }).data({ list: [[1, 2, 3, 4, 5]] }).result).toBeCloseTo(-1.2, 9);
  });
});

describe("Filter — condition rows over the list's own values (D16)", () => {
  const mk = (
    conds: Array<{ op: import("../frameVerbs").FilterOp; value: string; matchCase?: boolean }>,
    combine: "and" | "or" = "and",
  ) => {
    const n = new FilterNode({
      combine,
      valueKeys: conds.map((_, i) => `value${i}`),
      condConfig: Object.fromEntries(conds.map((c, i) => [String(i), { op: c.op, matchCase: c.matchCase }])),
    });
    conds.forEach((c, i) => { n.stringLiterals[`value${i}`] = c.value; });
    return n;
  };

  it("a missing cell fails the condition and lands in Dropped (exhaustive split)", () => {
    const out = mk([{ op: "gt", value: "1" }]).data({ list: [[1, null, 3]] });
    expect(out.result).toEqual([3]);
    expect(out.dropped).toEqual([1, null]);
  });

  it("text lists filter with the frame ops; Match case rides per condition", () => {
    const cities = ["Oslo", "BERGEN", "oslo"];
    expect(mk([{ op: "eq", value: "oslo" }]).data({ list: [cities] }).result).toEqual(["Oslo", "oslo"]);
    expect(mk([{ op: "eq", value: "oslo", matchCase: true }]).data({ list: [cities] }).result).toEqual(["oslo"]);
    expect(mk([{ op: "contains", value: "berg" }]).data({ list: [cities] }).result).toEqual(["BERGEN"]);
  });

  it("AND narrows, OR unions", () => {
    const arr = [1, 5, 10, 20];
    expect(mk([{ op: "gt", value: "2" }, { op: "lt", value: "15" }], "and").data({ list: [arr] }).result).toEqual([5, 10]);
    expect(mk([{ op: "lt", value: "2" }, { op: "gt", value: "15" }], "or").data({ list: [arr] }).result).toEqual([1, 20]);
  });

  it("no written condition = pass-through (Dropped stays blank)", () => {
    const out = new FilterNode().data({ list: [[1, 2]] });
    expect(out.result).toEqual([1, 2]);
    expect(out.dropped).toBeNull();
  });

  it("a WIRED scalar drives a Value row (the `any` socket): number, boolean, and a wired null reads as unwritten", () => {
    const n = mk([{ op: "gt", value: "999" }]); // literal is overridden by the cable
    expect(n.data({ list: [[1, 5, 10]], value0: [4] }).result).toEqual([5, 10]);
    // Boolean threshold on a logical list (stringifies to "true").
    const nb = mk([{ op: "eq", value: "" }]);
    expect(nb.data({ list: [[true, false, true]], value0: [true] }).result).toEqual([true, true]);
    // A wired MISSING wins over the literal and reads as "not written yet".
    const nn = mk([{ op: "gt", value: "2" }]);
    const out = nn.data({ list: [[1, 5]], value0: [null] });
    expect(out.result).toEqual([1, 5]);
    expect(out.dropped).toBeNull();
  });

  it("a per-cell error fails its condition and lands in Dropped unmorphed", () => {
    const err = solError("#DIV/0!", "x");
    const out = mk([{ op: "gt", value: "1" }]).data({ list: [[1, err, 3]] });
    expect(out.result).toEqual([3]);
    expect((out.dropped as unknown[])[1]).toBe(err);
  });

  it("legacy combine \"none\" folds to AND; valueKeys round-trip (persistence contract)", () => {
    expect(new FilterNode({ combine: "none" }).combine).toBe("and");
    const n = mk([{ op: "gt", value: "1" }, { op: "lt", value: "9" }]);
    const clone = new FilterNode({ valueKeys: n.valueInputKeys(), condConfig: n.condConfig });
    expect(clone.valueInputKeys()).toEqual(n.valueInputKeys());
    expect(clone.condConfig["1"].op).toBe("lt");
  });
});

describe("SUMIFS — conditional aggregation over one frame (D16, amended)", () => {
  const region = ["North", "South", "North", "East", "North", "South"];
  const sales = [120, 80, 200, 150, 90, 60];
  const frame = (vals: unknown[] = sales, regs: unknown[] = region) => ({
    __frame: true as const,
    columns: [
      { name: "region", type: "string" as const, values: regs },
      { name: "sales", type: "number" as const, values: vals },
    ],
  });
  const mk = (
    op: CondAggOp,
    conds: Array<{ column: string; op: import("../frameVerbs").FilterOp; value: string }>,
    valuesCol = "sales",
  ) => {
    const n = new SumIfsNode({
      op,
      valueKeys: conds.flatMap((_, i) => [`column${i}`, `value${i}`]),
      condConfig: Object.fromEntries(conds.map((c, i) => [String(i), { op: c.op }])),
    });
    n.stringLiterals.values = valuesCol;
    conds.forEach((c, i) => {
      n.stringLiterals[`column${i}`] = c.column;
      n.stringLiterals[`value${i}`] = c.value;
    });
    return n;
  };

  it("SUMIFS(sales, region, North) — the whole point, one node on one frame", () => {
    const n = mk("sumifs", [{ column: "region", op: "eq", value: "North" }]);
    expect(n.data({ frame: [frame()] }).result).toBe(410); // 120+200+90
  });

  it("COUNTIFS needs no Values column; two criteria AND like Excel", () => {
    const n = mk("countifs", [{ column: "region", op: "eq", value: "North" }]);
    expect(n.data({ frame: [frame()] }).result).toBe(3);
    const two = mk("sumifs", [
      { column: "region", op: "eq", value: "North" },
      { column: "sales", op: "gt", value: "100" },
    ]);
    expect(two.data({ frame: [frame()] }).result).toBe(320); // 120+200
  });

  it("empty matches follow Excel: AVERAGEIFS → #DIV/0!, MINIFS/MAXIFS → 0", () => {
    const avg = mk("averageifs", [{ column: "region", op: "eq", value: "Mars" }]).data({ frame: [frame()] }).result;
    expect(isSolError(avg) && avg.code).toBe("#DIV/0!");
    expect(mk("minifs", [{ column: "region", op: "eq", value: "Mars" }]).data({ frame: [frame()] }).result).toBe(0);
  });

  it("MINIFS/MAXIFS over a large matched set don't RangeError (iterMin/iterMax, not spread)", () => {
    // A frame this big is ordinary once verbs run in Polars; Math.min(...nums)
    // throws past ~125k args, so the spread form would black out on a real table.
    const N = 200_000;
    const regs = new Array(N).fill("North");
    const vals = Array.from({ length: N }, (_, i) => i);
    const big = () => frame(vals, regs);
    expect(mk("minifs", [{ column: "region", op: "eq", value: "North" }]).data({ frame: [big()] }).result).toBe(0);
    expect(mk("maxifs", [{ column: "region", op: "eq", value: "North" }]).data({ frame: [big()] }).result).toBe(N - 1);
  });

  it("kept nulls are skipped; a kept error propagates (aggregate policy)", () => {
    const n = mk("sumifs", [{ column: "region", op: "eq", value: "North" }]);
    expect(n.data({ frame: [frame([10, 1, null, 1, 5, 1])] }).result).toBe(15);
    const err = solError("#DIV/0!", "x");
    const out = n.data({ frame: [frame([10, 1, err, 1, 5, 1])] }).result;
    expect(isSolError(out) && out.code).toBe("#DIV/0!");
  });

  it("a missing column is an honest #REF!; a WIRED scalar drives a Value row", () => {
    const bad = mk("sumifs", [{ column: "nope", op: "eq", value: "x" }]).data({ frame: [frame()] }).result;
    expect(isSolError(bad) && bad.code).toBe("#REF!");
    // wired threshold (the `any` scalar socket) overrides the literal
    const n = mk("sumifs", [{ column: "sales", op: "gt", value: "999" }]);
    expect(n.data({ frame: [frame()], value0: [100] }).result).toBe(470); // 120+200+150
  });
});

describe("Fill / Coalesce — missing-value strategies (array-semantics policy)", () => {
  const fill = (op: FillOp, list: (number | null | ReturnType<typeof solError>)[], extra: Record<string, unknown> = {}) =>
    new FillNode({ op }).data({ list: [list], ...extra }).result;

  it("constant replaces gaps with the wired/literal value, leaves present cells", () => {
    expect(fill("constant", [1, null, 3], { value: [0] })).toEqual([1, 0, 3]);
    // default literal is 0 when no value is wired
    expect(new FillNode({ op: "constant" }).data({ list: [[null, 5, null]] }).result).toEqual([0, 5, 0]);
  });

  it("forward / backward fill carry the nearest present value over gaps", () => {
    expect(fill("ffill", [null, 1, null, 3, null])).toEqual([null, 1, 1, 3, 3]);
    expect(fill("bfill", [null, 1, null, 3, null])).toEqual([1, 1, 3, 3, null]);
  });

  it("mean / median / mode impute from the present values only", () => {
    expect(fill("mean", [2, null, 4])).toEqual([2, 3, 4]); // mean(2,4)=3
    expect(fill("median", [1, null, 2, 4])).toEqual([1, 2, 2, 4]); // median(1,2,4)=2
    expect(fill("mode", [5, 5, null, 2])).toEqual([5, 5, 5, 2]); // mode=5
  });

  it("interpolate fills interior gaps linearly; open-ended gaps stay null", () => {
    expect(fill("interpolate", [1, null, 3])).toEqual([1, 2, 3]);
    expect(fill("interpolate", [1, null, null, 4])).toEqual([1, 2, 3, 4]);
    expect(fill("interpolate", [null, 2, 3])).toEqual([null, 2, 3]); // no left bracket
    expect(fill("interpolate", [1, 2, null])).toEqual([1, 2, null]); // no right bracket
  });

  it("drop removes the missing cells (shortens the list)", () => {
    expect(fill("drop", [1, null, 3, null, 5])).toEqual([1, 3, 5]);
  });

  it("coalesce takes the first present of List then Else, per position", () => {
    expect(new FillNode({ op: "coalesce" }).data({ list: [[1, null, 3]], e0: [[9, 8, 7]] }).result)
      .toEqual([1, 8, 3]);
    // missing in both stays null; Else can be longer
    expect(new FillNode({ op: "coalesce" }).data({ list: [[null, null]], e0: [[5, null, 6]] }).result)
      .toEqual([5, null, 6]);
  });

  it("coalesce is N-ary: each Else row in order, first present wins", () => {
    const n = new FillNode({ op: "coalesce" }); // ships with e0
    n.addValueInput(); // e1
    expect(n.elseKeys()).toEqual(["e0", "e1"]);
    expect(n.data({ list: [[null, null, 3]], e0: [[9, null, null]], e1: [[5, 6, 7]] }).result)
      .toEqual([9, 6, 3]);
  });

  it("coalesce: a typed literal on an unwired Else row is a broadcast constant (doesn't extend)", () => {
    const n = new FillNode({ op: "coalesce" });
    n.literals.e0 = 42;
    expect(n.data({ list: [[null, 1, null]] }).result).toEqual([42, 1, 42]);
    // an untouched row contributes nothing
    const bare = new FillNode({ op: "coalesce" });
    expect(bare.data({ list: [[null, 1]] }).result).toEqual([null, 1]);
  });

  it("coalesce: valueKeys round-trip rebuilds the Else rows (fixed inputs filtered out)", () => {
    const n = new FillNode({ op: "coalesce", valueKeys: ["list", "value", "e0", "e1", "e2"] });
    expect(n.elseKeys()).toEqual(["e0", "e1", "e2"]);
    // a fresh add after reload never collides with a rebuilt key
    expect(n.addValueInput()).toBe("e3");
  });

  it("coalesce: an error cell is present (passes through at its priority slot)", () => {
    const err = solError("#DIV/0!", "boom");
    const n = new FillNode({ op: "coalesce" });
    const out = n.data({ list: [[err, null]], e0: [[1, 2]] }).result as unknown[];
    expect(isSolError(out[0])).toBe(true);
    expect(out[1]).toBe(2);
  });

  it("a per-cell error is NOT a gap — every mode passes it through untouched", () => {
    const err = solError("#DIV/0!", "boom");
    const out = fill("constant", [1, err, null], { value: [0] }) as unknown[];
    expect(out[0]).toBe(1);
    expect(isSolError(out[1]) && (out[1] as { code: string }).code).toBe("#DIV/0!");
    expect(out[2]).toBe(0); // the null gap is filled, the error is left alone
  });

  it("statistics skip error cells when computing the impute value", () => {
    const err = solError("#DIV/0!", "x");
    const out = fill("mean", [2, err, 4, null]) as unknown[]; // mean of present (2,4)=3
    expect(out[0]).toBe(2);
    expect(isSolError(out[1])).toBe(true);
    expect(out[2]).toBe(4);
    expect(out[3]).toBe(3); // the gap imputed from present numbers, ignoring the error
  });
});

describe("Aggregate — n<2 stdev blanks; empty-list identities (audit finding 30)", () => {
  it("sample stdev of a single value is blank, matching var_s", () => {
    expect(new AggregateNode({ op: "stdev" }).data({ list: [[5]] }).result).toBeNull();
    expect(new AggregateNode({ op: "var_s" }).data({ list: [[5]] }).result).toBeNull();
  });
  it("empty list: sum 0, product 1, count 0, avg blank", () => {
    expect(new AggregateNode({ op: "sum" }).data({ list: [[]] }).result).toBe(0);
    expect(new AggregateNode({ op: "product" }).data({ list: [[]] }).result).toBe(1);
    expect(new AggregateNode({ op: "count" }).data({ list: [[]] }).result).toBe(0);
    expect(new AggregateNode({ op: "avg" }).data({ list: [[]] }).result).toBeNull();
  });
  it("all-null list behaves like empty", () => {
    expect(new AggregateNode({ op: "sum" }).data({ list: [[null, null]] }).result).toBe(0);
    expect(new AggregateNode({ op: "product" }).data({ list: [[null]] }).result).toBe(1);
  });
});

describe("Sort — nulls and per-cell errors last in both directions (frame blanks-last policy)", () => {
  const err = solError("#DIV/0!", "test");
  it("ascending: values sort, null/error tail keeps input order", () => {
    expect(new SortNode({ dir: "asc" }).data({ list: [[3, null, 1, err, 2]] }).result)
      .toEqual([1, 2, 3, null, err]);
  });
  it("descending: values flip, tail stays last", () => {
    expect(new SortNode({ dir: "desc" }).data({ list: [[3, null, 1, err, 2]] }).result)
      .toEqual([3, 2, 1, null, err]);
  });
});

describe("SortBy — ragged pad-to-longest; null/error keys sort last (audit finding 25)", () => {
  it("a value beyond the key list gets a null key and lands last", () => {
    expect(new SortByNode().data({ array: [[10, 20, 30]], by_array: [[2, 1]] }).list)
      .toEqual([20, 10, 30]);
  });
  it("a null key mid-list sends its row to the tail, stably", () => {
    expect(new SortByNode().data({ array: [[10, 20, 30]], by_array: [[2, null, 1]] }).list)
      .toEqual([30, 10, 20]);
  });
  it("keys beyond the value list emit null values in key order", () => {
    expect(new SortByNode().data({ array: [[10]], by_array: [[3, 1]] }).list)
      .toEqual([null, 10]);
  });
  it("sorts a TEXT array by a parallel numeric key (the reorder is element-agnostic)", () => {
    // "names by scores": the array is any element type, only the keys are numeric.
    expect(new SortByNode().data({ array: [["Ann", "Bob", "Cy"]], by_array: [[3, 1, 2]] }).list)
      .toEqual(["Bob", "Cy", "Ann"]);
    // A date-serial array reorders the same way.
    expect(new SortByNode().data({ array: [[46000, 45000, 45500]], by_array: [[2, 3, 1]] }).list)
      .toEqual([45500, 46000, 45000]);
  });
});

describe("Interleave — ragged pad-to-longest keeps the A/B alternation aligned", () => {
  it("pads the shorter list with null instead of dropping the tail", () => {
    expect(new InterleaveNode().data({ a: [[1, 2, 3]], b: [[10]] }).result)
      .toEqual([1, 10, 2, null, 3, null]);
  });
});

describe("broadcast / broadcastErr — ragged lists pad to the longest with null", () => {
  it("a padded position is missing outright (fn not called)", () => {
    expect(broadcast((a, b) => a + b, [1, 2, 3], [10, 20])).toEqual([11, 22, null]);
    expect(broadcast((a, b) => a + b, [1], [10, 20, 30])).toEqual([11, null, null]);
  });
  it("broadcastErr pads too, alongside genuine per-cell errors", () => {
    const div = (a: number, b: number) => (b === 0 ? solError("#DIV/0!", "test") : a / b);
    expect(broadcastErr(div, [10, 20], [2, 0, 5])).toEqual([5, solError("#DIV/0!", "test"), null]);
  });
});
