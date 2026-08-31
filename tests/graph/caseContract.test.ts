import { describe, expect, it } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import {
  distinctRows, filterRows, groupByFrame, joinFrames, passesFilter, replaceValues,
} from "../../src/graph/frameVerbs";
import type { FrameValue } from "../../src/graph/frame";

// excelComparisons pinned in ONE place: every COMPARISON is case-INsensitive (Excel's `=`;
// "Match case" / EXACT is the escape hatch), every IDENTITY op (join, group,
// distinct keys) is case-SENSITIVE. These semantics previously lived only in
// catalog description strings, where nothing failed if a surface drifted off the line.

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);

const frame = (name: string, values: (string | number | null)[]): FrameValue => ({
  __frame: true,
  columns: [{ name, type: "string", values }],
});

describe("comparisons ignore case", () => {
  it("formula `=` and `<>`", () => {
    expect(ev('"a" = "A"')).toBe(true);
    expect(ev('"a" <> "A"')).toBe(false);
  });

  it("EXACT is the case-sensitive escape hatch", () => {
    expect(ev('EXACT("a", "A")')).toBe(false);
    expect(ev('EXACT("a", "a")')).toBe(true);
  });

  it("frame Filter text ops fold case; matchCase restores sensitivity", () => {
    for (const [op, value, hit] of [
      ["eq", "ALPHA", true],
      ["contains", "LPH", true],
      ["startsWith", "AL", true],
      ["endsWith", "HA", true],
    ] as const) {
      expect(passesFilter("alpha", op, value, "string", false), op).toBe(hit);
      expect(passesFilter("alpha", op, value, "string", true), `${op} matchCase`).toBe(false);
    }
  });

  it("frame filterRows defaults insensitive end to end", () => {
    const out = filterRows(frame("c", ["us", "US", "eu"]), "c", "eq", "US", false);
    expect(out.columns[0].values).toEqual(["us", "US"]);
  });
});

describe("identity ops are case-sensitive (keys are identity)", () => {
  const f = frame("k", ["us", "US", "us"]);

  it("Distinct keeps differently-cased rows", () => {
    expect(distinctRows(f).columns[0].values).toEqual(["us", "US"]);
  });

  it("Group By groups them apart", () => {
    const out = groupByFrame(f, ["k"], [{ op: "count", column: "k", as: "n" }]);
    expect(out.columns[0].values).toEqual(["us", "US"]);
    expect(out.columns[1].values).toEqual([2, 1]);
  });

  it("Join keys never case-fold", () => {
    const right: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: ["US"] },
        { name: "v", type: "number", values: [1] },
      ],
    };
    const out = joinFrames(f, right, { leftKey: "k", rightKey: "k", how: "inner" });
    expect(out.columns[0].values).toEqual(["US"]);
  });
});

describe("Replace Values keeps its described fine print", () => {
  it("whole-cell is case-sensitive and numbers match numerically", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [
        { name: "s", type: "string", values: ["us", "US", null] },
        { name: "n", type: "number", values: [5, 50, null] },
      ],
    };
    const s = replaceValues(f, "s", "US", "eu", "cell");
    expect(s.columns[0].values).toEqual(["us", "eu", null]);
    const n = replaceValues(f, "n", "5", "9", "cell");
    expect(n.columns[1].values).toEqual([9, 50, null]);
  });

  it("substring mode rewrites only string columns", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [
        { name: "s", type: "string", values: ["a5b"] },
        { name: "n", type: "number", values: [5] },
      ],
    };
    const out = replaceValues(f, "", "5", "x", "substring");
    expect(out.columns[0].values).toEqual(["axb"]);
    expect(out.columns[1].values).toEqual([5]);
  });
});
