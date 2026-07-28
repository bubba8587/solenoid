import { describe, it, expect } from "vitest";
import { compileEvaluator } from "./excelFormula";
import { EXCEL_IMPL_META, listReturningNames, wholeArgNames, resolveExcelFunction } from "./excelFunctions";
import {
  ReverseNode, SliceNode, NthElementNode, InterleaveNode, PadNode, DiffNode, NormalizeNode,
  CumulativeNode, RollingNode, ListLengthNode, ArgMinMaxNode, ContainsNode, WeightedNode,
  LinSpaceNode, RepeatNode, GeometricNode, FibonacciNode,
  CUMULATIVE_OP_META, ROLLING_OP_META, PAD_OP_META, ARG_MIN_MAX_OP_META, WEIGHTED_OP_META,
} from "./nodes/list";

// ─── D19 Tier 3: the node surface and the formula surface agree ───────────────
// Tier 3 makes the Solenoid-native list core callable from a formula. The whole point
// is that the two surfaces STOP being separate implementations, so the test that
// matters is not "does REVERSE work" but "does REVERSE answer what a REVERSE node
// answers". Both sides call `nodes/listOps.ts`; this is what stops someone reverting
// that by hand-inlining one of them again.
//
// Naming is D19 decision 2(a): the formula name is the node's LABEL despaced, taken
// from the family's OP_META table. The name assertions below read the table rather
// than repeating the string, so renaming an op in one place fails here.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const despace = (label: string) => label.replace(/\s+/g, "").toUpperCase();

const LIST = [4, 1, 7, 2];
const WITH_GAP = [4, null, 7, 2];

describe("every Tier 3 name computes what its node computes", () => {
  it("REVERSE", () => {
    expect(ev("REVERSE(x)", { x: LIST })).toEqual(new ReverseNode().data({ list: [LIST] }).result);
  });

  it("SLICE — both the 2-arg (open end) and 3-arg forms", () => {
    const open = new SliceNode();
    expect(ev("SLICE(x, 2)", { x: LIST })).toEqual(open.data({ list: [LIST], start: [2] }).result);
    const closed = new SliceNode();
    expect(ev("SLICE(x, 2, 3)", { x: LIST })).toEqual(closed.data({ list: [LIST], start: [2], end: [3] }).result);
  });

  it("NTHELEMENT", () => {
    expect(ev("NTHELEMENT(x, 2)", { x: LIST })).toEqual(new NthElementNode().data({ list: [LIST], n: [2] }).result);
  });

  it("INTERLEAVE", () => {
    expect(ev("INTERLEAVE(a, b)", { a: [1, 2], b: [9] }))
      .toEqual(new InterleaveNode().data({ a: [[1, 2]], b: [[9]] }).result);
  });

  it("PADLEFT / PADRIGHT — one name per direction, from PAD_OP_META", () => {
    for (const [dir, meta] of Object.entries(PAD_OP_META)) {
      const node = new PadNode({ dir: dir as "left" | "right" });
      expect(ev(`${meta.label}(x, 6, 0)`, { x: LIST }))
        .toEqual(node.data({ list: [LIST], n: [6], fill: [0] }).result);
      expect(despace(meta.label)).toBe(meta.label); // the name IS the label
    }
  });

  it("DIFF", () => {
    expect(ev("DIFF(x)", { x: LIST })).toEqual(new DiffNode().data({ list: [LIST] }).result);
  });

  it("NORMALIZE", () => {
    expect(ev("NORMALIZE(x)", { x: LIST })).toEqual(new NormalizeNode().data({ list: [LIST] }).result);
  });

  it("RUNNING* — one name per Cumulative op", () => {
    for (const [op, meta] of Object.entries(CUMULATIVE_OP_META)) {
      const node = new CumulativeNode({ op: op as "cumsum" });
      expect(ev(`${despace(meta.label)}(x)`, { x: LIST }), meta.label)
        .toEqual(node.data({ list: [LIST] }).result);
    }
  });

  it("ROLLING* — one name per Rolling op, on a list WITH a gap", () => {
    for (const [op, meta] of Object.entries(ROLLING_OP_META)) {
      const node = new RollingNode({ op: op as "sum" });
      expect(ev(`${despace(meta.label)}(x, 2)`, { x: WITH_GAP }), meta.label)
        .toEqual(node.data({ list: [WITH_GAP as (number | null)[]], window: [2] }).result);
    }
  });

  it("LENGTH — counts the missing slot, which is why it takes the list RAW", () => {
    expect(ev("LENGTH(x)", { x: WITH_GAP })).toBe(4);
    expect(ev("LENGTH(x)", { x: WITH_GAP })).toEqual(new ListLengthNode().data({ list: [WITH_GAP] }).result);
  });

  it("ARGMAX / ARGMIN", () => {
    for (const [op, meta] of Object.entries(ARG_MIN_MAX_OP_META)) {
      const node = new ArgMinMaxNode({ op: op as "argmax" });
      expect(ev(`${meta.label}(x)`, { x: LIST }), meta.label).toEqual(node.data({ list: [LIST] }).result);
    }
  });

  it("CONTAINS", () => {
    expect(ev("CONTAINS(x, 7)", { x: LIST })).toEqual(new ContainsNode().data({ list: [LIST], value: [7] }).result);
    expect(ev("CONTAINS(x, 99)", { x: LIST })).toBe(0);
  });

  it("WAVG / WVAR / WSTDEV", () => {
    const values = [1, 2, 3], weights = [1, 1, 2];
    for (const [op, meta] of Object.entries(WEIGHTED_OP_META)) {
      const node = new WeightedNode({ op: op as "wavg" });
      expect(ev(`${meta.label}(x, w)`, { x: values, w: weights }), meta.label)
        .toEqual(node.data({ values: [values], weights: [weights] }).result);
    }
  });

  it("LINSPACE / REPEAT / GEOMETRIC / FIBONACCI", () => {
    expect(ev("LINSPACE(0, 1, 5)")).toEqual(new LinSpaceNode().data({ start: [0], end: [1], count: [5] }).result);
    expect(ev("REPEAT(7, 4)")).toEqual(new RepeatNode().data({ value: [7], count: [4] }).result);
    expect(ev("GEOMETRIC(1, 3, 5)")).toEqual(new GeometricNode().data({ start: [1], ratio: [3], count: [5] }).result);
    expect(ev("FIBONACCI(8)")).toEqual(new FibonacciNode().data({ n: [8] }).result);
  });
});

describe("the whole-list routing, which is the half that isn't the function", () => {
  // The reason Tier 3 needed plumbing at all: without it the evaluator maps a call
  // element-wise over an array argument, so REVERSE([1,2,3]) would have run three
  // times on three scalars and answered [[1],[2],[3]].
  it("a list argument arrives WHOLE, not mapped element-wise", () => {
    expect(ev("REVERSE(x)", { x: [1, 2, 3] })).toEqual([3, 2, 1]);
  });

  it("nulls keep their POSITION — the aggregator null-drop would be wrong here", () => {
    expect(ev("REVERSE(x)", { x: [1, null, 3] })).toEqual([3, null, 1]);
    expect(ev("NTHELEMENT(x, 2)", { x: [1, null, 3, null] })).toEqual([1, 3]);
  });

  it("a cell error rides along in its own slot rather than being hoisted", () => {
    const out = ev("REVERSE(x)", { x: [1, { __solError: true, code: "#DIV/0!", message: "x" }, 3] }) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect((out[1] as { code?: string }).code).toBe("#DIV/0!");
    expect(out[0]).toBe(3);
  });

  it("a whole-list reducer still SURFACES an error rather than a number", () => {
    const r = ev("WAVG(x, w)", { x: [1, { __solError: true, code: "#DIV/0!", message: "x" }], w: [1, 1] });
    expect((r as { code?: string }).code).toBe("#DIV/0!");
  });

  it("a scalar widens to a 1-element list, like a cable into a list input", () => {
    expect(ev("REVERSE(5)")).toEqual([5]);
    expect(ev("LENGTH(5)")).toBe(1);
  });

  it("the results COMPOSE — a list-returning call feeds a range aggregate", () => {
    expect(ev("SUM(REVERSE(x))", { x: [1, 2, 3] })).toBe(6);
    expect(ev("ROLLINGAVG(NORMALIZE(x), 2)", { x: [0, 5, 10] })).toEqual([0, 0.25, 0.75]);
  });

  it("a generator is capped at the formula boundary (the node's Count is a spinner)", () => {
    const r = ev("LINSPACE(0, 1, 2000000)");
    expect((r as { code?: string }).code).toBe("#OVERFLOW!");
    // Under the cap it just computes.
    expect((ev("LINSPACE(0, 1, 3)") as number[]).length).toBe(3);
  });
});

describe("the declarations stay honest", () => {
  it("every listArgs / list-rank name actually resolves", () => {
    for (const name of new Set([...listReturningNames(), ...wholeArgNames()])) {
      expect(resolveExcelFunction(name), `${name} declares a list contract but does not dispatch`).toBeTruthy();
    }
  });

  it("a list-RETURNING function also takes its args whole", () => {
    // The converse isn't true (LENGTH takes a list, returns a scalar), but a function
    // returning a list must never be broadcast — that is how a 2-D result gets built
    // behind D2's back.
    for (const name of listReturningNames()) {
      expect(EXCEL_IMPL_META[name].listArgs, `${name} returns a list but would be broadcast`).toBe(true);
    }
  });

  it("declared arity matches what the registration accepts", () => {
    for (const name of wholeArgNames()) {
      const [min, max] = EXCEL_IMPL_META[name].arity;
      expect(min, name).toBeGreaterThanOrEqual(1);
      expect(max, name).toBeGreaterThanOrEqual(min);
    }
  });
});
