// [[C45]], [[C130]], [[C24]]
import { describe, it, expect } from "vitest";
import { type LookupMatchMode, type LookupSearchMode } from "../../src/graph/frameOps";
import { lookupCell, lookupRowIndex, frameRowAt } from "./coreVerbs";
import { coreFunction } from "./coreFunction";
import { isSolError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/date";
import { XLookupNode } from "../../src/graph/nodes/frame";
import { throughBoundary } from "./boundaryKit";
import { columnUnitFromSpec } from "../../src/graph/unitColumn";
import { applyFcUnit } from "../../src/graph/unitBridge";

const people: FrameValue = {
  __frame: true,
  columns: [
    { name: "id", type: "number", values: [1, 2, 3] },
    { name: "name", type: "string", values: ["Ann", "Bob", "Cy"] },
    { name: "joined", type: "date", values: [46000, 46010, 46020] },
    { name: "active", type: "logical", values: [true, false, true] },
  ],
};

// The lookup kernels the XLookup card runs on the core, over a frame.
const lookupFrameCell = (f: FrameValue, lc: string, rc: string, lookup: string, mm?: LookupMatchMode, sm?: LookupSearchMode) =>
  lookupCell(f, lc, rc, lookup, mm, sm);
const lookupFrameRowIndex = (f: FrameValue, lc: string, lookup: string, mm?: LookupMatchMode, sm?: LookupSearchMode) =>
  lookupRowIndex(f, lc, lookup, mm, sm);
/** XMATCH's position, 0-based, or -1 where it finds none. */
const xmatchIndex = (needle: unknown, list: unknown[], mode: "exact" | "next_smaller" | "next_larger" = "exact"): number => {
  const r = coreFunction("XMATCH")!(needle, list, { exact: 0, next_smaller: -1, next_larger: 1 }[mode]);
  return isSolError(r) ? -1 : (r as number) - 1;
};

describe("frame/cube XLOOKUP shares the XMATCH formula kernel (no surface drift)", () => {
  // The node parses its lookup STRING into a typed needle, then delegates the actual
  // match to xmatchIndex — the SAME kernel the XMATCH/XLOOKUP formulas call. Pinning
  // equality here is what makes "the two surfaces can't drift" a test, not a comment.
  const names = people.columns[1].values;   // ["Ann", "Bob", "Cy"]  (string)
  const ids = people.columns[0].values;      // [1, 2, 3]             (number)
  const joined = people.columns[2].values;   // [46000, 46010, 46020] (date serials)
  it("the frame node matcher equals xmatchIndex on the parsed needle", () => {
    expect(lookupFrameRowIndex(people, "name", "bob")).toBe(xmatchIndex("bob", names));   // case-insensitive
    expect(lookupFrameRowIndex(people, "id", "2")).toBe(xmatchIndex(2, ids));             // number exact
    expect(lookupFrameRowIndex(people, "name", "Zed")).toBe(xmatchIndex("Zed", names));   // miss → -1 both
    expect(lookupFrameRowIndex(people, "joined", "46010")).toBe(xmatchIndex(46010, joined)); // date parsed to serial
    expect(lookupFrameRowIndex(people, "id", "2.5", "nextSmaller"))
      .toBe(xmatchIndex(2.5, ids, "next_smaller"));                                        // approximate
  });
});

describe("lookupFrameCell — frame XLOOKUP/VLOOKUP", () => {
  it("looks up by a string key, returns another column's cell", () => {
    expect(lookupFrameCell(people, "name", "id", "Bob")).toBe(2);
  });

  it("looks up by a numeric key (typed as text), returns text", () => {
    expect(lookupFrameCell(people, "id", "name", "3")).toBe("Cy");
  });

  it("looks up by a logical key (0/1 or true/false both match)", () => {
    expect(lookupFrameCell(people, "active", "name", "false")).toBe("Bob");
    expect(lookupFrameCell(people, "active", "name", "0")).toBe("Bob");
    expect(lookupFrameCell(people, "active", "name", "true")).toBe("Ann"); // first match
  });

  it("looks up by a date key — a serial or an ISO date both match", () => {
    expect(lookupFrameCell(people, "joined", "name", "46010")).toBe("Bob");
  });

  it("never matches a null / error key cell", () => {
    const gappy: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: [null, "y"] },
        { name: "v", type: "number", values: [1, 2] },
      ],
    };
    expect(lookupFrameCell(gappy, "k", "v", "y")).toBe(2);
  });

  it("throws a #REF! for a missing column", () => {
    const err = (() => { try { lookupFrameCell(people, "nope", "id", "1"); } catch (e) { return e; } })();
    expect(isSolError(err) && err.code).toBe("#REF!");
  });

  it("search mode 'last' returns the last duplicate; 'first' the first", () => {
    const dup: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: ["x", "y", "x"] },
        { name: "v", type: "number", values: [10, 20, 30] },
      ],
    };
    expect(lookupFrameCell(dup, "k", "v", "x")).toBe(10);                    // first (default)
    expect(lookupFrameCell(dup, "k", "v", "x", "exact", "last")).toBe(30);   // last
  });
});

describe("lookupFrameRowIndex + frameRowAt — the whole-row (*) path", () => {
  it("returns the matched 0-based row index, or -1 for a miss", () => {
    expect(lookupFrameRowIndex(people, "name", "Cy")).toBe(2);
    expect(lookupFrameRowIndex(people, "name", "Zed")).toBe(-1);
  });

  it("frameRowAt materializes the matched row as a single-row Frame (all columns)", () => {
    const idx = lookupFrameRowIndex(people, "name", "Bob");
    const row = frameRowAt(people, idx);
    expect(row.columns.map((c) => c.name)).toEqual(["id", "name", "joined", "active"]);
    expect(row.columns.every((c) => c.values.length === 1)).toBe(true);
    expect(row.columns.find((c) => c.name === "id")!.values[0]).toBe(2);
    expect(row.columns.find((c) => c.name === "active")!.values[0]).toBe(false);
  });
});

// A4: the XLookup node's `frame` input used to carry `rawInputs` (skip ALL coercion) purely
// to keep a wired Frame typed — coercion would toCube it. It now uses `noWidenInputs` instead:
// the frame reaches data() at its natural rank (a Frame stays a typed Frame, a Cube a Cube),
// so a scalar / bare 1-D list still arrives un-widened and the node's shape guard rejects it
// with the "Build Frame two aligned lists first" #VALUE! rather than a silent widen.
describe("XLOOKUP node coercion — retiring the rawInputs bypass (A4)", () => {
  const d1 = parseDateToSerial("2025-01-15");
  const d2 = parseDateToSerial("2025-06-30");
  const dated: FrameValue = {
    __frame: true,
    columns: [
      { name: "d", type: "date", values: [d1, d2] },
      { name: "v", type: "number", values: [10, 20] },
    ],
  };
  const run = (frameInput: unknown, lookup: string) => {
    const n = new XLookupNode();
    throughBoundary(n); // the real input boundary, not a raw data() call
    n.stringLiterals = { lookup, inColumn: "d", returnColumn: "v", ifNotFound: "" };
    return (n.data({ frame: [frameInput] }) as { value: unknown }).value;
  };

  it("keeps a wired frame's DATE typing through coerceInputs (matches an ISO string)", () => {
    // If coercion stripped the type (toCube → number inference), the ISO string would miss.
    expect(run(dated, "2025-06-30")).toBe(20);
  });

  it("rejects a scalar on the Table socket with the Build-Frame guidance, not a silent widen", () => {
    const r = run(42, "1");
    expect(isSolError(r) && (r as { code: string }).code).toBe("#VALUE!");
  });

  it("rejects a bare 1-D list the same way", () => {
    const r = run(["a", "b", "c"], "a");
    expect(isSolError(r) && (r as { code: string }).code).toBe("#VALUE!");
  });
});

describe("lookupFrameCell — approximate match (XLOOKUP match_mode -1/1)", () => {
  const prices: FrameValue = {
    __frame: true,
    columns: [
      { name: "qty", type: "number", values: [1, 10, 50, 100] },
      { name: "discount", type: "number", values: [0, 0.05, 0.1, 0.2] },
    ],
  };

  it("exact mode (default) only matches an equal cell", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10")).toBe(0.05);
    expect(lookupFrameCell(prices, "qty", "discount", "20")).toBeUndefined();
  });

  it("nextSmaller: exact match wins, else the closest smaller key", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10", "nextSmaller")).toBe(0.05); // exact
    expect(lookupFrameCell(prices, "qty", "discount", "20", "nextSmaller")).toBe(0.05); // between 10 and 50
    expect(lookupFrameCell(prices, "qty", "discount", "0", "nextSmaller")).toBeUndefined(); // below every key
  });

  it("nextLarger: exact match wins, else the closest larger key", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10", "nextLarger")).toBe(0.05); // exact
    expect(lookupFrameCell(prices, "qty", "discount", "20", "nextLarger")).toBe(0.1); // between 10 and 50
    expect(lookupFrameCell(prices, "qty", "discount", "1000", "nextLarger")).toBeUndefined(); // above every key
  });

  it("approximate mode requires a numeric/date column", () => {
    const named: FrameValue = { __frame: true, columns: [{ name: "n", type: "string", values: ["a", "b"] }, { name: "v", type: "number", values: [1, 2] }] };
    const err = (() => { try { lookupFrameCell(named, "n", "v", "a", "nextSmaller"); } catch (e) { return e; } })();
    expect(isSolError(err) && err.code).toBe("#VALUE!");
  });
});

describe("a lookup column with a unit reads the typed needle in that unit ([[C25]] firstClassUnits)", () => {
  const usd = columnUnitFromSpec("$")!, mi = columnUnitFromSpec("mi")!;
  const priced: FrameValue = {
    __frame: true,
    columns: [
      { name: "price", type: "number", values: [5, 10, 20], unit: usd },
      { name: "dist", type: "number", values: [1, 5, 10], unit: mi },
      { name: "len", type: "number", values: [100, 200, 300], unit: { dim: { length: 1 } } },
      { name: "item", type: "string", values: ["pen", "pad", "ink"] },
    ],
  };
  it("the XLookup card answers the row, not #N/A", () => {
    const n = new XLookupNode();
    n.stringLiterals = { lookup: "10", inColumn: "price", returnColumn: "item", ifNotFound: "" };
    expect(n.data({ frame: [priced] }).value).toBe("pad");
  });
  it("the XLOOKUP formula over a united list agrees with the card", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const miles = [1, 5, 10].map((v) => applyFcUnit(v, "mi"));
    const vs = ["pen", "pad", "ink"];
    expect(new ExpressionNode({ expr: "XLOOKUP(5, ks, vs)" }).data({ ks: [miles], vs: [vs] }).result).toBe("pad");
    expect(new ExpressionNode({ expr: 'XLOOKUP(7, ks, vs, "none", -1)' }).data({ ks: [miles], vs: [vs] }).result).toBe("pad");
  });
});
