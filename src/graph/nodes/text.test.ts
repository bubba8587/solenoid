import { describe, it, expect } from "vitest";
import {
  ExactNode, TextFindNode, NumberValueNode, TextTransformNode, TextLenNode,
  TextSliceNode, SubstituteNode, TextReplaceNode, ReptNode, CharCodeNode,
  TextAfterBeforeNode, UrlEncodeNode, RomanArabicNode, FixedNode,
  FormatDollarNode, ReverseTextNode, SpellNumberNode, TextJoinNode,
  TextSplitNode, TextFilterNode, ConcatNode,
} from "./text";
import { isSolError } from "../errorValue";
import { SolenoidSocket, canConnect } from "../sockets";

describe("NUMBERVALUE — strict full-string parse", () => {
  const nv = (text: string, decimal_sep?: string, group_sep?: string) =>
    new NumberValueNode().data({
      text: [text],
      ...(decimal_sep !== undefined ? { decimal_sep: [decimal_sep] } : {}),
      ...(group_sep !== undefined ? { group_sep: [group_sep] } : {}),
    }).result;

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
  it("blank is null; a plain number parses", () => {
    expect(nv("")).toBe(null);
    expect(nv("42")).toBe(42);
  });
});

// EXACT emits the first-class logical type (TRUE/FALSE), like Comparison / IS checks —
// not 1/0. FIND/SEARCH report a missing substring as #VALUE! (Excel + the formula path),
// not #N/A. Both were aligned during the formula-engine consolidation (2026-06-25).

describe("EXACT — logical output", () => {
  it("returns a real boolean", () => {
    expect(new ExactNode().data({ a: ["abc"], b: ["abc"] }).result).toBe(true);
    expect(new ExactNode().data({ a: ["abc"], b: ["abd"] }).result).toBe(false);
    expect(new ExactNode().data({ a: ["Abc"], b: ["abc"] }).result).toBe(false); // case-sensitive
  });
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

describe("FIND / SEARCH — missing substring is #VALUE!", () => {
  it("FIND finds (1-based) and errors #VALUE! when absent", () => {
    expect(new TextFindNode({ op: "find" }).data({ needle: ["l"], haystack: ["hello"], start: [1] }).result).toBe(3);
    const miss = new TextFindNode({ op: "find" }).data({ needle: ["z"], haystack: ["hello"], start: [1] }).result;
    expect(isSolError(miss) && miss.code).toBe("#VALUE!");
  });
  it("SEARCH is case-insensitive; #VALUE! when absent", () => {
    expect(new TextFindNode({ op: "search" }).data({ needle: ["L"], haystack: ["hello"], start: [1] }).result).toBe(3);
    const miss = new TextFindNode({ op: "search" }).data({ needle: ["z"], haystack: ["hello"], start: [1] }).result;
    expect(isSolError(miss) && miss.code).toBe("#VALUE!");
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

  it("a scalar operand still yields a SCALAR — the widening is additive", () => {
    expect(new TextTransformNode({ op: "upper" }).data({ text: ["abc"] }).result).toBe("ABC");
    expect(new TextLenNode().data({ text: ["hello"] }).result).toBe(5);
    expect(new TextSliceNode({ op: "left" }).data({ text: ["hello"], n: [2] }).result).toBe("he");
    expect(new SubstituteNode().data({ text: ["a-b"], old_text: ["-"], new_text: ["+"] }).result).toBe("a+b");
    expect(new ReverseTextNode().data({ text: ["abc"] }).result).toBe("cba");
  });

  it("a LIST operand yields a list, element-wise", () => {
    expect(new TextTransformNode({ op: "upper" }).data({ text: [["a", "b"]] }).result).toEqual(["A", "B"]);
    expect(new TextTransformNode({ op: "trim" }).data({ text: [[" a ", " b"]] }).result).toEqual(["a", "b"]);
    expect(new TextLenNode().data({ text: [["a", "bcd"]] }).result).toEqual([1, 3]);
    expect(new ReverseTextNode().data({ text: [["ab", "cd"]] }).result).toEqual(["ba", "dc"]);
    expect(new UrlEncodeNode({ op: "encode" }).data({ text: [["a b", "c&d"]] }).result).toEqual(["a%20b", "c%26d"]);
    expect(new ExactNode().data({ a: [["a", "b"]], b: ["a"] }).result).toEqual([true, false]);
  });

  it("mixed text + numeric operands zip together by position", () => {
    // LEFT over a list of strings with a per-element count (Excel: =LEFT(A1:A2,B1:B2)).
    expect(new TextSliceNode({ op: "left" }).data({ text: [["hello", "world"]], n: [[2, 3]] }).result)
      .toEqual(["he", "wor"]);
    // MID reads start/len; a list left in the unused `n` box must NOT spill the result.
    expect(new TextSliceNode({ op: "mid" }).data({ text: ["hello"], start: [2], len: [3], n: [[9, 9]] }).result)
      .toBe("ell");
    expect(new ReptNode().data({ text: ["ab"], times: [[1, 2]] }).result).toEqual(["ab", "abab"]);
    expect(new TextReplaceNode().data({ text: [["abcd", "wxyz"]], start: [2], num_chars: [2], new_text: ["-"] }).result)
      .toEqual(["a-d", "w-z"]);
    expect(new FixedNode().data({ number: [[1234.5, 2]], decimals: [1] }).result).toEqual(["1,234.5", "2.0"]);
    expect(new FormatDollarNode().data({ number: [[1.5, -2]], decimals: [2] }).result).toEqual(["$1.50", "-$2.00"]);
  });

  it("FIXED/DOLLAR round LEFT of the point on a negative decimals count (Excel)", () => {
    // Values cross-checked against @formulajs/formulajs (our Excel oracle):
    // =FIXED(12345.678, -2) = "12,300", =DOLLAR(12345.678, -2) = "$12,300".
    expect(new FixedNode().data({ number: [12345.678], decimals: [-2] }).result).toBe("12,300");
    expect(new FormatDollarNode().data({ number: [12345.678], decimals: [-2] }).result).toBe("$12,300");
    // Sign is preserved through the left-rounding. FIXED matches Excel; DOLLAR keeps our
    // leading-minus convention (Excel/Formula.js use accounting parens "$(12,300)") — a
    // pre-existing, separately-pinned choice, not part of the decimals fix.
    expect(new FixedNode().data({ number: [-12345.678], decimals: [-2] }).result).toBe("-12,300");
    expect(new FormatDollarNode().data({ number: [-12345.678], decimals: [-2] }).result).toBe("-$12,300");
    expect(new SpellNumberNode().data({ value: [[1, 2]] }).result).toEqual(["one", "two"]);
  });

  it("a two-way node broadcasts in BOTH of its op directions", () => {
    expect(new CharCodeNode({ op: "char" }).data({ code: [[65, 66]] }).result).toEqual(["A", "B"]);
    expect(new CharCodeNode({ op: "code" }).data({ text: [["A", "B"]] }).result).toEqual([65, 66]);
    expect(new RomanArabicNode({ op: "roman" }).data({ number: [[4, 9]] }).result).toEqual(["IV", "IX"]);
    expect(new RomanArabicNode({ op: "arabic" }).data({ text: [["IV", "IX"]] }).result).toEqual([4, 9]);
  });

  it("per-cell errors and nulls follow the broadcast contract", () => {
    // One unmatched needle errors THAT cell only, not the whole list.
    const found = new TextFindNode({ op: "find" }).data({ needle: ["l"], haystack: [["hello", "abc"]] }).result as unknown[];
    expect(found[0]).toBe(3);
    expect(isSolError(found[1])).toBe(true);
    // One unparseable string errors alone; a blank stays a blank.
    const nums = new NumberValueNode().data({ text: [["42", "12x", ""]] }).result as unknown[];
    expect(nums[0]).toBe(42);
    expect(isSolError(nums[1]) && (nums[1] as { code: string }).code).toBe("#VALUE!");
    expect(nums[2]).toBeNull();
    // A delimiter this element doesn't contain is a per-cell blank.
    expect(new TextAfterBeforeNode({ op: "after" }).data({ text: [["a-b", "cd"]], delimiter: ["-"] }).result)
      .toEqual(["b", null]);
    // A wired MISSING short-circuits per cell.
    expect((new TextTransformNode({ op: "upper" }).data({ text: [["a", null as never]] }).result as unknown[])[1])
      .toBeNull();
    // ROMAN's out-of-range guard is per cell too.
    const rom = new RomanArabicNode({ op: "roman" }).data({ number: [[4, 5000]] }).result as unknown[];
    expect(rom[0]).toBe("IV");
    expect(isSolError(rom[1])).toBe(true);
  });

  it("ragged lists pad to the LONGEST with a missing cell", () => {
    expect(new SubstituteNode().data({ text: [["a-b", "c-d"]], old_text: [["-"]], new_text: ["+"] }).result)
      .toEqual(["a+b", null]);
  });

  it("SUBSTITUTE instance: blank/0 replaces all, n replaces only the nth (Excel)", () => {
    const sub = new SubstituteNode();
    // instance unwired → literal default 0 → every occurrence
    expect(sub.data({ text: ["a-b-c"], old_text: ["-"], new_text: ["+"] }).result).toBe("a+b+c");
    expect(sub.data({ text: ["a-b-c"], old_text: ["-"], new_text: ["+"], instance: [0] }).result).toBe("a+b+c");
    // instance 2 → only the second dash
    expect(sub.data({ text: ["a-b-c"], old_text: ["-"], new_text: ["+"], instance: [2] }).result).toBe("a-b+c");
    // instance broadcasts element-wise over a text list; an instance past the last
    // occurrence leaves the cell unchanged, like Excel
    expect(sub.data({ text: [["a-b-c", "x-y-z"]], old_text: ["-"], new_text: ["+"], instance: [[1, 2]] }).result)
      .toEqual(["a+b-c", "x-y+z"]);
    expect(sub.data({ text: ["x-y-z"], old_text: ["-"], new_text: ["+"], instance: [3] }).result).toBe("x-y-z");
  });

  it("declares combo sockets on the operands, scalar on the MODE inputs", () => {
    expect(dt(new TextTransformNode(), "in", "text")).toBe("strcombo");
    expect(dt(new TextTransformNode(), "out", "result")).toBe("strcombo");
    expect(dt(new TextLenNode(), "out", "result")).toBe("numlist");
    expect(dt(new TextSliceNode(), "in", "n")).toBe("numlist");
    // NUMBERVALUE's separators pick a parsing CONVENTION, not a per-element operand.
    const nv = new NumberValueNode();
    expect(dt(nv, "in", "text")).toBe("strcombo");
    expect(dt(nv, "in", "decimal_sep")).toBe("string");
    expect(dt(nv, "in", "group_sep")).toBe("string");
    // Text Filter's pattern is a predicate over the whole set, so it stays scalar.
    expect(dt(new TextFilterNode(), "in", "pattern")).toBe("string");
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
