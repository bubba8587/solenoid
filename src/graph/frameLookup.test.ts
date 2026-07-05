import { describe, it, expect } from "vitest";
import { lookupFrameCell, lookupCubeCell } from "./frameVerbs";
import { isSolError } from "./errorValue";
import { cubeFromColumns, isFrameValue } from "./frame";
import type { FrameValue, CubeValue } from "./frame";

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

// The cube half: look a key up in a Cube's TOP-LEVEL column, return the matched
// row's cell WHOLE (a nested frame/cube comes out intact). See docs/cube-node-scope.md.
const orders1: FrameValue = { __frame: true, columns: [{ name: "sku", type: "string", values: ["a", "b"] }] };
const orders3: FrameValue = { __frame: true, columns: [{ name: "sku", type: "string", values: ["z"] }] };
const customers: CubeValue = cubeFromColumns([
  { name: "id", cells: [1, 2, 3] },
  { name: "name", cells: ["Ann", "Bob", "Cy"] },
  { name: "vip", cells: [true, false, true] },
  { name: "orders", cells: [orders1, null, orders3] }, // a nested sub-frame per row
]);

describe("lookupCubeCell — cube XLOOKUP (top-level key, whole-cell return)", () => {
  it("looks up a scalar key, returns another top-level column's scalar", () => {
    expect(lookupCubeCell(customers, "name", "id", "Bob")).toBe(2);
    expect(lookupCubeCell(customers, "id", "name", "3")).toBe("Cy");
  });

  it("returns a NESTED frame cell WHOLE (the cube half's whole point)", () => {
    const cell = lookupCubeCell(customers, "id", "orders", "1");
    expect(isFrameValue(cell)).toBe(true);
    expect(cell).toBe(orders1); // the exact sub-frame, intact — not drilled into
  });

  it("a null nested cell comes back as null", () => {
    expect(lookupCubeCell(customers, "id", "orders", "2")).toBeNull();
  });

  it("matches a logical key (true/false or 1/0), first match wins", () => {
    expect(lookupCubeCell(customers, "vip", "name", "false")).toBe("Bob");
    expect(lookupCubeCell(customers, "vip", "name", "0")).toBe("Bob");
    expect(lookupCubeCell(customers, "vip", "name", "true")).toBe("Ann");
  });

  it("returns undefined when no row matches", () => {
    expect(lookupCubeCell(customers, "name", "id", "Zed")).toBeUndefined();
  });

  it("never matches a nested-container or null key cell", () => {
    // keying ON the nested 'orders' column: a frame/null cell can't be a lookup key.
    expect(lookupCubeCell(customers, "orders", "name", "anything")).toBeUndefined();
  });

  it("throws a #REF! for a missing column", () => {
    const err = (() => { try { lookupCubeCell(customers, "nope", "id", "1"); } catch (e) { return e; } })();
    expect(isSolError(err) && err.code).toBe("#REF!");
  });

  describe("approximate match on a numeric key column (a cube has no typed date column)", () => {
    const prices: CubeValue = cubeFromColumns([
      { name: "qty", cells: [10, 50, 100] },
      { name: "discount", cells: [0.05, 0.1, 0.15] },
    ]);
    it("exact still wins under an approximate mode", () => {
      expect(lookupCubeCell(prices, "qty", "discount", "10", "nextSmaller")).toBe(0.05);
    });
    it("nextSmaller falls back to the closest smaller key", () => {
      expect(lookupCubeCell(prices, "qty", "discount", "20", "nextSmaller")).toBe(0.05);
      expect(lookupCubeCell(prices, "qty", "discount", "0", "nextSmaller")).toBeUndefined();
    });
    it("nextLarger falls back to the closest larger key", () => {
      expect(lookupCubeCell(prices, "qty", "discount", "20", "nextLarger")).toBe(0.1);
      expect(lookupCubeCell(prices, "qty", "discount", "1000", "nextLarger")).toBeUndefined();
    });
    it("throws #VALUE! for an approximate lookup on a non-numeric key column", () => {
      const err = (() => { try { lookupCubeCell(customers, "name", "id", "Bob", "nextSmaller"); } catch (e) { return e; } })();
      expect(isSolError(err) && err.code).toBe("#VALUE!");
    });
  });
});
