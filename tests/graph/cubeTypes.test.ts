// [[D90]] cubeTypesAtDepth
import { describe, it, expect } from "vitest";
import { readNestedTypes, typesAt, withNestedType, renameNestedColumn, dropNestedColumn, dropNestedUnder, tableKey } from "../../src/graph/cubeTypes";

describe("nested table types, keyed per cell", () => {
  const k = tableKey;
  const n = readNestedTypes({
    [k([0, "tasks"])]: { hours: "number", odd: "frame" },
    [k([1, "tasks"])]: { hours: "string" },
    [k([0, "tasks", 2, "steps"])]: { due: "date" },
    "not a path": { a: "number" },
    [k([2, "x"])]: {},
  });

  it("reads records paths and real types only", () => {
    expect(n).toEqual({ [k([0, "tasks"])]: { hours: "number" }, [k([1, "tasks"])]: { hours: "string" }, [k([0, "tasks", 2, "steps"])]: { due: "date" } });
    expect(typesAt(n, [1, "tasks"])).toEqual({ hours: "string" });
    expect(typesAt(n, [5, "tasks"])).toEqual({});
  });

  it("sets and clears one table's pick without touching its neighbors in other rows", () => {
    const set = withNestedType(n, [1, "tasks"], "who", "string");
    expect(typesAt(set, [1, "tasks"])).toEqual({ hours: "string", who: "string" });
    expect(typesAt(set, [0, "tasks"])).toEqual({ hours: "number" });
    expect(k([1, "tasks"]) in withNestedType(n, [1, "tasks"], "hours", undefined)).toBe(false);
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
  });
});
