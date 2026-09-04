import { describe, it, expect } from "vitest";
import { distinctColumnValues } from "../../src/graph/frameVerbs";
import { coerceFrameCell } from "../../src/graph/frame";

// B2.1 constrained entry: a TEXT column's distinct existing values feed the edit datalist.

describe("distinctColumnValues — the constrained-entry datalist source", () => {
  it("dedupes in first-seen order", () => {
    expect(distinctColumnValues(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });

  it("drops blanks (null, undefined, empty string)", () => {
    expect(distinctColumnValues(["a", "", null, undefined, "a", "b"])).toEqual(["a", "b"]);
  });

  it("drops cells the exclusion predicate rejects (error codes at the call site)", () => {
    const isErr = (s: string) => s.startsWith("#");
    expect(distinctColumnValues(["Bolt", "#VALUE!", "Nut", "#REF!", "Bolt"], isErr)).toEqual(["Bolt", "Nut"]);
  });

  it("an all-blank / empty column yields no suggestions", () => {
    expect(distinctColumnValues([])).toEqual([]);
    expect(distinctColumnValues(["", null, undefined])).toEqual([]);
  });
});

describe("picking a suggestion commits like a typed value", () => {
  it("a suggested value coerces identically to typing it, for a string column", () => {
    const cells = ["Bolt M4", "Nut M4", "Bolt M4", "", "Washer"];
    const suggestions = distinctColumnValues(cells);
    expect(suggestions).toEqual(["Bolt M4", "Nut M4", "Washer"]);
    // The datalist only populates the same <input>; a pick travels the identical commit
    // path as a keystroke, so each suggestion round-trips to itself through the cell coercion.
    for (const s of suggestions) {
      expect(coerceFrameCell("string", s)).toBe(s);
    }
  });
});
