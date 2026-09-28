// [[D90]] cubeTypesAtDepth
import { describe, it, expect } from "vitest";
import { readSchema, schemaAt, withPickType, renamePick, dropPick, flatTypes, pickType, pickColumns } from "../../src/graph/cubeSchema";

describe("cube schema", () => {
  const s = readSchema({ a: "number", t: { type: "string", columns: { h: "number", deep: { columns: { d: "date" } } } }, bad: "nope", empty: { columns: {} } });

  it("reads bare types and nested picks, dropping anything else", () => {
    expect(s).toEqual({ a: "number", t: { type: "string", columns: { h: "number", deep: { columns: { d: "date" } } } } });
    expect(readSchema("x")).toEqual({});
    expect(pickType(s.t)).toBe("string");
    expect(pickColumns(s.a)).toEqual({});
  });

  it("walks to a nested level by column names", () => {
    expect(schemaAt(s, ["t", "deep"])).toEqual({ d: "date" });
    expect(schemaAt(s, ["t", "missing"])).toEqual({});
  });

  it("sets, renames and drops at any depth, pruning what empties and keeping a column's own type", () => {
    expect(withPickType({}, ["x", "y"], "z", "logical")).toEqual({ x: { columns: { y: { columns: { z: "logical" } } } } });
    expect(withPickType(s, ["t", "deep"], "d", undefined).t).toEqual({ type: "string", columns: { h: "number" } });
    expect(withPickType(s, [], "t", undefined).t).toEqual({ columns: { h: "number", deep: { columns: { d: "date" } } } });
    expect(schemaAt(renamePick(s, ["t"], "h", "hours"), ["t"])).toEqual({ hours: "number", deep: { columns: { d: "date" } } });
    expect(dropPick({ t: { columns: { h: "number" } } }, ["t"], "h")).toEqual({});
  });

  it("the top level's types alone, for a flat reader", () => {
    expect(flatTypes(s)).toEqual({ a: "number", t: "string" });
  });
});
