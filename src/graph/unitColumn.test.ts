import { describe, it, expect } from "vitest";
import { buildFrame, addColumn } from "./frame";
import { parseColumnUnitFromHeader, columnUnitLabel, columnDisplayValue, tagFrameCellUnit } from "./unitColumn";
import { displayMagnitudeOf } from "./unitBridge";
import { GetColumnNode } from "./nodes/frame";
import { AggregateNode } from "./nodes/list";
import { isUnitCell, magnitudeOf, unitLabelOf, type UnitCell } from "./unitValue";

describe("tagFrameCellUnit — the as-typed frame cell → base-SI UnitCell carrying the display id", () => {
  it("currency carries the display id (the $-blank bug): $5 stays $5, not a blank unit", () => {
    const cu = parseColumnUnitFromHeader("Revenue ($)").unit!;
    const tagged = tagFrameCellUnit(5, cu) as UnitCell;
    expect(isUnitCell(tagged)).toBe(true);
    expect(tagged.display).toBe("usd");
    expect(magnitudeOf(tagged)).toBe(5);           // scale 1 — base == as-typed
    expect(displayMagnitudeOf(tagged)).toBe(5);
  });
  it("a scaled unit normalises to base SI but reads back in the display unit: 5 km", () => {
    const cu = parseColumnUnitFromHeader("Distance (km)").unit!;
    const tagged = tagFrameCellUnit(5, cu) as UnitCell;
    expect(magnitudeOf(tagged)).toBe(5000);        // base SI (metres)
    expect(tagged.display).toBe("km");
    expect(displayMagnitudeOf(tagged)).toBe(5);    // reads back as 5 km
  });
  it("passes non-numeric cells through untouched", () => {
    const cu = parseColumnUnitFromHeader("Distance (km)").unit!;
    expect(tagFrameCellUnit(null, cu)).toBe(null);
    expect(tagFrameCellUnit("x", cu)).toBe("x");
    expect(tagFrameCellUnit(NaN, cu)).toBeNaN();
  });
});

describe("parseColumnUnitFromHeader", () => {
  it("strips a `Name (unit)` spec and locks the column", () => {
    expect(parseColumnUnitFromHeader("Revenue ($0.00)")).toMatchObject({
      clean: "Revenue", unit: { display: "usd" },
    });
    expect(parseColumnUnitFromHeader("Distance (km)")).toMatchObject({
      clean: "Distance", unit: { display: "km" },
    });
    expect(parseColumnUnitFromHeader("Speed (m/s)").unit?.dim).toEqual({ length: 1, time: -1 });
  });
  it("a plain header (or an unresolvable spec) carries no unit", () => {
    expect(parseColumnUnitFromHeader("Item")).toEqual({ clean: "Item" });
    expect(parseColumnUnitFromHeader("Notes (misc)").unit).toBeUndefined();
  });
});

describe("buildFrame — the worked example: [id, Item, Revenue ($0.00)]", () => {
  it("locks the Revenue column to the currency unit and cleans the header", () => {
    const f = buildFrame([[1, 10, 5], [2, 20, 6], [3, 30, 7]], ["id", "Item", "Revenue ($0.00)"]);
    expect(f.columns.map((c) => c.name)).toEqual(["id", "Item", "Revenue"]);
    expect(f.columns[2].unit?.display).toBe("usd");
    expect(f.columns[0].unit).toBeUndefined();
  });
});

describe("addColumn — a `Name (unit)` header locks the appended column", () => {
  it("locks by unit and de-dupes on the clean name", () => {
    const base = buildFrame([[1], [2]], ["id"]);
    const f = addColumn(base, "Distance (km)", [1000, 2000]);
    const col = f.columns.find((c) => c.name === "Distance")!;
    expect(col.unit?.display).toBe("km");
  });
});

describe("Get Column → the unit rides out of the frame into the list", () => {
  it("tags numeric cells with the column's dimension", () => {
    const f = buildFrame([[5], [6], [7]], ["Revenue ($0.00)"]);
    const gc = new GetColumnNode({ readAs: "number" });
    const out = gc.data({ frame: [f], name: ["Revenue"] }).values as (number | UnitCell)[];
    expect(out.every((c) => isUnitCell(c))).toBe(true);
    expect((out as UnitCell[]).map((c) => magnitudeOf(c))).toEqual([5, 6, 7]);
    expect(unitLabelOf(out[0])).toBe("¤"); // currency base symbol
  });
});

describe("Aggregate over a unit-tagged list carries the unit", () => {
  it("SUM of a length column stays a length; AVG too", () => {
    const f = buildFrame([[1000], [2000], [3000]], ["Distance (m)"]);
    const gc = new GetColumnNode({ readAs: "number" });
    const list = gc.data({ frame: [f], name: ["Distance"] }).values as UnitCell[];
    const sum = new AggregateNode({ op: "sum" });
    const r = sum.data({ list: [list as never] }).result;
    expect(isUnitCell(r)).toBe(true);
    expect(magnitudeOf(r)).toBe(6000);
    expect(unitLabelOf(r)).toBe("m");
  });
  it("COUNT of a dimensioned list is a plain number (dimensionless)", () => {
    const f = buildFrame([[1], [2], [3]], ["Distance (m)"]);
    const gc = new GetColumnNode({ readAs: "number" });
    const list = gc.data({ frame: [f], name: ["Distance"] }).values as UnitCell[];
    const count = new AggregateNode({ op: "count" });
    expect(count.data({ list: [list as never] }).result).toBe(3);
  });
  it("plain-number lists are unchanged (dimensionless → bare number)", () => {
    const sum = new AggregateNode({ op: "sum" });
    expect(sum.data({ list: [[1, 2, 3]] }).result).toBe(6);
  });
});

describe("column display helpers", () => {
  it("columnDisplayValue converts base SI to the display unit", () => {
    const cu = parseColumnUnitFromHeader("d (km)").unit!;
    expect(columnDisplayValue(cu, 5000)).toBe(5);
    expect(columnUnitLabel(cu)).toBe("km");
  });
});
