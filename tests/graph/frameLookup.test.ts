// [[C45]] excelComparisons, [[C130]] rustCore, [[C24]] arraySemantics, [[frame-verbs#Lookup over a Frame]]
import { describe, it, expect } from "vitest";
import { type LookupMatchMode, type LookupSearchMode } from "../../src/graph/frameOps";
import { lookupCell, lookupRowIndex, frameRowAt } from "./coreVerbs";
import { coreFunction } from "./coreFunction";
import { isSolError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";
import { parseDateToSerial } from "../../src/graph/nodes/date";
import { XLookupNode } from "../../src/graph/nodes/frame";
import { throughBoundary } from "./boundaryKit";
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
  const names = people.columns[1].values;   // ["Ann", "Bob", "Cy"]  (string)
  const ids = people.columns[0].values;      // [1, 2, 3]             (number)
  const joined = people.columns[2].values;   // [46000, 46010, 46020] (date serials)
  it("the frame node matcher equals xmatchIndex on the parsed needle", () => {
    expect(lookupFrameRowIndex(people, "name", "bob")).toBe(xmatchIndex("bob", names));   // case-insensitive
    expect(lookupFrameRowIndex(people, "id", "2")).toBe(xmatchIndex(2, ids));             // number exact
    expect(lookupFrameRowIndex(people, "name", "Zed")).toBe(xmatchIndex("Zed", names));   // miss → -1 both
    expect(lookupFrameRowIndex(people, "joined", "46010")).toBe(xmatchIndex(46010, joined)); // date parsed to serial
    expect(lookupFrameRowIndex(people, "id", "2.5", "lte"))
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
    expect(lookupFrameCell(dup, "k", "v", "x", "eq", "last")).toBe(30);   // last
  });
});

describe("lookupFrameRowIndex + frameRowAt — the whole-row (blank Return) path", () => {
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

describe("XLOOKUP node coercion", () => {
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
    expect(lookupFrameCell(prices, "qty", "discount", "10", "lte")).toBe(0.05); // exact
    expect(lookupFrameCell(prices, "qty", "discount", "20", "lte")).toBe(0.05); // between 10 and 50
    expect(lookupFrameCell(prices, "qty", "discount", "0", "lte")).toBeUndefined(); // below every key
  });

  it("nextLarger: exact match wins, else the closest larger key", () => {
    expect(lookupFrameCell(prices, "qty", "discount", "10", "gte")).toBe(0.05); // exact
    expect(lookupFrameCell(prices, "qty", "discount", "20", "gte")).toBe(0.1); // between 10 and 50
    expect(lookupFrameCell(prices, "qty", "discount", "1000", "gte")).toBeUndefined(); // above every key
  });

  it("a text column steps case-insensitively, as XMATCH does", () => {
    const named: FrameValue = { __frame: true, columns: [{ name: "n", type: "string", values: ["apple", "Cherry", "melon"] }, { name: "v", type: "number", values: [1, 2, 3] }] };
    expect(lookupFrameCell(named, "n", "v", "banana", "lte")).toBe(1);
    expect(lookupFrameCell(named, "n", "v", "banana", "gte")).toBe(2);
    expect(lookupFrameCell(named, "n", "v", "CHERRY", "gte")).toBe(2);
    expect(lookupFrameCell(named, "n", "v", "zebra", "gte")).toBeUndefined();
  });

  it("a logical column refuses an approximate match", () => {
    const flags: FrameValue = { __frame: true, columns: [{ name: "f", type: "logical", values: [true, false] }, { name: "v", type: "number", values: [1, 2] }] };
    const err = (() => { try { lookupFrameCell(flags, "f", "v", "true", "lte"); } catch (e) { return e; } })();
    expect(isSolError(err) && err.code).toBe("#VALUE!");
  });
});

describe("a lookup column with a unit reads the typed needle in that unit ([[C25]] firstClassUnits)", () => {
  it("the XLOOKUP formula over a united list agrees with the card", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const miles = [1, 5, 10].map((v) => applyFcUnit(v, "mi"));
    const vs = ["pen", "pad", "ink"];
    expect(new ExpressionNode({ expr: "XLOOKUP(5, ks, vs)" }).data({ ks: [miles], vs: [vs] }).result).toBe("pad");
    expect(new ExpressionNode({ expr: 'XLOOKUP(7, ks, vs, "none", -1)' }).data({ ks: [miles], vs: [vs] }).result).toBe("pad");
  });
});

describe("XLOOKUP across: search a row, return a column", () => {
  const sales: FrameValue = {
    __frame: true,
    columns: [
      { name: "Region", type: "string", values: ["North", "South"] },
      { name: "Jan", type: "number", values: [10, 20] },
      { name: "Feb", type: "number", values: [30, 40] },
    ],
  };
  const across = (lookup: string, set: { inRow?: number; returnRow?: number; ifNotFound?: string; matchMode?: "eq" | "lte" | "gte" } = {}) => {
    const n = new XLookupNode({ direction: "columns", matchMode: set.matchMode });
    throughBoundary(n);
    n.stringLiterals = { lookup, ifNotFound: set.ifNotFound ?? "" };
    n.literals = { ...(set.inRow ? { inRow: set.inRow } : {}), ...(set.returnRow ? { returnRow: set.returnRow } : {}) };
    return (n.data({ frame: [sales] }) as { value: unknown }).value;
  };

  it("a blank In row searches the column names; a blank Return row gives the whole column", () => {
    expect(across("feb")).toEqual([30, 40]);
    expect(across("Jan", { returnRow: 2 })).toBe(20);
  });

  it("In row searches that row's cells, a number row reading the lookup as a number", () => {
    expect(across("40", { inRow: 2, returnRow: 1 })).toBe(30);
    expect(across("35", { inRow: 2, returnRow: 1, matchMode: "lte" })).toBe(10);
  });

  it("a miss is #N/A or the fallback; a row past the table is #REF!", () => {
    const miss = across("Mar");
    expect(isSolError(miss) && (miss as { code: string }).code).toBe("#N/A");
    expect(across("Mar", { ifNotFound: "0" })).toBe(0);
    const ref = across("Jan", { returnRow: 9 });
    expect(isSolError(ref) && (ref as { code: string }).code).toBe("#REF!");
  });

  it("switching direction swaps the axis sockets", () => {
    const n = new XLookupNode();
    expect(Object.keys(n.inputs)).toEqual(["frame", "lookup", "inColumn", "returnColumn", "ifNotFound"]);
    expect(n.setDirection("columns")).toEqual(["inColumn", "returnColumn"]);
    expect(Object.keys(n.inputs)).toEqual(["frame", "lookup", "ifNotFound", "inRow", "returnRow"]);
  });
});

describe("XLOOKUP's modes are Filter's ops", () => {
  const towns: FrameValue = {
    __frame: true,
    columns: [
      { name: "town", type: "string", values: ["Enterprise", "Eufaula", null, "Dothan"] },
      { name: "pop", type: "number", values: [28, 13, 7, 71] },
    ],
  };
  const at = (lookup: string, mm: LookupMatchMode, sm: LookupSearchMode = "first") => lookupFrameCell(towns, "town", "pop", lookup, mm, sm);

  it("starts with, contains and ends with take the first row that passes, ignoring case", () => {
    expect(at("euf", "startsWith")).toBe(13);
    expect(at("PRISE", "endsWith")).toBe(28);
    expect(at("a", "contains")).toBe(13);
    expect(at("a", "contains", "last")).toBe(71);
    expect(at("zz", "contains")).toBeUndefined();
  });

  it("≤ and ≥ take the closest key; < and > the closest strictly past it", () => {
    expect(at("euf", "lte")).toBe(28);
    expect(at("eufaula", "lte")).toBe(13);
    expect(at("eufaula", "lt")).toBe(28);
    expect(at("dothan", "gt")).toBe(28);
    expect(lookupFrameCell(towns, "pop", "town", "7", "lt")).toBeUndefined();
    expect(lookupFrameCell(towns, "pop", "town", "28", "gt")).toBe("Dothan");
  });

  it("≠ and the blank tests are Filter's: is blank ignores the lookup", () => {
    expect(at("Enterprise", "neq")).toBe(13);
    expect(at("", "isblank")).toBe(7);
    expect(at("anything", "notblank", "last")).toBe(71);
  });

  it("a text test on a number column is Filter's #TYPE!", () => {
    const err = (() => { try { lookupFrameCell(towns, "pop", "town", "1", "contains"); } catch (e) { return e; } })();
    expect(isSolError(err) && (err as { code: string }).code).toBe("#TYPE!");
  });
});
