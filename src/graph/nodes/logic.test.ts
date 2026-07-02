import { describe, it, expect } from "vitest";
import { ComparisonNode } from "./logic";

// Comparisons now emit a real logical (P7): TRUE/FALSE, not 1/0. Downstream
// numeric consumers coerce boolean→1/0 at the socket (coerceInputs), so the
// classic multiply-by-a-condition trick still works — that path is exercised
// by the integration/seeds suites.
describe("ComparisonNode emits a real logical", () => {
  it("scalar comparison → a boolean", () => {
    expect(new ComparisonNode({ op: "gt" }).data({ a: [5], b: [3] }).result).toBe(true);
    expect(new ComparisonNode({ op: "gt" }).data({ a: [1], b: [3] }).result).toBe(false);
    expect(new ComparisonNode({ op: "eq" }).data({ a: [2], b: [2] }).result).toBe(true);
  });
  it("list comparison → a boolean list (element-wise, scalar broadcasts)", () => {
    expect(new ComparisonNode({ op: "gt" }).data({ a: [[1, 5, 3]], b: [2] }).result)
      .toEqual([false, true, true]);
  });
});

import { BooleanOpNode, NotNode, IfNode } from "./logic";

// Helper: run a BooleanOp over N scalar operands (a0, a1, …) via literals.
const boolRun = (op: "and" | "or" | "xor" | "xnor" | "nand" | "nor", ...vals: number[]) => {
  const n = new BooleanOpNode({ op });
  // ensure enough operand rows
  while (n.valueInputKeys().length < vals.length) n.addValueInput();
  const keys = n.valueInputKeys();
  vals.forEach((v, i) => { n.literals[keys[i]] = v; });
  return n.data({}).result;
};

describe("BooleanOpNode — variadic boolean reducers emit a real logical", () => {
  it("AND/OR/XOR over two operands → TRUE/FALSE", () => {
    expect(boolRun("and", 1, 1)).toBe(true);
    expect(boolRun("and", 1, 0)).toBe(false);
    expect(boolRun("or", 0, 0)).toBe(false);
    expect(boolRun("xor", 1, 0)).toBe(true);
  });
  it("AND/OR fold across MANY operands", () => {
    expect(boolRun("and", 1, 1, 1, 1)).toBe(true);
    expect(boolRun("and", 1, 1, 0, 1)).toBe(false);
    expect(boolRun("or", 0, 0, 0, 1)).toBe(true);
  });
  it("XOR = odd count of trues; XNOR = even count", () => {
    expect(boolRun("xor", 1, 1, 1)).toBe(true);   // 3 trues → odd
    expect(boolRun("xor", 1, 1, 0)).toBe(false);  // 2 trues → even
    expect(boolRun("xnor", 1, 1, 0)).toBe(true);  // even → TRUE
  });
  it("NAND/NOR negate AND/OR over N", () => {
    expect(boolRun("nand", 1, 1, 1)).toBe(false);
    expect(boolRun("nor", 0, 0, 0)).toBe(true);
  });
});

describe("NotNode — unary element-wise logical flip", () => {
  it("flips a scalar truth", () => {
    expect(new NotNode().data({ in: [0] }).result).toBe(true);
    expect(new NotNode().data({ in: [1] }).result).toBe(false);
  });
  it("broadcasts over a list (null stays null)", () => {
    expect(new NotNode().data({ in: [[1, 0, null]] }).result).toEqual([false, true, null]);
  });
});

describe("IfNode — value passthrough (not a boolean)", () => {
  const ifRun = (cond: number, then: number, els: number) => {
    const n = new IfNode();
    n.literals = { cond, then, else: els };
    return n.data({}).result;
  };
  it("condition true → the true branch, false → the false branch", () => {
    expect(ifRun(1, 5, 3)).toBe(5);
    expect(ifRun(0, 5, 3)).toBe(3);
  });
  it("accepts a REAL boolean condition (the logical socket's coerced form)", () => {
    expect(new IfNode().data({ cond: [true], then: [5], else: [3] }).result).toBe(5);
    expect(new IfNode().data({ cond: [false], then: [5], else: [3] }).result).toBe(3);
  });
  it("passes ANY value through unchanged — text, not just numbers", () => {
    expect(new IfNode().data({ cond: [true], then: ["yes"], else: ["no"] }).result).toBe("yes");
    expect(new IfNode().data({ cond: [0], then: ["yes"], else: ["no"] }).result).toBe("no");
  });
});

describe("Kleene three-valued logic — a null operand propagates only when it could change the answer", () => {
  it("a comparison with a null operand → null (per element)", () => {
    expect(new ComparisonNode({ op: "gt" }).data({ a: [[1, null, 3]], b: [2] }).result)
      .toEqual([false, null, true]);
  });
  it("AND: FALSE&null=FALSE, TRUE&null=null", () => {
    const n = new BooleanOpNode({ op: "and" });
    const [a, b] = n.valueInputKeys();
    expect(n.data({ [a]: [[1, 0, null]], [b]: [[null, null, null]] }).result)
      .toEqual([null, false, null]); // T&null=null, F&null=FALSE, null&null=null
  });
  it("OR: TRUE|null=TRUE, FALSE|null=null", () => {
    const n = new BooleanOpNode({ op: "or" });
    const [a, b] = n.valueInputKeys();
    expect(n.data({ [a]: [[1, 0]], [b]: [[null, null]] }).result)
      .toEqual([true, null]);
  });
  it("IF propagates a null condition", () => {
    expect(new IfNode().data({ cond: [[1, null]], then: [[5, 5]], else: [[3, 3]] }).result)
      .toEqual([5, null]);
  });
  it("ragged lists pad with null INTO the Kleene fn — absorbed where it can't change the answer", () => {
    const n = new BooleanOpNode({ op: "and" });
    const [a, b] = n.valueInputKeys();
    // e0 has both operands; e1's B is padded null: TRUE&null stays unknown
    expect(n.data({ [a]: [[1, 1]], [b]: [[1]] }).result).toEqual([true, null]);
    // FALSE absorbs the padded null: FALSE&null = FALSE, not null
    expect(n.data({ [a]: [[1, 0]], [b]: [[1]] }).result).toEqual([true, false]);
  });
});

import { IsTestNode } from "./logic";
import { solError } from "../errorValue";

describe("IS.TEST — per-cell to any depth (1-D and 2-D Any input)", () => {
  const run = (op: "isnumber" | "istext" | "islogical" | "iserror" | "isna") =>
    (v: unknown) => new IsTestNode({ op }).data({ value: [v] }).result;

  it("ISNUMBER over a 2-D table tests each cell (not its rows)", () => {
    expect(run("isnumber")([[1, "x"], [null, 4]])).toEqual([[true, false], [false, true]]);
  });

  it("ISTEXT over a mixed 1-D list answers per element", () => {
    expect(run("istext")(["a", 2, "c", null])).toEqual([true, false, true, false]);
  });

  it("ISLOGICAL is a pure type test — only real booleans, not 0/1 or \"TRUE\"", () => {
    expect(run("islogical")([true, false, 1, 0, "TRUE", "x"])).toEqual([true, true, false, false, false, false]);
  });

  it("ISERROR flags a per-cell SolError but NOT a per-cell null", () => {
    const err = solError("#DIV/0!", "x");
    expect(run("iserror")([1, err, null, 3])).toEqual([false, true, false, false]);
  });

  it("ISNA flags only a per-cell #N/A", () => {
    const na = solError("#N/A", "x");
    const div0 = solError("#DIV/0!", "x");
    expect(run("isna")([na, div0, 5])).toEqual([true, false, false]);
  });

  it("ISBLANK stays whole-input (a populated table is not blank)", () => {
    expect(new IsTestNode({ op: "isblank" }).data({ value: [[[1, null], [2, 3]]] }).result).toBe(false);
    expect(new IsTestNode({ op: "isblank" }).data({ value: [null] }).result).toBe(true);
  });
});

import { frameFromCells } from "../frame";

describe("IS.TEST on a Frame — per-cell over the table (not a single bool)", () => {
  // A mixed frame: a numeric column with a gap + a text column.
  const f = frameFromCells(["vals", "tag"], [[1, "a"], [null, "b"], [3, "c"]]);

  it("ISNULL flags each missing cell of the frame, row-major", () => {
    const r = new IsTestNode({ op: "isnull" }).data({ value: [f] }).result;
    // rows × cols = 3×2; only vals[1] is null.
    expect(r).toEqual([[false, false], [true, false], [false, false]]);
  });

  it("ISNUMBER tests each cell (numbers true, text/gap false)", () => {
    const r = new IsTestNode({ op: "isnumber" }).data({ value: [f] }).result;
    expect(r).toEqual([[true, false], [false, false], [true, false]]);
  });
});

import { ChooseNode } from "./logic";

describe("ChooseNode — extensible value rows, 1-based index", () => {
  it("picks the index-th value among the default four", () => {
    const n = new ChooseNode();
    n.literals = { index: 3, ...Object.fromEntries(n.valueInputKeys().map((k, i) => [k, (i + 1) * 10])) };
    expect(n.data({}).result).toBe(30); // 3rd value = 30
  });
  it("out-of-range index → null", () => {
    const n = new ChooseNode();
    n.literals.index = 99;
    expect(n.data({}).result).toBeNull();
  });
  it("added/removed rows shift which keys are selectable", () => {
    const n = new ChooseNode();
    for (const k of n.valueInputKeys()) n.removeValueInput(k);
    const a = n.addValueInput(), b = n.addValueInput();
    n.literals = { index: 2, [a]: 7, [b]: 9 };
    expect(n.data({}).result).toBe(9);
    expect(n.valueInputKeys()).toEqual([a, b]);
  });
  it("rebuilds the exact value keys from valueKeys (persistence), ignoring index", () => {
    const n = new ChooseNode({ valueKeys: ["index", "v0", "v1", "v2"] });
    expect(n.valueInputKeys()).toEqual(["v0", "v1", "v2"]);
    expect("index" in n.inputs).toBe(true);
  });
});

import { IfsNode } from "./logic";

describe("IfsNode — extensible condition/value pairs", () => {
  it("returns the first value whose condition is non-zero (defaults)", () => {
    // fresh node: cond0=1 (true) → val0=10
    expect(new IfsNode().data({}).result).toBe(10);
  });
  it("falls through to the first true condition", () => {
    const n = new IfsNode();
    n.literals = { cond0: 0, val0: 10, cond1: 1, val1: 20, cond2: 0, val2: 30 };
    expect(n.data({}).result).toBe(20);
  });
  it("no condition true → null when Otherwise is unset", () => {
    const n = new IfsNode();
    n.literals = { cond0: 0, val0: 10, cond1: 0, val1: 20, cond2: 0, val2: 30 };
    expect(n.data({}).result).toBeNull();
  });
  it("no condition true → the Otherwise fallback when set", () => {
    const n = new IfsNode();
    n.literals = { cond0: 0, val0: 10, cond1: 0, val1: 20, cond2: 0, val2: 30, otherwise: 42 };
    expect(n.data({}).result).toBe(42);
    expect("otherwise" in n.inputs).toBe(true);
  });
  it("added pairs extend the chain", () => {
    const n = new IfsNode();
    n.addValuePair(); // cond3/val3
    const keys = n.valuePairKeys();
    expect(keys.length).toBe(4);
    n.literals = { cond0: 0, val0: 1, cond1: 0, val1: 2, cond2: 0, val2: 3, cond3: 1, val3: 99 };
    expect(n.data({}).result).toBe(99);
  });
  it("removeValuePair drops both keys of the pair", () => {
    const n = new IfsNode();
    n.removeValuePair("cond1");
    expect(n.valuePairKeys().map(([a]) => a)).toEqual(["cond0", "cond2"]);
    expect("val1" in n.inputs).toBe(false);
  });
  it("rebuilds the exact pair keys from valueKeys (persistence)", () => {
    const n = new IfsNode({ valueKeys: ["cond0", "val0", "cond2", "val2"] });
    expect(n.valuePairKeys()).toEqual([["cond0", "val0"], ["cond2", "val2"]]);
  });
});

import { SwitchNode } from "./logic";

describe("SwitchNode — fixed expr/default + extensible when/then pairs", () => {
  it("returns the Then of the first matching When (defaults)", () => {
    const n = new SwitchNode();
    expect(n.data({ expr: [2] }).result).toBe(20);
  });
  it("no match → default", () => {
    const n = new SwitchNode();
    n.literals.default = 7;
    expect(n.data({ expr: [99] }).result).toBe(7);
  });
  it("added pairs extend the cases", () => {
    const n = new SwitchNode();
    n.addValuePair(); // when3/then3
    const [w, t] = n.valuePairKeys()[3];
    n.literals[w] = 5; n.literals[t] = 500;
    expect(n.data({ expr: [5] }).result).toBe(500);
  });
  it("removeValuePair drops both keys; expr/default untouched", () => {
    const n = new SwitchNode();
    n.removeValuePair("when1");
    expect(n.valuePairKeys().map(([a]) => a)).toEqual(["when0", "when2"]);
    expect("expr" in n.inputs && "default" in n.inputs).toBe(true);
  });
  it("rebuilds pair keys from valueKeys, keeping expr/default fixed", () => {
    const n = new SwitchNode({ valueKeys: ["expr", "when0", "then0", "when2", "then2", "default"] });
    expect(n.valuePairKeys()).toEqual([["when0", "then0"], ["when2", "then2"]]);
    expect("expr" in n.inputs && "default" in n.inputs).toBe(true);
  });
});

import { IFErrorNode, NaNode } from "./logic";
import { isSolError } from "../errorValue";

describe("value-selectors carry ANY value through (logical conditions, text values)", () => {
  it("IFS: a REAL boolean condition picks its paired text value", () => {
    const n = new IfsNode({ valueKeys: ["cond0", "val0", "cond1", "val1"] });
    // false then true → second pair's value, passed through unchanged (text).
    expect(n.data({ cond0: [false], val0: ["a"], cond1: [true], val1: ["b"] }).result).toBe("b");
    // none true → Otherwise (here a text fallback).
    expect(n.data({ cond0: [false], val0: ["a"], cond1: [false], val1: ["b"], otherwise: ["z"] }).result).toBe("z");
  });
  it("SWITCH matches text expressions and returns any value type", () => {
    const n = new SwitchNode({ valueKeys: ["expr", "when0", "then0", "when1", "then1", "default"] });
    expect(n.data({ expr: ["b"], when0: ["a"], then0: [1], when1: ["b"], then1: ["hit"], default: ["d"] }).result).toBe("hit");
    expect(n.data({ expr: ["x"], when0: ["a"], then0: [1], when1: ["b"], then1: ["hit"], default: ["d"] }).result).toBe("d");
  });
  it("CHOOSE passes the selected text value through", () => {
    const n = new ChooseNode({ valueKeys: ["index", "v0", "v1"] });
    expect(n.data({ index: [2], v0: ["x"], v1: ["y"] }).result).toBe("y");
  });
  it("IFERROR swaps a caught error for the fallback but passes any non-error through", () => {
    const n = new IFErrorNode({ mode: "iferror" });
    expect(n.data({ value: [solError("#DIV/0!", "")], fallback: ["safe"] }).result).toBe("safe");
    expect(n.data({ value: ["hello"], fallback: ["safe"] }).result).toBe("hello");
  });
});

describe("NA node emits the tagged #N/A (audit finding 13)", () => {
  it("outputs a SolError with code #N/A that ISNA/IFNA can catch", () => {
    const out = new NaNode().data().result;
    if (!isSolError(out)) throw new Error("expected SolError");
    expect(out.code).toBe("#N/A");
    // the advertised catch actually works
    const isna = new IsTestNode({ op: "isna" }).data({ value: [out] }).result;
    expect(isna).toBe(true);
    const caught = new IFErrorNode({ mode: "ifna" }).data({ value: [out], fallback: [42] }).result;
    expect(caught).toBe(42);
  });
});
