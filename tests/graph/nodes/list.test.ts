// [[C24]] arraySemantics
import { solDate } from "../../../src/graph/dateValue";
import { coerceFrameCell } from "../../../src/graph/frame";
import { describe, it, expect } from "vitest";
import type { CondAggOp } from "../../../src/graph/nodes/list";
import {
  SeriesNode,
  RunningNode,
  AggregateNode,
  FilterNode,
  SumIfsNode,
  FillNode,
  SortNode,
  ListInputNode,
  SetsNode,
  SET_OP_META,
  SET_RELATION_META,
  SET_META,
  type SetOpAll,
  IsInNode,
  TallyNode,
  type ReduceOp,
  type FillOp,
} from "../../../src/graph/nodes/list";
import { cx } from "../../../src/graph/cxValue";
import { solError, isSolError } from "../../../src/graph/errorValue";
import katex from "katex";





describe("List Input (multi-type)", () => {
  const sockType = (s: unknown) => (s as { dataType?: string } | undefined)?.dataType;
  it("defaults to a single number row + numlist output", () => {
    const n = new ListInputNode();
    expect(Object.keys(n.inputs).length).toBe(1);
    expect(sockType(n.outputs.list?.socket)).toBe("numlist");
  });
  it("switches to text: re-types row + output sockets and parses a CSV of strings", () => {
    const n = new ListInputNode();
    expect(n.setDataType("string")).toBe(true);
    expect(sockType(n.outputs.list?.socket)).toBe("strlist");
    expect(sockType(n.inputs.v0?.socket)).toBe("strlist");
    n.stringLiterals["v0"] = "apple, pear, fig";
    expect(n.data({}).list).toEqual(["apple", "pear", "fig"]);
  });
  it("a typed gap is a blank item that holds its place; a trailing comma adds nothing ([[C24]] arraySemantics)", () => {
    const n = new ListInputNode();
    n.stringLiterals["v0"] = "1,,3";
    expect(n.data({}).list).toEqual([1, null, 3]);
    n.stringLiterals["v0"] = ", 2, 3,";
    expect(n.data({}).list).toEqual([null, 2, 3]);
    n.stringLiterals["v0"] = " , ,";
    expect(n.data({}).list).toEqual([]);
    n.setDataType("string");
    n.stringLiterals["v0"] = "a,,c";
    expect(n.data({}).list).toEqual(["a", null, "c"]);
  });
  it("setDataType is a no-op (returns false) when unchanged", () => {
    expect(new ListInputNode().setDataType("number")).toBe(false);
  });

  // ─── The 2026-07-25 List Input audit (all four types × wired/typed) ──────────
  // Every case below was a silent wrong answer, found by sweeping the four SegToggle
  // positions against the same inputs. They share one cause: the node treated its list
  // as "elements of my type, everything else discarded", which the value model doesn't
  // allow (null and SolError ride through ANY typed list), and it parsed its typed text
  // with a second, divergent parser that only ever ran in Number mode.


  it("a WILDCARD source can't silently empty the list (any / anylist / trueany)", () => {
    // The wildcard ladder means `any`/`anylist`/`trueany` connect to EVERY row socket,
    // but carry whatever value flowed in. A number reaching a Text row used to make the
    // whole list vanish — empty output, no cable rejected, no error shown.
    expect(new ListInputNode({ dataType: "string" }).data({ v0: [[1, 2]] }).list).toEqual(["1", "2"]);
    expect(new ListInputNode({ dataType: "string" }).data({ v0: [5] }).list).toEqual(["5"]);
  });




  it("a typed item reads exactly as a Frame Input cell of the same type, a day as a date: unreadable is NaN, never dropped", () => {
    const text = "abc, 5, 2024, 01-Jan-2026, true";
    const asDate = (c: unknown) => (typeof c === "number" && !Number.isNaN(c) ? solDate(c) : c);
    for (const t of ["number", "string", "date", "logical"] as const) {
      const n = new ListInputNode({ dataType: t });
      n.stringLiterals["v0"] = text;
      const items = text.split(",").map((x) => x.trim());
      expect(n.data({}).list, t).toEqual(items.map((x) => coerceFrameCell(t, x)).map((c) => (t === "date" ? asDate(c) : c)));
    }
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
    new SetsNode({ op }).data({ a: [a as number[]], b: [b as number[]] }).result as unknown[];

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

  it("complex numbers compare by VALUE, not object identity (Set-node fix)", () => {
    // A complex is a tagged OBJECT ([[C24]] arraySemantics); each 3+4i below is a SEPARATE instance,
    // so a reference-keyed Set would never match them. They must intersect/dedupe.
    expect(run("intersect", [cx(3, 4), cx(1, 2)], [cx(3, 4), cx(5, 6)])).toEqual([cx(3, 4)]);
    expect(run("union", [cx(3, 4), cx(1, 2)], [cx(3, 4)])).toEqual([cx(3, 4), cx(1, 2)]);
    expect(run("difference", [cx(3, 4), cx(1, 2)], [cx(3, 4)])).toEqual([cx(1, 2)]);
    // Is In: membership by value across distinct instances.
    expect(new IsInNode().data({ a: [[cx(3, 4), cx(9, 9)]], b: [[cx(3, 4)]] }).result).toEqual([true, false]);
    // Tally: equal complexes count together — two distinct rows, not three.
    // (The frame Value column stringifies complex since frames have no complex
    // type — a separate limitation; the fix is that the COUNT groups by value.)
    const tally = new TallyNode().data({ list: [[cx(3, 4), cx(3, 4), cx(1, 2)]] }).frame;
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
    new SetsNode({ op }).data({ a: [a as number[]], b: [b as number[]] }).result;

  it("equal — same set regardless of order or duplicates", () => {
    expect(run("equal", [1, 2, 3], [3, 2, 1])).toBe(true);
    expect(run("equal", [1, 1, 2], [2, 1])).toBe(true);
    expect(run("equal", [1, 2], [1, 2, 3])).toBe(false);
  });
  it("subset — every A is in B", () => {
    expect(run("subset", [1, 2], [1, 2, 3])).toBe(true);
    expect(run("subset", [1, 4], [1, 2, 3])).toBe(false);
  });
  // superset is subsetOf with the args mirrored (listOps.ts) — the dispatch is
  // pinned by the empty-set case below; the semantics ride the subset tests.
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
  it("every relation's notation is valid KaTeX", () => {
    for (const meta of Object.values(SET_RELATION_META)) {
      expect(() => katex.renderToString(meta.tex, { throwOnError: true })).not.toThrow();
    }
  });
});

describe("Set — one merged card across both families", () => {
  const outType = (op: SetOpAll) => {
    const s = new SetsNode({ op }).outputs.result!.socket as { dataType?: string; base?: string };
    return s.base ?? s.dataType; // adoptive list reports its base; logical its dataType
  };
  it("the result socket is an adoptive list for an operation, a logical for a relation", () => {
    for (const op of ["union", "intersect", "difference", "symdiff"] as const) expect(outType(op)).toBe("anylist");
    for (const op of ["equal", "subset", "superset", "disjoint"] as const) expect(outType(op)).toBe("logical");
  });
  it("SET_META spans all eight ops, grouped Operation / Relation", () => {
    expect(Object.keys(SET_META).sort()).toEqual([...Object.keys(SET_OP_META), ...Object.keys(SET_RELATION_META)].sort());
    for (const op of Object.keys(SET_OP_META)) expect(SET_META[op as SetOpAll].group).toBe("Operation");
    for (const op of Object.keys(SET_RELATION_META)) expect(SET_META[op as SetOpAll].group).toBe("Relation");
  });
});

describe("Running over a list of one unit keeps the unit, as Reduce does", () => {
  const kg = (value: number) => ({ __unitCell: true, value, dim: { mass: 1 }, display: "kg" });
  const run = (agg: "sum" | "product" | "max", list: unknown[], window = 0) =>
    new RunningNode({ agg }).data({ list: [list as never], window: [window] }).result;
  it("sums, slides and multiplies", () => {
    expect(run("sum", [kg(1), kg(2), kg(3)])).toEqual([kg(1), kg(3), kg(6)]);
    expect(run("max", [kg(1), null, kg(3)], 2)).toEqual([kg(1), kg(1), kg(3)]);
    expect(run("product", [kg(2), kg(3)])).toEqual([kg(2), { __unitCell: true, value: 6, dim: { mass: 2 } }]);
  });
  it("refuses mixed units", () => {
    const r = run("sum", [kg(1), { __unitCell: true, value: 1, dim: { length: 1 }, display: "m" }]);
    expect((r as { code?: string }).code).toBe("#UNIT!");
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


describe("Filter — condition rows over the list's own values ([[C49]] filterOneJob)", () => {
  const mk = (
    conds: Array<{ op: import("../../../src/graph/frameOps").FilterOp; value: string; matchCase?: boolean }>,
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

  it("is blank KEEPS the nulls — the one way a null lands in Kept (2026-07-16)", () => {
    const n = mk([{ op: "isblank", value: "" }]);
    const out = n.data({ list: [[3, null, 5, null]] });
    expect(out.result).toEqual([null, null]);
    expect(out.dropped).toEqual([3, 5]);
    const inv = mk([{ op: "notblank", value: "" }]);
    expect(inv.data({ list: [[3, null, 5]] }).result).toEqual([3, 5]);
  });

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

  it("a text predicate on a number list is #TYPE! ([[C10]] socketLattice)", () => {
    expect(() => mk([{ op: "contains", value: "2" }]).data({ list: [[1, 12, 3]] }))
      .toThrowError(expect.objectContaining({ code: "#TYPE!" }));
  });

  it("a text predicate on an empty or all-blank list keeps nothing and drops the blanks ([[C10]] socketLattice)", () => {
    for (const op of ["contains", "startsWith", "endsWith"] as const) {
      expect(mk([{ op, value: "a" }]).data({ list: [[]] }).result).toEqual([]);
      const out = mk([{ op, value: "a" }]).data({ list: [[null, null]] });
      expect(out.result).toEqual([]);
      expect(out.dropped).toEqual([null, null]);
    }
  });

  it("a text predicate on a list mixing text and numbers answers each item: a non-text one is its own #TYPE!", () => {
    const code = (v: unknown) => (v as { code?: string })?.code ?? v;
    expect((mk([{ op: "contains", value: "a" }]).data({ list: [[1, "apple", "kiwi"]] }).result as unknown[]).map(code)).toEqual(["#TYPE!", "apple"]);
    expect((mk([{ op: "contains", value: "a" }]).data({ list: [["apple", 1]] }).result as unknown[]).map(code)).toEqual(["apple", "#TYPE!"]);
  });

  it("a text predicate on a list with no text at all is #TYPE! for the whole list", () => {
    expect(() => mk([{ op: "contains", value: "a" }]).data({ list: [[1, 2]] }))
      .toThrowError(expect.objectContaining({ code: "#TYPE!" }));
  });

  it("AND narrows, OR unions", () => {
    const arr = [1, 5, 10, 20];
    expect(mk([{ op: "gt", value: "2" }, { op: "lt", value: "15" }], "and").data({ list: [arr] }).result).toEqual([5, 10]);
    expect(mk([{ op: "lt", value: "2" }, { op: "gt", value: "15" }], "or").data({ list: [arr] }).result).toEqual([1, 20]);
  });


  it("a WIRED scalar drives a Value row (the `any` socket): number, boolean, and a wired blank skips the condition", () => {
    const n = mk([{ op: "gt", value: "999" }]); // literal is overridden by the cable
    expect(n.data({ list: [[1, 5, 10]], value0: [4] }).result).toEqual([5, 10]);
    // Boolean threshold on a logical list (stringifies to "true").
    const nb = mk([{ op: "eq", value: "" }]);
    expect(nb.data({ list: [[true, false, true]], value0: [true] }).result).toEqual([true, true]);
    // A wired blank is the condition left out, so the list passes through ([[D86]] blankRoles).
    const nn = mk([{ op: "gt", value: "2" }]);
    const out = nn.data({ list: [[1, 5]], value0: [null] });
    expect(out.result).toEqual([1, 5]);
    expect(out.dropped).toBeNull();
    // The UNWIRED slot with an empty literal still passes the list through.
    expect(mk([{ op: "gt", value: "" }]).data({ list: [[1, 5]] }).result).toEqual([1, 5]);
  });

  it("a per-cell error fails its condition and lands in Dropped unmorphed", () => {
    const err = solError("#DIV/0!", "x");
    const out = mk([{ op: "gt", value: "1" }]).data({ list: [[1, err, 3]] });
    expect(out.result).toEqual([3]);
    expect((out.dropped as unknown[])[1]).toBe(err);
  });

  it("valueKeys round-trip (persistence contract)", () => {
    const n = mk([{ op: "gt", value: "1" }, { op: "lt", value: "9" }]);
    const clone = new FilterNode({ valueKeys: n.valueInputKeys(), condConfig: n.condConfig });
    expect(clone.valueInputKeys()).toEqual(n.valueInputKeys());
    expect(clone.condConfig["1"].op).toBe("lt");
  });
});

describe("SUMIFS — conditional aggregation over one frame ([[C49]] filterOneJob, amended)", () => {
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
    conds: Array<{ column: string; op: import("../../../src/graph/frameOps").FilterOp; value: string }>,
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

  it("match ANY: a row passing EITHER criterion counts (OR, not AND)", () => {
    const n = mk("sumifs", [
      { column: "region", op: "eq", value: "North" }, // rows 0,2,4 → 120,200,90
      { column: "sales", op: "gt", value: "140" },     // rows 2,3 → 200,150 (East)
    ]);
    n.match = "any";
    // Union of matched rows {0,2,4} ∪ {2,3} = {0,2,3,4} → 120+200+150+90.
    expect(n.data({ frame: [frame()] }).result).toBe(560);
    // The default (all) intersects: only row 2 (North AND >140) → 200.
    const all = mk("sumifs", [
      { column: "region", op: "eq", value: "North" },
      { column: "sales", op: "gt", value: "140" },
    ]);
    expect(all.data({ frame: [frame()] }).result).toBe(200);
  });

  it("match ANY with zero completed criteria is null, same as ALL with zero", () => {
    const anyN = mk("sumifs", []); anyN.match = "any";
    const allN = mk("sumifs", []);
    expect(anyN.data({ frame: [frame()] }).result).toBeNull();
    expect(allN.data({ frame: [frame()] }).result).toBeNull();
  });

  it("empty matches: AVERAGEIFS is blank as AVERAGE is ([[C24]] arraySemantics), MINIFS/MAXIFS → 0 as in Excel", () => {
    const avg = mk("averageifs", [{ column: "region", op: "eq", value: "Mars" }]).data({ frame: [frame()] }).result;
    expect(avg).toBeNull();
    expect(mk("minifs", [{ column: "region", op: "eq", value: "Mars" }]).data({ frame: [frame()] }).result).toBe(0);
  });

  it("MINIFS/MAXIFS over a large matched set don't RangeError (iterMin/iterMax, not spread)", () => {
    // Math.min(...nums) throws past ~125k args, so the spread form would black out on a real table.
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


  it("coalesce is N-ary: each Else row in order, first present wins", () => {
    const n = new FillNode({ op: "coalesce" }); // ships with e0
    n.addValueInput(); // e1
    expect(n.elseKeys()).toEqual(["e0", "e1"]);
    expect(n.data({ list: [[null, null, 3]], e0: [[9, null, null]], e1: [[5, 6, 7]] }).result)
      .toEqual([9, 6, 3]);
  });


  it("coalesce: valueKeys round-trip rebuilds the Else rows (fixed inputs filtered out)", () => {
    const n = new FillNode({ op: "coalesce", valueKeys: ["list", "value", "e0", "e1", "e2"] });
    expect(n.elseKeys()).toEqual(["e0", "e1", "e2"]);
    // a fresh add after reload never collides with a rebuilt key
    expect(n.addValueInput()).toBe("e3");
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



describe("Sort by key rows (SORTBY): each key has its own order; a length mismatch is #VALUE!", () => {
  const keyed = (keys: { v: unknown; desc?: boolean }[]) => {
    const n = new SortNode();
    const inputs: Record<string, unknown[]> = {};
    for (const k of keys) { const key = n.addValueInput(); inputs[key] = [k.v]; if (k.desc) n.keyOrder[key.slice(3)] = "desc"; }
    return { n, inputs };
  };
  it("a wired-blank key is blank data, so the answer is blank", () => {
    const { n, inputs } = keyed([{ v: null }]);
    expect(n.data({ list: [[3, 1, 2]], ...inputs }).result).toBeNull();
  });
  it("sorts a TEXT list by a parallel numeric key (a list key is a row, so the items reorder)", () => {
    const { n, inputs } = keyed([{ v: [3, 1, 2] }]);
    expect(n.data({ list: [["Ann", "Bob", "Cy"]], ...inputs }).result).toEqual(["Bob", "Cy", "Ann"]);
  });
  it("a descending key flips the order, null keys stay last; later keys break ties", () => {
    const { n, inputs } = keyed([{ v: [3, 1, 2], desc: true }]);
    expect(n.data({ list: [["Ann", "Bob", "Cy"]], ...inputs }).result).toEqual(["Ann", "Cy", "Bob"]);
    const t = keyed([{ v: [[1], [1], [0]] }, { v: [[5], [4], [9]], desc: true }]);
    expect(t.n.data({ list: [[["a"], ["b"], ["c"]]], ...t.inputs }).result).toEqual([["c"], ["a"], ["b"]]);
  });
  it("a length mismatch between the data and a key is a loud #VALUE!, never a silent pad", () => {
    const { n, inputs } = keyed([{ v: [2, 1] }]);
    expect((n.data({ list: [[10, 20, 30]], ...inputs }).result as { code?: string })?.code).toBe("#VALUE!");
  });
});


describe("Series — one arithmetic-progression node, op-switch mechanics", () => {

  it("Start survives every switch; Stop/End/Count swap per parameterization", () => {
    const n = new SeriesNode({ op: "range" });
    expect(n.keysDroppedBySwitch("linspace")).toEqual(["stop", "step"]);
    expect(n.keysDroppedBySwitch("sequence")).toEqual(["stop"]);
    n.setOp("linspace");
    expect(Object.keys(n.inputs).sort()).toEqual(["count", "end", "start"]);
    n.setOp("sequence");
    expect(Object.keys(n.inputs).sort()).toEqual(["cols", "count", "start", "step"]);
  });

  it("Range's Stop stays unset across switches — empty until the user provides one", () => {
    const n = new SeriesNode({ op: "linspace" });
    n.setOp("range");
    expect(n.literals.stop).toBeUndefined();
    expect(n.data({}).list).toEqual([]);
  });

  it("a seeded default gives way to the next op's own default", () => {
    const n = new SeriesNode({ op: "range" });
    n.setOp("sequence");
    expect(n.literals.start).toBeUndefined();
    expect(n.data({}).list).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const g = new SeriesNode({ op: "geometric" });
    g.setOp("range");
    expect(g.literals.start).toBe(0);
    g.setOp("linspace");
    expect(g.literals.count).toBe(10);
  });

  const type = (n: SeriesNode, key: string, v: number) => { n.literals[key] = v; n.noteLiteralEdit(key, false); };
  it("a value the user typed survives the switch", () => {
    const n = new SeriesNode({ op: "range" });
    type(n, "start", 5);
    n.setOp("sequence");
    expect(n.literals.start).toBe(5);
    const g = new SeriesNode({ op: "geometric" });
    type(g, "count", 3);
    g.setOp("linspace");
    expect(g.literals.count).toBe(3);
  });

  it("a typed value equal to the old op's default survives too, and is saved as typed", () => {
    const n = new SeriesNode({ op: "range" });
    type(n, "start", 0);
    n.setOp("sequence");
    expect(n.literals.start).toBe(0);
    const reloaded = new SeriesNode({ op: "range", typedKeys: n.typedKeys });
    reloaded.literals.start = 0;
    reloaded.setOp("sequence");
    expect(reloaded.literals.start).toBe(0);
  });
});


describe("UNIQUE takes any element family ([[D73]] nodeCoversFormula)", () => {
  const uniqueList = async (list: unknown[]) => {
    const { UniqueNode } = await import("../../../src/graph/nodes/list");
    return new UniqueNode({ byCol: true }).data({ list: [list] }).result;
  };
  it("dedupes text like the formula does, and passes its input type through", async () => {
    const { UniqueNode } = await import("../../../src/graph/nodes/list");
    const { compileEvaluator } = await import("../../../src/graph/excelFormula");
    const n = new UniqueNode({ byCol: true });
    expect(n.data({ list: [["a", "b", "a"]] }).result).toEqual(["a", "b"]);
    expect(compileEvaluator("UNIQUE(x, TRUE)")!({ x: ["a", "b", "a"] })).toEqual(["a", "b"]);
    expect(n.passthrough()).toEqual([{ output: "result", inputs: ["list"], combine: "single" }]);
  });
  it("5 km and 5000 m are one member", async () => {
    const { fromUnit } = await import("../../../src/graph/unitValue");
    const { fcUnitToUnit } = await import("../../../src/graph/dimension");
    const km = fromUnit(5, fcUnitToUnit("km")!, "km");
    const m = fromUnit(5000, fcUnitToUnit("m")!, "m");
    const s = fromUnit(5, fcUnitToUnit("s")!, "s");
    expect(await uniqueList([km, m, s])).toEqual([km, s]);
  });
  it("1.1 h and 3960 s are one member despite the float residue", async () => {
    const { fromUnit } = await import("../../../src/graph/unitValue");
    const { fcUnitToUnit } = await import("../../../src/graph/dimension");
    const h = fromUnit(1.1, fcUnitToUnit("h")!, "h");
    const s = fromUnit(3960, fcUnitToUnit("s")!, "s");
    expect(await uniqueList([h, s])).toEqual([h]);
  });
  it("a zero exponent is no dimension, as everywhere else units compare", async () => {
    const a = { __unitCell: true as const, value: 4, dim: { length: 2 } };
    const b = { __unitCell: true as const, value: 4, dim: { length: 2, "custom:b": 0 } };
    expect(await uniqueList([a, b])).toEqual([a]);
  });
});

describe("Running over mixed units ([[C25]] firstClassUnits)", () => {
  it("adds 1 km, 500 m and 2 km by their dimension, not their shown numbers", async () => {
    const { computeAlone } = await import("../boundaryKit");
    const { fromUnit, isUnitCell } = await import("../../../src/graph/unitValue");
    const { fcUnitToUnit } = await import("../../../src/graph/dimension");
    const km = (n: number) => fromUnit(n, fcUnitToUnit("km")!, "km");
    const out = await computeAlone(new RunningNode({ agg: "sum" }), { list: [[km(1), fromUnit(500, fcUnitToUnit("m")!, "m"), km(2)]] });
    const cells = out.result as unknown[];
    expect(cells.every(isUnitCell)).toBe(true);
    expect(cells.map((c) => Math.round((c as { value: number }).value))).toEqual([1000, 1500, 3500]);
  });
});
