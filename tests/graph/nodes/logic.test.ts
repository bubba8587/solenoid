// [[C24]]
import { describe, it, expect } from "vitest";


// Comparisons now emit a real logical (P7): TRUE/FALSE, not 1/0. Downstream
// numeric consumers coerce boolean→1/0 at the socket (coerceInputs), so the
// classic multiply-by-a-condition trick still works — that path is exercised
// by the integration/seeds suites.

// Unit-aware: comparisons run on BASE-SI magnitudes, and commensurability is
// enforced (different currencies / dimensions never compare equal). See unitValue.

import { BooleanOpNode, IfNode } from "../../../src/graph/nodes/logic";

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
});


import { IsTestNode } from "../../../src/graph/nodes/logic";
import { solError } from "../../../src/graph/errorValue";

describe("IS.TEST — per-cell to any depth (1-D and 2-D Any input)", () => {
  const run = (op: "isnumber" | "istext" | "islogical" | "iserror" | "iserr" | "isna") =>
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

  // [[D73]] nodeCoversFormula: ISERR is current Excel, so the card carries it beside ISERROR.

});




import { ChooseNode } from "../../../src/graph/nodes/logic";

describe("ChooseNode — extensible value rows, 1-based index", () => {
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

import { IfsNode } from "../../../src/graph/nodes/logic";

describe("IfsNode — extensible condition/value pairs", () => {
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

import { SwitchNode } from "../../../src/graph/nodes/logic";

describe("SwitchNode — fixed expr/default + extensible when/then pairs", () => {
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
  it("a rebuilt card with no saved literals has an unset Default, like a fresh one", () => {
    const n = new SwitchNode({ valueKeys: ["expr", "when0", "then0", "default"] });
    const r = n.data({ expr: [99], when0: [1], then0: [10] }).result;
    expect(isSolError(r) && (r as { code: string }).code).toBe("#N/A");
  });
});

// The slots are WILDCARD sockets, so a typed literal can be text as well as a number —
// it just lands in the other map. The inline field writes exactly one of the two.
describe("value selectors take TEXT literals on their wildcard slots", () => {
  it("removeValuePair drops the pair's TEXT literals too", () => {
    const n = new SwitchNode();
    n.stringLiterals = { when1: "x", then1: "y", when2: "keep" };
    n.removeValuePair("when1");
    expect(n.stringLiterals).toEqual({ when2: "keep" });
  });
});

import { isSolError } from "../../../src/graph/errorValue";

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
});

