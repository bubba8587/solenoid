import { describe, it, expect } from "vitest";
import { columnNamesOf } from "../../src/graph/frameShape";
import { columnPickersOf } from "../../src/graph/nodes/columnPickerHook";
import { SortFrameNode, GetColumnNode, JoinNode } from "../../src/graph/nodes/frame";

// B4: the shared column picker's options are pure over the static Shape, and the three
// customer nodes declare which literal names a column of which frame input.

describe("columnNamesOf — the picker's option source (pure over Shape)", () => {
  it("lists the column names in order", () => {
    expect(columnNamesOf({ columns: [{ name: "A", type: "number" }, { name: "B", type: "string" }] }))
      .toEqual(["A", "B"]);
  });

  it("is empty for an unknown (null/undefined) shape → free-text only", () => {
    expect(columnNamesOf(null)).toEqual([]);
    expect(columnNamesOf(undefined)).toEqual([]);
  });

  it("a dynamic shape still lists its known columns (free-text stays open on top)", () => {
    expect(columnNamesOf({ columns: [{ name: "X", type: "number" }], dynamic: true })).toEqual(["X"]);
  });

  it("is pure — same shape, same list", () => {
    const s = { columns: [{ name: "A", type: "number" as const }] };
    expect(columnNamesOf(s)).toEqual(columnNamesOf(s));
  });
});

describe("the three customer nodes declare their column pickers", () => {
  it("Sort: column ← frame", () => {
    expect(columnPickersOf(new SortFrameNode())).toEqual([{ key: "column", frameInput: "frame" }]);
  });
  it("Get Column: name ← frame", () => {
    expect(columnPickersOf(new GetColumnNode())).toEqual([{ key: "name", frameInput: "frame" }]);
  });
  it("Join: leftKey ← left, rightKey ← right", () => {
    expect(columnPickersOf(new JoinNode())).toEqual([
      { key: "leftKey", frameInput: "left" },
      { key: "rightKey", frameInput: "right" },
    ]);
  });
  it("a node without the hook declares nothing", () => {
    expect(columnPickersOf({})).toEqual([]);
  });
});
