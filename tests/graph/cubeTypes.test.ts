// [[D90]] cubeTypesAtDepth
import { describe, it, expect } from "vitest";
import { readNestedTables, typesAt, isFrameAt, withFrame, withNestedType, renameNestedColumn, dropNestedColumn, dropNestedUnder, tableKey } from "../../src/graph/cubeTypes";

describe("nested table types, keyed per cell", () => {
  const k = tableKey;
  const n = readNestedTables({
    [k([0, "tasks"])]: { types: { hours: "number", odd: "frame" } },
    [k([1, "tasks"])]: { frame: true, types: { hours: "string" } },
    [k([0, "tasks", 2, "steps"])]: { types: { due: "date" } },
    "not a path": { types: { a: "number" } },
    [k([2, "x"])]: { frame: "no", types: {} },
  });

  it("reads records paths and real types only", () => {
    expect(n).toEqual({ [k([0, "tasks"])]: { types: { hours: "number" } }, [k([1, "tasks"])]: { frame: true, types: { hours: "string" } }, [k([0, "tasks", 2, "steps"])]: { types: { due: "date" } } });
    expect([isFrameAt(n, [1, "tasks"]), isFrameAt(n, [0, "tasks"])]).toEqual([true, false]);
    expect(typesAt(n, [1, "tasks"])).toEqual({ hours: "string" });
    expect(typesAt(n, [5, "tasks"])).toEqual({});
  });

  it("sets and clears one table's pick without touching its neighbors in other rows", () => {
    const set = withNestedType(n, [1, "tasks"], "who", "string");
    expect(typesAt(set, [1, "tasks"])).toEqual({ hours: "string", who: "string" });
    expect(typesAt(set, [0, "tasks"])).toEqual({ hours: "number" });
    expect(withNestedType(n, [1, "tasks"], "hours", undefined)[k([1, "tasks"])]).toEqual({ frame: true });
    expect(k([0, "tasks"]) in withNestedType(n, [0, "tasks"], "hours", undefined)).toBe(false);
    expect(withFrame(n, [0, "tasks"], true)[k([0, "tasks"])]).toEqual({ frame: true, types: { hours: "number" } });
    expect(k([1, "tasks"]) in withFrame(withNestedType(n, [1, "tasks"], "hours", undefined), [1, "tasks"], false)).toBe(false);
  });

  it("a renamed column carries its pick and the tables in its cells", () => {
    const r = renameNestedColumn(n, [], "tasks", "jobs");
    expect(Object.keys(r).sort()).toEqual([k([0, "jobs"]), k([0, "jobs", 2, "steps"]), k([1, "jobs"])].sort());
    const inner = renameNestedColumn(n, [0, "tasks"], "hours", "h");
    expect(typesAt(inner, [0, "tasks"])).toEqual({ h: "number" });
    expect(typesAt(inner, [1, "tasks"])).toEqual({ hours: "string" });
  });

  it("a removed column, row or replaced cell takes what was typed inside it", () => {
    expect(Object.keys(dropNestedColumn(n, [], "tasks"))).toEqual([]);
    expect(Object.keys(dropNestedUnder(n, [0])).sort()).toEqual([k([1, "tasks"])]);
    expect(typesAt(dropNestedUnder(n, [0, "tasks", 2]), [0, "tasks", 2, "steps"])).toEqual({});
    expect(Object.keys(dropNestedUnder(n, [0, "tasks"], true))).toEqual([k([0, "tasks"]), k([1, "tasks"])]);
  });
});
