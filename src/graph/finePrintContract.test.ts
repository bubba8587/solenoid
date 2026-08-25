import { describe, expect, it } from "vitest";
import { TextJoinNode } from "./nodes/text";
import { XMatchNode } from "./nodes/list";
import { TakeDropNode } from "./nodes/matrix";
import { BaseConvertNode } from "./nodes/scalar";
import { GetRowNode } from "./nodes/frame";
import { sliceList } from "./nodes/listOps";
import { dropBlankRows, mergeColumns } from "./frameVerbs";
import { isNaError, isSolError, solError } from "./errorValue";
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
  it("ignore (the node default, matching the formula surface) drops empty strings; include keeps them", () => {
    const ignore = new TextJoinNode();
    expect(ignore.data({ strings: [["a", "", "b"]], delimiter: [","] }).result).toBe("a,b");
    const include = new TextJoinNode({ ignoreEmpty: "include" });
    expect(include.data({ strings: [["a", "", "b"]], delimiter: [","] }).result).toBe("a,,b");
  });
});

describe("DROP — the last-N direction is a negative count", () => {
  it("removes the last N elements", () => {
    const node = new TakeDropNode({ op: "drop" });
    node.literals.rows = -2; // sign is the direction: drop the last two
    expect(node.data({ data: [[1, 2, 3, 4]] }).result).toEqual([1, 2]);
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
  const runSearch = (value: number, array: number[], searchMode: "first" | "last") => {
    const node = new XMatchNode({ searchMode });
    node.literals.value = value;
    return node.data({ array: [array] }).result;
  };
  it("search mode picks WHICH duplicate — the frame XLOOKUP's argument, same meaning", () => {
    expect(runSearch(7, [5, 7, 7], "first")).toBe(2);
    expect(runSearch(7, [5, 7, 7], "last")).toBe(3);
  });
  it("search mode defaults to first (unset = Excel's search_mode 1)", () => {
    expect(new XMatchNode().searchMode).toBe("first");
  });
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
  // The sockets are wildcard because the kernel is type-agnostic: text was locked
  // out only by the old numeric plugs while =XMATCH("a", …) already worked.
  it("matches text, case-insensitively (Excel's lookup equality)", () => {
    const node = new XMatchNode();
    expect(node.data({ value: ["fw-403"], array: [["HB-401", "LN-402", "FW-403"]] }).result).toBe(3);
  });
  it("an unwired TEXT literal reads from the wildcard slot's string map", () => {
    const node = new XMatchNode();
    node.stringLiterals.value = "LN-402";
    expect(node.data({ array: [["HB-401", "LN-402"]] }).result).toBe(2);
  });
  it("approximate match on a text lookup is the kernel's targeted #VALUE!", () => {
    const node = new XMatchNode({ matchMode: "next_larger" });
    const r = node.data({ value: ["x"], array: [["a", "b"]] }).result;
    expect(isSolError(r) ? r.code : r).toBe("#VALUE!");
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
