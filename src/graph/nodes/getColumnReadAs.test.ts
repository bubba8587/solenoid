import { describe, it, expect } from "vitest";
import { frameFromCells } from "../frame";
import { GetColumnNode } from "./frame";
import { parseDateToSerial, jsDateToSerial } from "./date";

const ser = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));
const col = (n: GetColumnNode, f: ReturnType<typeof frameFromCells>, name: string) =>
  n.data({ frame: [f], name: [name] }).values as number[];

describe("parseDateToSerial (the one canonical text→date parser)", () => {
  it("parses an ISO date string to its serial", () => {
    expect(parseDateToSerial("2026-01-03")).toBeCloseTo(ser(2026, 1, 3), 6);
  });
  it("returns NaN for non-dates and blanks", () => {
    expect(Number.isNaN(parseDateToSerial("not a date"))).toBe(true);
    expect(Number.isNaN(parseDateToSerial("   "))).toBe(true);
  });
});

// A CSV/JSON import makes a column with any non-numeric cell a STRING column, so
// a date column ("2026-01-03") arrives as text. Get Column's read-as is a
// COERCION: it must parse those, not NaN them (the bug this fixes).
describe("Get Column read-as coerces text columns", () => {
  it("read-as Date parses a TEXT date column to serials (was all N/A)", () => {
    const f = frameFromCells(["Date"], [["2026-01-03"], ["2026-02-04"]]);
    const out = col(new GetColumnNode({ readAs: "date" }), f, "Date");
    expect(out.map(Math.floor)).toEqual([Math.floor(ser(2026, 1, 3)), Math.floor(ser(2026, 2, 4))]);
  });

  it("read-as Date leaves a genuinely unparseable cell as NaN", () => {
    const f = frameFromCells(["Date"], [["2026-01-03"], ["junk"]]);
    const out = col(new GetColumnNode({ readAs: "date" }), f, "Date");
    expect(Math.floor(out[0])).toBe(Math.floor(ser(2026, 1, 3)));
    expect(Number.isNaN(out[1])).toBe(true);
  });

  it("read-as Number parses numeric text in a string column", () => {
    // Mixed cell ("n/a") forces a STRING column; the numeric cells still parse.
    const f = frameFromCells(["Amt"], [["10"], ["20.5"], ["n/a"]]);
    const out = col(new GetColumnNode({ readAs: "number" }), f, "Amt");
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(20.5);
    expect(Number.isNaN(out[2])).toBe(true);
  });

  it("read-as Date still passes through a numeric (already-serial) column", () => {
    const f = frameFromCells(["S"], [["45000"], ["45001"]]); // all-numeric → number column
    const out = col(new GetColumnNode({ readAs: "date" }), f, "S");
    expect(out).toEqual([45000, 45001]);
  });

  it("read-as Date on an inferred DATE column passes its serials through", () => {
    const f = frameFromCells(["When"], [["2026-01-03"], ["2026-02-04"]]); // → date column (serials)
    const out = col(new GetColumnNode({ readAs: "date" }), f, "When");
    expect(out.map(Math.floor)).toEqual([Math.floor(ser(2026, 1, 3)), Math.floor(ser(2026, 2, 4))]);
  });

  it("read-as Text on a DATE column formats serials as date strings, not raw digits", () => {
    const f = frameFromCells(["When"], [["2026-01-03"]]);
    const out = new GetColumnNode({ readAs: "text" }).data({ frame: [f], name: ["When"] }).values as string[];
    expect(out).toEqual(["03-Jan-2026"]); // app default date format (DD-MMM-YYYY)
  });
});

describe("Get Column read-as Logical (TRUE/FALSE out of a column)", () => {
  const bools = (f: ReturnType<typeof frameFromCells>, name: string) =>
    new GetColumnNode({ readAs: "logical" }).data({ frame: [f], name: [name] }).values;

  it("reads an inferred LOGICAL column out as real booleans", () => {
    // frameFromCells auto-types an all-TRUE/FALSE column as logical.
    const f = frameFromCells(["Flag"], [["TRUE"], ["FALSE"], ["true"]]);
    expect(bools(f, "Flag")).toEqual([true, false, true]);
  });

  it("coerces a 0/1 numeric mask column to booleans (nonzero → TRUE)", () => {
    const f = frameFromCells(["Mask"], [["1"], ["0"], ["2"]]); // all-numeric → number column
    expect(bools(f, "Mask")).toEqual([true, false, true]);
  });

  it("a blank stays null; an unparseable cell is lenient null (not a fabricated FALSE)", () => {
    const f = frameFromCells(["Flag"], [["true"], [""], ["maybe"]]); // mixed text → string column
    expect(bools(f, "Flag")).toEqual([true, null, null]);
  });
});

describe("GetColumn preserves null (a blank cell stays missing, not NaN)", () => {
  it("a blank numeric cell → null in the values list (so aggregators skip it)", () => {
    // frameFromCells infers a numeric column with a blank → null cell.
    const f = frameFromCells(["vals"], [["1"], [""], ["3"], ["4"]]);
    const out = new GetColumnNode({ readAs: "number" }).data({ frame: [f], name: ["vals"] }).values;
    expect(out).toEqual([1, null, 3, 4]);
  });
});
