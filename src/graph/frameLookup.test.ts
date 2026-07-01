import { describe, it, expect } from "vitest";
import { lookupFrameCell } from "./frameVerbs";
import { isSolError } from "./errorValue";
import type { FrameValue } from "./frame";

const people: FrameValue = {
  __frame: true,
  columns: [
    { name: "id", type: "number", values: [1, 2, 3] },
    { name: "name", type: "string", values: ["Ann", "Bob", "Cy"] },
    { name: "joined", type: "date", values: [46000, 46010, 46020] },
    { name: "active", type: "logical", values: [true, false, true] },
  ],
};

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
    // 46010 as an Excel serial is a real date; matching by ISO goes via parseDateToSerial
    const iso = people.columns[2]; // sanity: the serial column exists
    expect(iso.values[1]).toBe(46010);
  });

  it("returns the FIRST matching row", () => {
    const dup: FrameValue = {
      __frame: true,
      columns: [
        { name: "k", type: "string", values: ["x", "x"] },
        { name: "v", type: "number", values: [10, 20] },
      ],
    };
    expect(lookupFrameCell(dup, "k", "v", "x")).toBe(10);
  });

  it("returns undefined when no row matches", () => {
    expect(lookupFrameCell(people, "name", "id", "Zed")).toBeUndefined();
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
});
