// [[C17]]
import { describe, it, expect } from "vitest";
import {
  ExactNode, TextTransformNode, TextLenNode,
  TextSliceNode, 
  
  TextJoinNode,
  TextSplitNode, ConcatNode,
} from "../../../src/graph/nodes/text";
import { isSolError, solError } from "../../../src/graph/errorValue";
import { CastNode } from "../../../src/graph/nodes/cast";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { SolenoidSocket, canConnect } from "../../../src/graph/sockets";

describe("NUMBERVALUE — strict full-string parse", () => {
  const nv = (text: string, decimal_sep?: string, group_sep?: string) =>
    compileEvaluator(`NUMBERVALUE(${[text, decimal_sep, group_sep].filter((a) => a !== undefined).map((a) => JSON.stringify(a)).join(",")})`)!({});

  it("a trailing non-numeric char is #VALUE! (not parseFloat's greedy 12)", () => {
    const r = nv("12x");
    expect(isSolError(r) && r.code).toBe("#VALUE!");
  });
  it("trailing % signs each divide by 100", () => {
    expect(nv("12%")).toBe(0.12);
    expect(nv("12%%")).toBe(0.0012);
  });
  it("all whitespace is ignored, including embedded", () => {
    expect(nv("1 234")).toBe(1234);
  });
  it("swapped separators parse", () => {
    expect(nv("1.234,56", ",", ".")).toBe(1234.56);
  });
  it("blank is 0, as in Excel; a plain number parses", () => {
    expect(nv("")).toBe(0);
    expect(nv("42")).toBe(42);
  });
});

// [[B11]] maximalMerge: Cast to Number is VALUE's reading, with NUMBERVALUE's separators on the card.
describe("Cast to Number reads as VALUE does, with the separators it is given", () => {
  const cast = (text: string, decimal_sep?: string, group_sep?: string) => {
    const n = new CastNode({ target: "number" });
    if (decimal_sep !== undefined) n.stringLiterals.decimal_sep = decimal_sep;
    if (group_sep !== undefined) n.stringLiterals.group_sep = group_sep;
    return n.data({ value: [text] }).result;
  };
  it("with blank separators it answers as VALUE, case by case ([[C17]] shareImpl)", () => {
    for (const text of ["42", "12%", "$1,234.5", "(5)", "12x", "1,234", "1.2.3"]) {
      const formula = compileEvaluator(`VALUE(${JSON.stringify(text)})`)!({});
      const card = cast(text);
      if (isSolError(formula)) expect(isSolError(card) && card.code, text).toBe(formula.code);
      else expect(card, text).toBe(formula);
    }
  });
  it("a separator reads other conventions and keeps VALUE's $, % and (5)", () => {
    expect(cast("1.234,56", ",", ".")).toBe(1234.56);
    expect(cast("$1.234,5", ",", ".")).toBe(1234.5);
    expect(cast("(3,5)", ",")).toBe(-3.5);
    expect(cast("3,5%", ",")).toBe(0.035);
    expect(isSolError(cast("1,5", ",", ","))).toBe(true);
  });
  it("Format and the separators exist only on the target that reads them, and a switch keeps the other target's text", () => {
    const n = new CastNode({ target: "text" });
    expect(Object.keys(n.inputs)).toEqual(["value", "format"]);
    n.stringLiterals.format = "0.00%";
    expect(n.data({ value: [0.1234] }).result).toBe("12.34%");
    expect(n.keysDroppedBySwitch("number")).toEqual(["format"]);
    n.setTarget("number");
    expect(Object.keys(n.inputs)).toEqual(["value", "decimal_sep", "group_sep"]);
    n.setTarget("date");
    expect(Object.keys(n.inputs)).toEqual(["value"]);
  });
});

// EXACT emits the first-class logical type (TRUE/FALSE), like Comparison / IS checks —
// not 1/0. FIND/SEARCH report a missing substring as #VALUE! (Excel + the formula path),
// not #N/A. Both were aligned during the formula-engine consolidation (2026-06-25).

describe("EXACT — logical output", () => {
  it("declares a logical output socket — the combo rung, since it broadcasts", () => {
    const socket = new ExactNode().outputs.result!.socket;
    expect(socket instanceof SolenoidSocket && socket.dataType).toBe("logicalcombo");
    // A combo can be a scalar, so it still reaches everywhere a bare `logical` did,
    // the logical↔number bridge included (sockets.ts `dimFlows`).
    expect(canConnect("logicalcombo", "logical")).toBe(true);
    expect(canConnect("logicalcombo", "number")).toBe(true);
    expect(canConnect("logicalcombo", "logicallist")).toBe(true);
  });
});


// ─── Text nodes are element-wise (the 2026-07-25 combo pass) ──────────────────
// The text family used rigid scalar sockets while the number and date families
// already took scalar-or-list. Every element-wise text node now declares
// `strcombo`/`numlist` and broadcasts, so a list of strings flows through
// UPPER/LEFT/SUBSTITUTE/REPLACE/… the way a list of numbers flows through ADD —
// Excel's array-formula behavior (`=UPPER(A1:A10)` spills).
describe("text nodes broadcast over lists (scalar-or-list combo sockets)", () => {
  const dt = (n: { inputs: Record<string, { socket: unknown } | undefined>; outputs: Record<string, { socket: unknown } | undefined> }, side: "in" | "out", k: string) => {
    const s = side === "in" ? n.inputs[k]?.socket : n.outputs[k]?.socket;
    return s instanceof SolenoidSocket ? s.dataType : undefined;
  };









  it("declares combo sockets on the operands, scalar on the MODE inputs", () => {
    expect(dt(new TextTransformNode(), "in", "text")).toBe("strcombo");
    expect(dt(new TextTransformNode(), "out", "result")).toBe("strcombo");
    expect(dt(new TextLenNode(), "out", "result")).toBe("numlist");
    expect(dt(new TextSliceNode(), "in", "n")).toBe("numlist");
    // NUMBERVALUE's separators pick a parsing CONVENTION, not a per-element operand.
    const nv = new CastNode({ target: "number" });
    expect(dt(nv, "in", "decimal_sep")).toBe("string");
    expect(dt(nv, "in", "group_sep")).toBe("string");
  });

  it("the REDUCERS and rank-changers stay as they were", () => {
    // CONCAT / TEXTJOIN fold a set to ONE string (Excel's CONCAT flattens an array
    // rather than spilling); TEXTSPLIT and Text Filter are already 1-D → 1-D, and
    // broadcasting either would need a rank-2 result the lattice has no edge for.
    expect(dt(new TextJoinNode(), "in", "strings")).toBe("strlist");
    expect(dt(new TextJoinNode(), "out", "result")).toBe("string");
    expect(dt(new ConcatNode(), "in", "v0")).toBe("string");
    expect(dt(new TextSplitNode(), "in", "text")).toBe("string");
    expect(dt(new TextSplitNode(), "out", "result")).toBe("strlist");
    expect(new TextJoinNode().data({ strings: [["a", "b"]], delimiter: ["-"] }).result).toBe("a-b");
    expect(new TextSplitNode().data({ text: ["a-b"], delimiter: ["-"] }).result).toEqual(["a", "b"]);
  });

  it("TEXTJOIN answers like the formula: blanks drop, logicals read TRUE, an error wins ([[C17]] shareImpl)", () => {
    const fx = (ign: string, xs: unknown[]) => compileEvaluator(`TEXTJOIN(",", ${ign}, x)`)!({ x: xs });
    const cases: unknown[][] = [["a", null, "b"], ["a", "", "b"], ["a", 1, true], ["a", solError("#N/A", "gone"), "b"]];
    for (const ign of ["ignore", "include"] as const) {
      for (const xs of cases) {
        const node = new TextJoinNode({ ignoreEmpty: ign }).data({ strings: [xs as string[]], delimiter: [","] }).result;
        expect(node, `${ign} ${JSON.stringify(xs)}`).toEqual(fx(ign === "ignore" ? "TRUE" : "FALSE", xs));
      }
    }
  });

  it("strcombo is a pure widening — it wires everywhere `string` did", () => {
    for (const target of ["string", "strlist", "strtable", "frame", "cube", "any", "anylist", "trueany"] as const) {
      expect(canConnect("strcombo", target)).toBe(true);
    }
    for (const source of ["string", "strlist", "any", "anylist", "trueany"] as const) {
      expect(canConnect(source, "strcombo")).toBe(true);
    }
    // Still no cross-family leak, and a 2-D value still can't narrow into it.
    expect(canConnect("strcombo", "number")).toBe(false);
    expect(canConnect("strtable", "strcombo")).toBe(false);
  });
});
