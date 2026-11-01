// [[B11]], [[C48]], [[C49]]
import { describe, expect, it } from "vitest";

import { XMatchNode } from "../../src/graph/nodes/list";

import { BaseConvertNode } from "../../src/graph/nodes/scalar";

import { dropBlankRows, mergeColumns } from "./coreVerbs";
import { isSolError, solError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";

// Round 2 of the description fine-print sweep (2026-08-08): claims that lived
// only in catalog description strings, verified against the code and pinned
// here. GetRow, Base Convert, and XMATCH's match-mode family previously had no
// test coverage at all.

const frame = (cols: [string, "string" | "number", (string | number | null | ReturnType<typeof solError>)[]][]): FrameValue => ({
  __frame: true,
  columns: cols.map(([name, type, values]) => ({ name, type, values })),
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
    const r = run(10, [5, 7], "next_larger");
    expect(isSolError(r) && r.code).toBe("#N/A");
  });
  // The sockets are wildcard because the kernel is type-agnostic: text was locked
  // out only by the old numeric plugs while =XMATCH("a", …) already worked.
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
