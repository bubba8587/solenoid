import { describe, expect, it } from "vitest";
import { TextJoinNode } from "./nodes/text";
import { DropNode, XMatchNode } from "./nodes/list";
import { BaseConvertNode } from "./nodes/scalar";
import { GetRowNode } from "./nodes/frame";
import { sliceList } from "./nodes/listOps";
import { dropBlankRows, mergeColumns } from "./frameVerbs";
import { isNaError, solError } from "./errorValue";
import type { FrameValue } from "./frame";

// Round 2 of the description fine-print sweep (2026-08-08): claims that lived
// only in catalog description strings, verified against the code and pinned
// here. GetRow, Base Convert, and XMATCH's match-mode family previously had no
// test coverage at all.

const frame = (cols: [string, "string" | "number", (string | number | null | ReturnType<typeof solError>)[]][]): FrameValue => ({
  __frame: true,
  columns: cols.map(([name, type, values]) => ({ name, type, values })),
});

describe("TEXTJOIN — the ignore-empty mode", () => {
  it("ignore drops empty strings; include (the node default) keeps them", () => {
    const ignore = new TextJoinNode({ ignoreEmpty: "ignore" });
    expect(ignore.data({ strings: [["a", "", "b"]], delimiter: [","] }).result).toBe("a,b");
    const include = new TextJoinNode();
    expect(include.data({ strings: [["a", "", "b"]], delimiter: [","] }).result).toBe("a,,b");
  });
});

describe("DROP — the last-N direction", () => {
  it("removes the last N elements", () => {
    const node = new DropNode({ op: "last" });
    node.literals.count = 2;
    expect(node.data({ list: [[1, 2, 3, 4]] }).result).toEqual([1, 2]);
  });
});

describe("Base Convert — the per-digit 0–9 rule", () => {
  const run = (value: number, from: number, to: number) => {
    const node = new BaseConvertNode();
    node.literals = { value, from, to };
    return node.data({}).result;
  };
  it("converts between digit-representable bases", () => {
    expect(run(1010, 2, 10)).toBe(10);
    expect(run(255, 10, 8)).toBe(377);
  });
  it("a base above 10 works when every digit stays 0–9", () => {
    expect(run(1010, 16, 10)).toBe(4112);
  });
  it("a digit outside the source base is null", () => {
    expect(run(222, 2, 10)).toBeNull();
  });
  it("a result needing a letter digit is null", () => {
    expect(run(255, 10, 16)).toBeNull();
  });
});

describe("XMATCH — the match-mode family (first match wins)", () => {
  const run = (value: number, array: number[], matchMode?: "exact" | "next_larger" | "next_smaller") => {
    const node = new XMatchNode(matchMode ? { matchMode } : undefined);
    node.literals.value = value;
    return node.data({ array: [array] }).result;
  };
  it("exact returns the FIRST duplicate's 1-based position", () => {
    expect(run(7, [5, 7, 7])).toBe(2);
  });
  it("next larger: the smallest value ≥ lookup, first such index", () => {
    expect(run(6, [5, 7, 9, 7], "next_larger")).toBe(2);
  });
  it("next smaller: the largest value ≤ lookup", () => {
    expect(run(8, [5, 7, 9], "next_smaller")).toBe(2);
  });
  it("no candidate on a wired array is #N/A", () => {
    expect(isNaError(run(10, [5, 7], "next_larger"))).toBe(true);
  });
});

describe("Get Row — 1-based row pick", () => {
  const f = frame([["a", "string", ["x", "y", "z"]], ["n", "number", [1, 2, 3]]]);
  it("picks the 1-based row as a one-row frame", () => {
    const out = new GetRowNode().data({ frame: [f], index: [2] }).frame;
    expect(out?.columns.map((c) => c.values)).toEqual([["y"], [2]]);
  });
  it("out-of-range (0 or past the end) is blank", () => {
    expect(new GetRowNode().data({ frame: [f], index: [0] }).frame).toBeNull();
    expect(new GetRowNode().data({ frame: [f], index: [4] }).frame).toBeNull();
  });
});

describe("Slice — 1-based INCLUSIVE end", () => {
  it("start 2 to end 3 keeps two elements", () => {
    expect(sliceList([10, 20, 30, 40], 2, 3)).toEqual([20, 30]);
  });
});

describe("Merge Columns — a blank cell contributes ''", () => {
  it("null merges as the empty string", () => {
    const f = frame([["a", "string", ["x", null]], ["b", "string", ["1", "2"]]]);
    const out = mergeColumns(f, ["a", "b"], "-", "m");
    expect(out.columns[0].values).toEqual(["x-1", "-2"]);
  });
});

describe("Drop Blank Rows — an error is a value, not a blank", () => {
  it("a row whose only content is an error survives 'all' mode", () => {
    const f = frame([["a", "number", [1, null, solError("#DIV/0!", "x")]]]);
    const out = dropBlankRows(f, "all");
    expect(out.columns[0].values.length).toBe(2);
  });
});
