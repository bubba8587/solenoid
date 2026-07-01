import { describe, it, expect } from "vitest";
import { dateFormatDisplay, shouldRenderListInline, formatListCell } from "./valueDisplayFormat";
import { jsDateToSerial } from "../nodes/date";
import { solError } from "../errorValue";

const ser = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

// ValueDisplay calls dateFormatDisplay(value, dateLike, hasAnnotation) so any
// node whose OUTPUT socket is a date type shows formatted dates in its box —
// scalars AND lists — without each node wiring up its own formatter.

describe("dateFormatDisplay", () => {
  it("formats a scalar serial as a date string when the output is date-typed", () => {
    expect(dateFormatDisplay(ser(2026, 1, 3), true, false)).toBe("03-Jan-2026");
  });

  it("formats a list of serials, so the value renders as a chip of dates", () => {
    const out = dateFormatDisplay([ser(2026, 1, 3), ser(2026, 2, 4)], true, false);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual(["03-Jan-2026", "04-Feb-2026"]);
  });

  it("shows the time when the serial carries a fraction (e.g. NOW())", () => {
    const noonNewYear = ser(2026, 1, 1) + 0.5;
    expect(dateFormatDisplay(noonNewYear, true, false)).toBe("01-Jan-2026 12:00");
  });

  it("is a no-op when the output is NOT a date type", () => {
    expect(dateFormatDisplay(45000, false, false)).toBe(45000);
    expect(dateFormatDisplay([45000, 45001], false, false)).toEqual([45000, 45001]);
  });

  it("defers to the Format Controller when one is docked (annotation present)", () => {
    expect(dateFormatDisplay(45000, true, true)).toBe(45000);
  });

  it("leaves non-numeric values (text, errors) untouched", () => {
    expect(dateFormatDisplay("hello", true, false)).toBe("hello");
    expect(dateFormatDisplay(["a", "b"], true, false)).toEqual(["a", "b"]);
    expect(dateFormatDisplay(null, true, false)).toBeNull();
  });

  it("renders a non-finite serial in a list as blank, not NaN text", () => {
    expect(dateFormatDisplay([ser(2026, 1, 3), NaN], true, false)).toEqual(["03-Jan-2026", ""]);
  });
});

describe("shouldRenderListInline (chip vs joined text)", () => {
  // The Display node passes full = !collapsed; normal nodes never pass full.
  it("expanded Display shows the list inline (joined)", () => {
    expect(shouldRenderListInline(true, false)).toBe(true);
    expect(shouldRenderListInline(true, true)).toBe(true);
  });

  it("COLLAPSED Display always chips — even with an FC docked (the bug this fixes)", () => {
    expect(shouldRenderListInline(false, false)).toBe(false);
    expect(shouldRenderListInline(false, true)).toBe(false); // FC must not defeat collapse
  });

  it("a normal node chips a plain list but shows an annotated one inline", () => {
    expect(shouldRenderListInline(undefined, false)).toBe(false); // no FC → chip
    expect(shouldRenderListInline(undefined, true)).toBe(true);   // FC → inline (formatting visible)
  });
});

describe("formatListCell", () => {
  const fmt = (n: number) => n.toFixed(1);
  it("renders a missing cell literally as null", () => {
    expect(formatListCell(null, fmt)).toBe("null");
  });
  it("renders a per-cell error as its code", () => {
    expect(formatListCell(solError("#DIV/0!", "x"), fmt)).toBe("#DIV/0!");
  });
  it("passes text through and formats numbers via the scalar formatter", () => {
    expect(formatListCell("hi", fmt)).toBe("hi");
    expect(formatListCell(2, fmt)).toBe("2.0");
  });
  it("renders a logical as Excel-form TRUE/FALSE", () => {
    expect(formatListCell(true, fmt)).toBe("TRUE");
    expect(formatListCell(false, fmt)).toBe("FALSE");
  });
});
