// [[C59]], [[C45]], [[C130]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { sortByColumn } from "./coreVerbs";
import type { FrameValue } from "../../src/graph/frame";

// String ordering is BYTE order (UTF-16 code units), not locale. This PINS that choice: it must NOT behave like
// `localeCompare`, so it stays deterministic across machines.
const sorted = (...x: string[]) => compileEvaluator("SORT(x, 1, 1, TRUE)")!({ x }); // a list is one row: sort across it

describe("SORT orders text by byte order, not locale", () => {
  it("is CASE-SENSITIVE with uppercase before lowercase", () => {
    // "Z" (0x5A) < "a" (0x61): the defining difference from a case-folding locale sort.
    expect(sorted("b", "a", "Z")).toEqual(["Z", "a", "b"]);
  });

  it("orders digits before letters and by code point", () => {
    expect(sorted("a", "1")).toEqual(["1", "a"]);
    expect(sorted("apple9", "apple10")).toEqual(["apple10", "apple9"]); // '1' < '9': NOT a natural sort
  });

  it("is accent-sensitive (a plain code-unit compare, no locale collation)", () => {
    expect(sorted("é", "e", "f")).toEqual(["e", "f", "é"]);
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
