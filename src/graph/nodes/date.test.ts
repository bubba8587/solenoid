import { describe, it, expect } from "vitest";
import { DateIfNode, serialToJsDate, jsDateToSerial, type DateIfUnit } from "./date";

// Dates flow through the graph as Excel-style serials (1900 system, where the
// JS epoch is serial 25569). Build them the same way the date nodes do.
const ser = (y: number, m: number, d: number) =>
  jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

describe("serial ↔ JS Date", () => {
  it("round-trips", () => {
    const d = new Date(Date.UTC(2024, 1, 29));
    expect(serialToJsDate(jsDateToSerial(d)).getTime()).toBe(d.getTime());
  });
  it("JS epoch is serial 25569", () => {
    expect(jsDateToSerial(new Date(Date.UTC(1970, 0, 1)))).toBe(25569);
  });
});

describe("DATEDIF", () => {
  const diff = (unit: DateIfUnit, s: number, e: number) =>
    new DateIfNode({ unit }).data({ start: [s], end: [e] }).result;

  it("Y counts complete years", () => {
    expect(diff("Y", ser(2020, 5, 10), ser(2024, 5, 9))).toBe(3);
    expect(diff("Y", ser(2020, 5, 10), ser(2024, 5, 10))).toBe(4);
  });

  it("M counts complete months", () => {
    expect(diff("M", ser(2024, 1, 31), ser(2024, 2, 28))).toBe(0);
    expect(diff("M", ser(2024, 1, 15), ser(2024, 3, 15))).toBe(2);
    expect(diff("M", ser(2020, 5, 10), ser(2024, 3, 9))).toBe(45);
  });

  it("D counts days", () => {
    expect(diff("D", ser(2024, 1, 1), ser(2024, 12, 31))).toBe(365); // leap year
    expect(diff("D", ser(2023, 1, 1), ser(2023, 12, 31))).toBe(364);
  });

  it("MD matches Excel where Excel is well-defined", () => {
    // Same-or-later day in the month: plain difference.
    expect(diff("MD", ser(2024, 5, 10), ser(2024, 8, 15))).toBe(5);
    // The regression the outside review caught: borrow from the month before
    // the end month. Excel returns 28 here; the unclamped Date.UTC rollover
    // construct gave 26.
    expect(diff("MD", ser(2024, 1, 31), ser(2024, 2, 28))).toBe(28);
    // Borrow across a leap February (29 days in the month before March).
    expect(diff("MD", ser(2024, 1, 15), ser(2024, 3, 10))).toBe(24);
    // Non-leap February borrow.
    expect(diff("MD", ser(2023, 1, 15), ser(2023, 3, 10))).toBe(23);
  });

  it("YM counts months ignoring years", () => {
    expect(diff("YM", ser(2020, 5, 10), ser(2024, 3, 9))).toBe(9);
    expect(diff("YM", ser(2024, 1, 15), ser(2024, 3, 15))).toBe(2);
  });

  it("YD counts days ignoring years", () => {
    expect(diff("YD", ser(2024, 1, 10), ser(2024, 3, 15))).toBe(65); // leap Feb
    expect(diff("YD", ser(2023, 3, 1), ser(2024, 2, 1))).toBe(337);
  });

  it("equal dates are 0 in every unit", () => {
    const d = ser(2024, 6, 12);
    for (const unit of ["Y", "M", "D", "MD", "YM", "YD"] as const) {
      expect(diff(unit, d, d)).toBe(0);
    }
  });

  it("start after end returns null", () => {
    expect(diff("D", ser(2024, 2, 1), ser(2024, 1, 1))).toBeNull();
  });
});
