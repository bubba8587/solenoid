// [[C28]] literalsIffEditable, [[D90]] cubeTypesAtDepth
// Rows and columns inserted and deleted anywhere in the table editors (table-popup § The grid).
import { describe, it, expect } from "vitest";
import { insertAt, removeAt, shiftForInsert, shiftForRemove, remapKeys, insertGridCols, removeGridCols, pickIndex } from "../../src/graph/tableEdit";
import { shiftNestedRows, dropNestedUnder, tableKey } from "../../src/graph/cubeTypes";
import { editMenuItems, targetLabel, type EditAxis } from "../../src/graph/components/TableEditMenu";

describe("splicing", () => {
  it("inserts before an index and removes a set", () => {
    expect(insertAt(["a", "b", "c"], 1, ["x", "y"])).toEqual(["a", "x", "y", "b", "c"]);
    expect(insertAt(["a"], 9, ["x"])).toEqual(["a", "x"]);
    expect(removeAt(["a", "b", "c", "d"], new Set([1, 3]))).toEqual(["a", "c"]);
  });
  it("moves an index past an insert or a removal", () => {
    expect(shiftForInsert(4, 2, 3)).toBe(7);
    expect(shiftForInsert(1, 2, 3)).toBe(1);
    expect(shiftForRemove(5, new Set([1, 3]))).toBe(3);
    expect(shiftForRemove(3, new Set([1, 3]))).toBeNull();
    expect(remapKeys({ 0: "sum", 2: "avg" }, (i) => shiftForRemove(i, new Set([0])))).toEqual({ 1: "avg" });
  });
  it("inserts and removes grid columns in every row", () => {
    expect(insertGridCols([["a", "b"], ["c", "d"]], 1, 1, "")).toEqual([["a", "", "b"], ["c", "", "d"]]);
    expect(removeGridCols([["a", "b", "c"]], new Set([0, 2]))).toEqual([["b"]]);
  });
});

describe("selection", () => {
  it("extends from the anchor over the rows as shown", () => {
    const first = pickIndex(null, "row", 4, false, [4, 0, 2, 1, 3]);
    expect(pickIndex(first, "row", 2, true, [4, 0, 2, 1, 3]).indices).toEqual([4, 0, 2]);
    expect(pickIndex(first, "col", 2, true, [0, 1, 2]).indices).toEqual([2]);
  });
});

describe("a Cube level's nested declarations follow their rows", () => {
  const nested = {
    [tableKey([0, "orders"])]: { frame: true as const },
    [tableKey([2, "orders"])]: { types: { qty: "number" as const } },
    [tableKey([1, "sub", 3, "x"])]: { frame: true as const },
  };
  it("shifts rows at or past the insert", () => {
    const out = shiftNestedRows(nested, [], 1, 2);
    expect(Object.keys(out).sort()).toEqual([tableKey([0, "orders"]), tableKey([3, "sub", 3, "x"]), tableKey([4, "orders"])].sort());
  });
  it("shifts inside a deeper level only", () => {
    const out = shiftNestedRows(nested, [1, "sub"], 0, 1);
    expect(out[tableKey([1, "sub", 4, "x"])]).toEqual({ frame: true });
    expect(out[tableKey([2, "orders"])]).toBeDefined();
  });
  it("a deleted row drops its own and closes the gap", () => {
    const out = shiftNestedRows(dropNestedUnder(nested, [1]), [], 2, -1);
    expect(Object.keys(out).sort()).toEqual([tableKey([0, "orders"]), tableKey([1, "orders"])].sort());
  });
});

describe("the menus", () => {
  const axis = (over: Partial<EditAxis>): EditAxis => ({ noun: "Row", sides: ["above", "below"], ends: ["top", "bottom"], target: [2], total: 5, insert: () => {}, remove: () => {}, ...over });
  it("name what Delete removes", () => {
    expect(targetLabel(axis({}))).toBe("Row 3");
    expect(targetLabel(axis({ target: [4, 2, 3] }))).toBe("Rows 3–5");
    expect(targetLabel(axis({ target: [0, 4] }))).toBe("Rows 1, 5");
    expect(targetLabel(axis({ target: [0, 2, 4, 6, 8] }))).toBe("5 rows");
    expect(targetLabel(axis({ noun: "Column", nameOf: (i) => ["price", "qty"][i], target: [1] }))).toBe('Column "qty"');
    expect(targetLabel(axis({ noun: "Column", nameOf: () => "", labelOf: (i) => "ABC"[i], target: [2] }))).toBe("Column C");
    expect(targetLabel(axis({ noun: "Column", labelOf: (i) => "ABCD"[i], target: [1, 2, 3] }))).toBe("Columns B–D");
  });
  it("insert as many as are selected, above the first and below the last", () => {
    const calls: [number, number][] = [];
    const { insert } = editMenuItems(axis({ target: [1, 2, 3], insert: (at, n) => calls.push([at, n]) }));
    expect(insert.map((i) => i.label)).toEqual(["3 rows above", "3 rows below"]);
    insert.forEach((i) => i.onClick());
    expect(calls).toEqual([[1, 3], [4, 3]]);
  });
  it("never delete every row, unless the level may be empty", () => {
    expect(editMenuItems(axis({ target: [0], total: 1 })).remove[0].disabled).toBe(true);
    expect(editMenuItems(axis({ target: [0], total: 1, canEmpty: true })).remove[0].disabled).toBe(false);
  });
  it("with nothing picked, insert at either end and delete the last, by name", () => {
    const calls: number[] = [];
    const removed: number[][] = [];
    const { insert, remove } = editMenuItems(axis({ target: [], total: 4, insert: (at) => calls.push(at), remove: (xs) => removed.push(xs) }));
    expect(insert.map((i) => i.label)).toEqual(["Row at top", "Row at bottom"]);
    insert.forEach((i) => i.onClick());
    expect(calls).toEqual([0, 4]);
    expect(remove.map((i) => i.label)).toEqual(["Row 4"]);
    remove[0].onClick();
    expect(removed).toEqual([[3]]);
  });
  it("offer one when there are none", () => {
    const calls: number[] = [];
    const { insert, remove } = editMenuItems(axis({ target: [], total: 0, insert: (at) => calls.push(at) }));
    expect(insert.map((i) => i.label)).toEqual(["Row"]);
    expect(remove).toEqual([]);
    insert[0].onClick();
    expect(calls).toEqual([0]);
  });
});
