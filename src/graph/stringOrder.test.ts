import { describe, it, expect } from "vitest";
import { compareStrings } from "./stringOrder";
import { sortByColumn } from "./frameVerbs";
import type { FrameValue } from "./frame";

// Task 4 (Stream D): string ordering is BYTE order (JS `<`/`>`), not locale.
// This PINS that choice — the point is that it must NOT behave like
// `localeCompare`, so the JS oracle matches the Polars backend and stays
// deterministic across machines. See stringOrder.ts for the rationale.

describe("compareStrings — byte order, not locale", () => {
  it("is a sign-returning comparator", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("a", "a")).toBe(0);
  });

  it("is CASE-SENSITIVE with uppercase before lowercase (byte order)", () => {
    // "Z" (0x5A) < "a" (0x61) — the defining difference from a case-folding
    // locale sort, which would put "a" before "Z".
    expect(compareStrings("Z", "a")).toBe(-1);
    expect(compareStrings("Banana", "apple")).toBe(-1);
  });

  it("orders digits before letters and by code point", () => {
    expect(compareStrings("1", "a")).toBe(-1);
    expect(compareStrings("apple10", "apple9")).toBe(-1); // '1' < '9' — NOT numeric/natural sort
  });

  it("is accent-sensitive (a plain byte compare, no locale collation)", () => {
    expect(compareStrings("e", "é")).toBe(-1); // "é" is a higher code point
  });
});

describe("Frame Sort uses byte order for string columns", () => {
  it("sorts a mixed-case string column by byte order (upper before lower)", () => {
    const f: FrameValue = {
      __frame: true,
      columns: [{ name: "s", type: "string", values: ["banana", "Apple", "cherry", "apple"] }],
    };
    const sorted = sortByColumn(f, "s", "asc");
    expect(sorted.columns[0].values).toEqual(["Apple", "apple", "banana", "cherry"]);
  });
});
