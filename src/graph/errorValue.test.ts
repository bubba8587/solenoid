import { describe, it, expect } from "vitest";
import { solError, isSolError, firstInputError, installErrorGuards, type SolError } from "./errorValue";
import { ArithmeticNode, MathFnNode, CombinatoricsNode } from "./nodes/scalar";
import { IFErrorNode, IsTestNode } from "./nodes/logic";
import { XLookupNode } from "./nodes/frame";
import type { FrameValue } from "./frame";
import { XMatchNode, FilterNode, ListIndexNode } from "./nodes/list";
import { ExpressionNode } from "./nodes/expression";
import { IrrNode, RateNode, MirrNode } from "./nodes/finance";
import { ConvertNode } from "./nodes/convert";
import { ShapeError } from "./nodes/coerce";

describe("SolError tagging", () => {
  it("round-trips through the guard", () => {
    const e = solError("#DIV/0!", "Division by zero");
    expect(isSolError(e)).toBe(true);
    expect(isSolError(null)).toBe(false);
    expect(isSolError(42)).toBe(false);
    expect(isSolError({ code: "#DIV/0!" })).toBe(false); // untagged lookalike
  });

  it("firstInputError scans input arrays", () => {
    const e = solError("#DOMAIN!", "x");
    expect(firstInputError({ a: [1], b: [e] })).toBe(e);
    expect(firstInputError({ a: [1], b: [2] })).toBeNull();
    expect(firstInputError({})).toBeNull();
  });
});

describe("installErrorGuards", () => {
  it("propagates an error input to every output without running the node", () => {
    const n = new ArithmeticNode({ op: "add" });
    installErrorGuards(n);
    const e = solError("#DOMAIN!", "upstream");
    const out = n.data({ a: [e as unknown as number], b: [2] }) as { result: unknown };
    // Origin tagging (Tier 1) mints a fresh object the first time an untagged
    // error is seen, so this is no longer the SAME reference as `e` — check the
    // code/message survived instead.
    expect(isSolError(out.result)).toBe(true);
    expect((out.result as SolError).code).toBe("#DOMAIN!");
    expect((out.result as SolError).message).toBe("upstream");
    expect(n.cachedResult).toBe(out.result); // the value box shows it too
  });

  it("converts a throwing data() into a local #ERROR!", () => {
    const n = new ArithmeticNode({ op: "add" });
    n.data = () => { throw new Error("boom"); };
    installErrorGuards(n);
    const out = n.data({}) as { result: unknown };
    expect(isSolError(out.result)).toBe(true);
    expect((out.result as SolError).code).toBe("#ERROR!");
  });

  it("maps a thrown ShapeError to #SHAPE! (central coercion contract)", () => {
    // The input-coercion wrapper throws ShapeError on a narrowing failure; the
    // guard, wrapping it, must surface that as a tagged #SHAPE! rather than the
    // generic #ERROR! — so a dimension mismatch reads as a shape problem.
    const n = new ArithmeticNode({ op: "add" });
    n.data = () => { throw new ShapeError("Expected a single value, got 4"); };
    installErrorGuards(n);
    const out = n.data({}) as { result: unknown };
    expect(isSolError(out.result)).toBe(true);
    expect((out.result as SolError).code).toBe("#SHAPE!");
    expect((out.result as SolError).message).toMatch(/single value/);
    expect(n.cachedResult).toBe(out.result); // the value box shows it too
  });

  it("is idempotent", () => {
    const n = new ArithmeticNode({ op: "div" });
    installErrorGuards(n);
    installErrorGuards(n);
    const out = n.data({ a: [6], b: [3] }) as { result: unknown };
    expect(out.result).toBe(2);
  });

  it("lets error consumers see the raw error", () => {
    const n = new IFErrorNode({ mode: "iferror" });
    installErrorGuards(n);
    const e = solError("#DIV/0!", "x");
    const out = n.data({ value: [e as unknown as number], fallback: [7] }) as { result: unknown };
    expect(out.result).toBe(7); // caught, not propagated
  });
});

describe("SolError origin (provenance Tier 1)", () => {
  it("tags a node's own minted error with nodeId/nodeName, no input slot", () => {
    const n = new ArithmeticNode({ op: "div" });
    installErrorGuards(n);
    const out = n.data({ a: [1], b: [0] }) as { result: unknown };
    const err = out.result as SolError;
    expect(isSolError(err)).toBe(true);
    expect(err.origin?.nodeId).toBe(n.id);
    expect(err.origin?.nodeName).toBe("Arithmetic");
    expect(err.origin?.inputSlot).toBeUndefined();
  });

  it("tags a thrown error the same way", () => {
    const n = new ArithmeticNode({ op: "add" });
    n.data = () => { throw new Error("boom"); };
    installErrorGuards(n);
    const out = n.data({}) as { result: unknown };
    const err = out.result as SolError;
    expect(err.origin?.nodeId).toBe(n.id);
    expect(err.origin?.nodeName).toBe("Arithmetic");
  });

  it("tags an untagged input error with the input slot it arrived on", () => {
    const n = new ArithmeticNode({ op: "add" });
    installErrorGuards(n);
    const e = solError("#DOMAIN!", "upstream");
    const out = n.data({ a: [1], b: [e as unknown as number] }) as { result: unknown };
    expect((out.result as SolError).origin?.inputSlot).toBe("b");
  });

  it("preserves the ORIGINAL origin through a downstream passthrough (never overwrites)", () => {
    const producer = new ArithmeticNode({ op: "div" });
    installErrorGuards(producer);
    const minted = (producer.data({ a: [1], b: [0] }) as { result: SolError }).result;

    const downstream = new ArithmeticNode({ op: "add" });
    installErrorGuards(downstream);
    const relayed = (downstream.data({ a: [minted as unknown as number], b: [2] }) as { result: SolError }).result;

    expect(relayed.origin?.nodeId).toBe(producer.id); // still the original producer
    expect(relayed.origin?.nodeName).toBe("Arithmetic");
  });

  it("tags a per-cell error inside a list result with its row index", () => {
    const n = new ArithmeticNode({ op: "div" });
    installErrorGuards(n);
    const out = n.data({ a: [[4, 1, 6]], b: [[2, 0, 3]] }) as { result: unknown[] };
    expect(out.result[0]).toBe(2);
    expect(isSolError(out.result[1])).toBe(true);
    expect((out.result[1] as SolError).origin?.rowIndex).toBe(1);
    expect((out.result[1] as SolError).origin?.nodeId).toBe(n.id);
    expect(out.result[2]).toBe(2);
  });

  it("tags a per-cell error inside a frame-shaped output with its row index", () => {
    const e = solError("#VALUE!", "bad cell");
    const n = { id: "n1", label: "Frame Thing", outputs: {}, constructor: { name: "SomeFrameNode" } } as unknown as {
      id: string; data: (i: Record<string, unknown[] | undefined>) => Record<string, unknown>;
    };
    (n as unknown as { data?: unknown }).data = () => ({
      out: { __frame: true, columns: [{ name: "c", type: "number", values: [1, e, 3] }] },
    });
    installErrorGuards(n);
    const out = n.data({}) as { out: { columns: { values: unknown[] }[] } };
    const cell = out.out.columns[0].values[1] as SolError;
    expect(isSolError(cell)).toBe(true);
    expect(cell.origin?.rowIndex).toBe(1);
    expect(cell.origin?.nodeName).toBe("Frame Thing");
  });

  it("leaves an already-tagged frame cell's origin alone", () => {
    const tagged: SolError = { ...solError("#VALUE!", "bad"), origin: { nodeId: "orig", nodeName: "Original" } };
    const n = { id: "n2", outputs: {}, constructor: { name: "SomeFrameNode" } } as unknown as {
      id: string; data: (i: Record<string, unknown[] | undefined>) => Record<string, unknown>;
    };
    (n as unknown as { data?: unknown }).data = () => ({
      out: { __frame: true, columns: [{ name: "c", type: "number", values: [tagged] }] },
    });
    installErrorGuards(n);
    const out = n.data({}) as { out: { columns: { values: unknown[] }[] } };
    expect(out.out.columns[0].values[0]).toBe(tagged); // unchanged reference
  });
});

describe("error consumers", () => {
  const div0 = solError("#DIV/0!", "x") as unknown as number;
  const na = solError("#N/A", "x") as unknown as number;

  it("IFERROR catches every code; IFNA only #N/A", () => {
    expect(new IFErrorNode({ mode: "iferror" }).data({ value: [div0], fallback: [9] }).result).toBe(9);
    expect(new IFErrorNode({ mode: "iferror" }).data({ value: [na], fallback: [9] }).result).toBe(9);
    expect(new IFErrorNode({ mode: "ifna" }).data({ value: [na], fallback: [9] }).result).toBe(9);
    const passed = new IFErrorNode({ mode: "ifna" }).data({ value: [div0], fallback: [9] }).result;
    expect(isSolError(passed)).toBe(true); // non-NA passes through IFNA
  });

  it("a real null (missing) is NOT an error — it passes through both modes", () => {
    // null is no longer "not found"; a not-found is a tagged #N/A (e.g. XLOOKUP).
    expect(new IFErrorNode({ mode: "iferror" }).data({ value: [null], fallback: [9] }).result).toBeNull();
    expect(new IFErrorNode({ mode: "ifna" }).data({ value: [null], fallback: [9] }).result).toBeNull();
  });

  it("catches per-cell errors element-wise, leaving null + good cells", () => {
    // IFERROR over a list: the #DIV/0! cell → fallback, the null stays, 1 & 3 pass.
    const r = new IFErrorNode({ mode: "iferror" })
      .data({ value: [[1, div0, null, 3]], fallback: [9] }).result;
    expect(r).toEqual([1, 9, null, 3]);
  });

  it("IFNA over a list catches only #N/A cells, passing other errors + null", () => {
    const r = new IFErrorNode({ mode: "ifna" })
      .data({ value: [[na, div0, null]], fallback: [0] }).result as unknown[];
    expect(r[0]).toBe(0);             // #N/A caught
    expect(isSolError(r[1])).toBe(true); // #DIV/0! passes through
    expect(r[2]).toBeNull();          // null passes through
  });

  it("ISERROR (Test) and IFERROR agree: only a tagged error counts (a bare NaN does not)", () => {
    // A bare NaN is neither an error nor caught — Test's ISERROR and IFERROR match.
    expect(new IsTestNode({ op: "iserror" }).data({ value: [NaN] }).result).toBe(false);
    expect(new IFErrorNode({ mode: "iferror" }).data({ value: [NaN], fallback: [9] }).result).toBeNaN();
    // A tagged error is caught/flagged by both.
    expect(new IsTestNode({ op: "iserror" }).data({ value: [div0] }).result).toBe(true);
    expect(new IFErrorNode({ mode: "iferror" }).data({ value: [div0], fallback: [9] }).result).toBe(9);
  });

  it("IS-check remembers the observed error for the explanation panel", () => {
    const n = new IsTestNode({ op: "iserror" });
    n.data({ value: [div0] });
    expect(n.seenError && n.seenError.code).toBe("#DIV/0!");
    n.data({ value: [5] });
    expect(n.seenError).toBeNull(); // cleared once the input recovers
  });

  it("ISERROR / ISNA / other IS checks (now emit a real logical)", () => {
    expect(new IsTestNode({ op: "iserror" }).data({ value: [div0] }).result).toBe(true);
    expect(new IsTestNode({ op: "isna" }).data({ value: [na] }).result).toBe(true);
    expect(new IsTestNode({ op: "isna" }).data({ value: [div0] }).result).toBe(false);
    expect(new IsTestNode({ op: "isnumber" }).data({ value: [div0] }).result).toBe(false);
    expect(new IsTestNode({ op: "isblank" }).data({ value: [div0] }).result).toBe(false);
  });

  it("ISNULL — per-cell missing test (unwired ≠ null; works on lists + matrices)", () => {
    // A WIRED null value → TRUE; a value → FALSE; an error ≠ missing → FALSE.
    expect(new IsTestNode({ op: "isnull" }).data({ value: [null] }).result).toBe(true);
    expect(new IsTestNode({ op: "isnull" }).data({ value: [5] }).result).toBe(false);
    expect(new IsTestNode({ op: "isnull" }).data({ value: [div0] }).result).toBe(false);
    // UNWIRED (no operand) is NOT null — the node has nothing to test → blank output.
    expect(new IsTestNode({ op: "isnull" }).data({}).result).toBeNull();
    // List: flags each null cell. Matrix: per CELL (was a crash/garbage before).
    expect(new IsTestNode({ op: "isnull" }).data({ value: [[1, null, 3, null]] }).result).toEqual([false, true, false, true]);
    expect(new IsTestNode({ op: "isnull" }).data({ value: [[[1, null], [null, 4]]] }).result).toEqual([[false, true], [true, false]]);
    // ISBLANK tests the whole input as one cell — a populated list is not blank.
    expect(new IsTestNode({ op: "isblank" }).data({ value: [[1, null, 3]] }).result).toBe(false);
  });
});

describe("error producers", () => {
  it("scalar division by zero is #DIV/0!", () => {
    for (const op of ["div", "mod", "quotient"] as const) {
      const r = new ArithmeticNode({ op }).data({ a: [1], b: [0] }).result;
      expect(isSolError(r)).toBe(true);
      expect((r as SolError).code).toBe("#DIV/0!");
    }
    // Lists keep their per-element behavior — never a whole-list error.
    const list = new ArithmeticNode({ op: "div" }).data({ a: [[4, 2]], b: [0] }).result;
    expect(isSolError(list)).toBe(false);
    expect(Array.isArray(list)).toBe(true);
  });

  it("scalar math-domain failures are #DOMAIN!", () => {
    const r = new MathFnNode({ op: "sqrt" }).data({ in: [-4] }).result;
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#DOMAIN!");
    expect(new MathFnNode({ op: "sqrt" }).data({ in: [9] }).result).toBe(3);
  });

  it("XLOOKUP miss is #N/A unless If-not-found is wired", () => {
    const f: FrameValue = { __frame: true, columns: [
      { name: "k", type: "number", values: [1, 2, 3] },
      { name: "v", type: "number", values: [10, 20, 30] },
    ] };
    const lookup = (val: string, ifNotFound = "") => {
      const n = new XLookupNode();
      n.stringLiterals = { lookup: val, inColumn: "k", returnColumn: "v", ifNotFound };
      return n.data({ frame: [f] }).value;
    };
    const miss = lookup("99");
    expect(isSolError(miss)).toBe(true);
    expect((miss as SolError).code).toBe("#N/A");
    expect(lookup("99", "0")).toBe(0);
    expect(lookup("2")).toBe(20);
  });

  it("XMATCH miss on a wired array is #N/A; unwired stays blank", () => {
    const miss = new XMatchNode().data({ value: [99], array: [[1, 2, 3]] });
    expect(isSolError(miss.result)).toBe(true);
    expect(new XMatchNode().data({ value: [99] }).result).toBeNull();
    expect(new XMatchNode().data({ value: [2], array: [[1, 2, 3]] }).result).toBe(2);
  });

  it("Filter dimension mismatches are #SHAPE!", () => {
    // A mask matching neither the data's rows nor columns is a shape error;
    // so is asking the predicate to filter a genuine 2-D table with no mask.
    const badMask = new FilterNode().data({ list: [[[1, 2, 3]]], mask: [[1, 0]] }).result;
    expect(isSolError(badMask)).toBe(true);
    expect((badMask as SolError).code).toBe("#SHAPE!");
    const noMask2D = new FilterNode().data({ list: [[[1, 2], [3, 4]]] }).result;
    expect(isSolError(noMask2D)).toBe(true);
    expect((noMask2D as SolError).code).toBe("#SHAPE!");
    // A clean 1-D filter still returns data, never an error.
    const ok = new FilterNode({ op: "gt" }).data({ list: [[[1, 5, 2]]], threshold: [3] }).result;
    expect(isSolError(ok)).toBe(false);
  });

  it("Expression syntax failures are #SYNTAX!; empty formula stays blank", () => {
    const bad = new ExpressionNode({ expr: "a +* b" });
    const r = bad.data({}).result;
    expect(isSolError(r)).toBe(true);
    expect((r as SolError).code).toBe("#SYNTAX!");
    expect(new ExpressionNode({ expr: "" }).data({}).result).toBeNull();
  });

  it("iterative finance solvers report #CONV! when they can't converge", () => {
    // An all-positive cash flow series has no internal rate of return — NPV is
    // positive at every rate, so Newton never lands on a root.
    const irr = new IrrNode().data({ list: [[100, 200, 300]] }).result;
    expect(isSolError(irr)).toBe(true);
    expect((irr as SolError).code).toBe("#CONV!");
    // A real sign-changing series still converges to a number.
    expect(new IrrNode().data({ list: [[-100, 0, 0, 0, 146.41]] }).result).toBeCloseTo(0.1, 4);
    // RATE on an unsolvable annuity (all same-sign, no rate balances it).
    const rate = new RateNode().data({ nper: [10], pmt: [100], pv: [100], fv: [100] }).result;
    expect(isSolError(rate)).toBe(true);
    expect((rate as SolError).code).toBe("#CONV!");
    // An IRR that is wired but has too few points stays a blank, not an error.
    expect(new IrrNode().data({ list: [[5]] }).result).toBeNull();
  });

  it("MIRR needs both signs of cash flow (#DIV/0!)", () => {
    const allPos = new MirrNode().data({ list: [[100, 200, 300]], finrate: [0.1], reinrate: [0.12] }).result;
    expect(isSolError(allPos)).toBe(true);
    expect((allPos as SolError).code).toBe("#DIV/0!");
    expect(new MirrNode().data({ list: [[-1000, 300, 400, 500]], finrate: [0.1], reinrate: [0.12] }).result)
      .toBeCloseTo(0.09816, 4);
  });

  it("Combinatorics: out-of-domain is #DOMAIN!, overflow is #OVERFLOW!", () => {
    const domain = new CombinatoricsNode({ op: "combin" }).data({ n: [3], k: [5] }).result; // k > n
    expect(isSolError(domain)).toBe(true);
    expect((domain as SolError).code).toBe("#DOMAIN!");
    const overflow = new CombinatoricsNode({ op: "fact" }).data({ n: [200] }).result; // 200! = ∞
    expect(isSolError(overflow)).toBe(true);
    expect((overflow as SolError).code).toBe("#OVERFLOW!");
    expect(new CombinatoricsNode({ op: "fact" }).data({ n: [5] }).result).toBe(120);
  });

  it("INDEX past the ends of a list is #REF!", () => {
    const oob = new ListIndexNode().data({ list: [[10, 20, 30]], index: [99] }).result;
    expect(isSolError(oob)).toBe(true);
    expect((oob as SolError).code).toBe("#REF!");
    expect(new ListIndexNode().data({ list: [[10, 20, 30]], index: [2] }).result).toBe(20);
    // No list wired yet is a blank, not a dangling reference.
    expect(new ListIndexNode().data({ index: [2] }).result).toBeNull();
  });

  it("Convert across unit families is #N/A", () => {
    const cross = new ConvertNode({ fromUnit: "m", toUnit: "kg" }).data({ in: [5] }).out;
    expect(isSolError(cross)).toBe(true);
    expect((cross as SolError).code).toBe("#N/A");
    // A same-family conversion works (metres → kilometres).
    expect(new ConvertNode({ fromUnit: "m", toUnit: "km" }).data({ in: [2000] }).out).toBeCloseTo(2, 9);
  });
});
