// [[C114]] cardsView
import { describe, expect, it } from "vitest";
import { cubeLevelColumns, statValues } from "../../src/graph/cubeLevelTable";
import { recordsToCube } from "../../src/graph/frame";
import { summarizeColumn } from "../../src/graph/components/tableFooterStats";

describe("cubeLevelColumns", () => {
  const cube = recordsToCube([
    { task: "Design", days: 4, done: true, after: [] },
    { task: "Build", days: 6, done: false, after: ["Design"] },
    { task: "Test", days: null, done: true },
  ]);

  it("types each column, declared or read from its plain cells", () => {
    const t = cubeLevelColumns({ kind: "cube", label: "c", cube })!;
    expect(t.rows).toBe(3);
    expect(Object.fromEntries(t.columns.map((c) => [c.name, c.type]))).toEqual({ task: "string", days: "number", done: "logical", after: "string" });
  });

  it("feeds the footer: a sum over numbers, a nested list counted as filled", () => {
    const t = cubeLevelColumns({ kind: "cube", label: "c", cube })!;
    const days = t.columns.find((c) => c.name === "days")!;
    expect(summarizeColumn(statValues(days), days.type).sum).toBe(10);
    const after = t.columns.find((c) => c.name === "after")!;
    expect(summarizeColumn(statValues(after), after.type).profile.count).toBe(2);
    const done = t.columns.find((c) => c.name === "done")!;
    expect(summarizeColumn(statValues(done), done.type).checked).toBe(2);
  });

  it("marks columns of nested containers, and of flat lists among them", () => {
    const t = cubeLevelColumns({ kind: "cube", label: "c", cube })!;
    const shape = Object.fromEntries(t.columns.map((c) => [c.name, [c.nested, c.lists]]));
    expect(shape).toEqual({ task: [false, false], days: [false, false], done: [false, false], after: [true, true] });
  });

  it("has no table for a list or grid level", () => {
    expect(cubeLevelColumns({ kind: "list", label: "l", items: [1, 2] })).toBeNull();
    expect(cubeLevelColumns({ kind: "grid", label: "g", cells: [[1]] })).toBeNull();
  });
});
