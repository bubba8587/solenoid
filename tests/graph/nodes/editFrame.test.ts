// [[C58]] tableInputRawText: Edit Frame (`tree/specs/computation/edit-frame.md`)
import { describe, it, expect } from "vitest";
import { EditFrameNode } from "../../../src/graph/nodes/frame";
import { extractInit } from "../../../src/graph/nodeInit";
import { changedCells } from "../../../src/graph/components/editFramePopup";
import { isFrameValue, type FrameValue, type FrameColType } from "../../../src/graph/frame";
import { isSolError } from "../../../src/graph/errorValue";

type Col = [string, FrameColType, unknown[]];
const frame = (...cols: Col[]): FrameValue =>
  ({ __frame: true, columns: cols.map(([name, type, values]) => ({ name, type, values })) }) as unknown as FrameValue;

const tasks = () => frame(
  ["path", "string", ["a.md", "a.md", "b.md"]],
  ["task", "string", ["Call Bob", "Send deck", "Call Bob"]],
  ["line", "number", [3, 4, 7]],
  ["done", "logical", [false, false, true]],
);

function run(n: EditFrameNode, f: FrameValue | null = tasks()) {
  const out = n.data({ frame: [f] }) as { frame: unknown; edits: unknown };
  return out;
}
const col = (f: unknown, name: string) => {
  if (!isFrameValue(f)) throw new Error("not a frame");
  return f.columns.find((c) => c.name === name)!.values;
};

describe("Edit Frame", () => {
  it("passes the table through unchanged with no edits", () => {
    const n = new EditFrameNode();
    const out = run(n);
    expect(col(out.frame, "done")).toEqual([false, false, true]);
    expect(n.rowKeys).toEqual(["1", "2", "3"]);
    expect(col(out.edits, "status")).toEqual([]);
  });

  it("finds a row by its key and types the cell by its column", () => {
    const n = new EditFrameNode({ cellEdits: [
      { row: "a.md · Send deck", column: "done", value: "TRUE" },
      { row: "a.md · Send deck", column: "line", value: "9" },
    ] });
    n.stringLiterals.key = "path, task";
    const out = run(n);
    expect(col(out.frame, "done")).toEqual([false, true, true]);
    expect(col(out.frame, "line")).toEqual([3, 9, 7]);
    expect(n.rowKeys).toEqual(["a.md · Call Bob", "a.md · Send deck", "b.md · Call Bob"]);
    expect(col(out.edits, "column")).toEqual(["done", "line"]);
    expect(col(out.edits, "row")).toEqual(["a.md · Send deck", "a.md · Send deck"]);
    expect(col(out.edits, "previous")).toEqual(["FALSE", "4"]);
    expect(col(out.edits, "new")).toEqual(["TRUE", "9"]);
    expect(col(out.edits, "status")).toEqual(["applied", "applied"]);
  });

  it("follows its row when the table above reorders", () => {
    const n = new EditFrameNode({ cellEdits: [{ row: "b.md · Call Bob", column: "done", value: "FALSE" }] });
    n.stringLiterals.key = "path, task";
    const moved = frame(
      ["path", "string", ["b.md", "a.md"]],
      ["task", "string", ["Call Bob", "Call Bob"]],
      ["done", "logical", [true, false]],
    );
    expect(col(run(n, moved).frame, "done")).toEqual([false, false]);
  });

  it("shows an edit whose row is gone or shared as changing nothing, and keeps it", () => {
    const n = new EditFrameNode({ cellEdits: [
      { row: "z.md · Gone", column: "done", value: "TRUE" },
      { row: "Call Bob", column: "done", value: "TRUE" },
      { row: "a.md · Call Bob", column: "nope", value: "1" },
    ] });
    n.stringLiterals.key = "path, task";
    let out = run(n);
    expect(n.editStatus).toEqual(["stale", "stale", "stale"]);
    n.stringLiterals.key = "task";
    out = run(n);
    expect(n.editStatus).toEqual(["stale", "ambiguous", "stale"]);
    expect(col(out.frame, "done")).toEqual([false, false, true]);
    expect(n.cellEdits).toHaveLength(3);
    expect(col(out.edits, "status")).toEqual(["stale", "ambiguous", "stale"]);
  });

  it("drops an edit the table now gives on its own", () => {
    const n = new EditFrameNode({ cellEdits: [
      { row: "b.md · Call Bob", column: "done", value: "TRUE" },
      { row: "a.md · Call Bob", column: "done", value: "TRUE" },
    ] });
    n.stringLiterals.key = "path, task";
    const out = run(n);
    expect(col(out.frame, "done")).toEqual([true, false, true]);
    expect(col(out.edits, "row")).toEqual(["a.md · Call Bob"]);
    expect(n.cellEdits).toEqual([{ row: "a.md · Call Bob", column: "done", value: "TRUE" }]);
  });

  it("refuses a key column the table doesn't have", () => {
    const n = new EditFrameNode();
    n.stringLiterals.key = "path, nothing";
    let threw: unknown = null;
    try { run(n); } catch (e) { threw = e; }
    expect(isSolError(threw) && threw.code).toBe("#REF!");
  });

  it("answers nothing for nothing wired", () => {
    const n = new EditFrameNode();
    expect(run(n, null)).toEqual({ frame: null, edits: null });
  });

  it("reads a typed date as its day", () => {
    const n = new EditFrameNode({ cellEdits: [{ row: "1", column: "due", value: "05-Mar-2026" }] });
    const out = run(n, frame(["due", "date", [null]]));
    expect(col(out.frame, "due")).toEqual([46086]);
    expect(col(out.edits, "new")).toEqual(["05-Mar-2026"]);
  });

  it("keeps its edits through a save", () => {
    const n = new EditFrameNode({ cellEdits: [{ row: "1", column: "done", value: "TRUE" }] });
    const init = extractInit(n) as { cellEdits?: unknown };
    expect(init.cellEdits).toEqual([{ row: "1", column: "done", value: "TRUE" }]);
    expect(new EditFrameNode(init as never).cellEdits).toEqual(n.cellEdits);
    expect(extractInit(new EditFrameNode()).cellEdits).toBeUndefined();
  });

  it("sets an edit on a cell once, a second change replacing the first", () => {
    const n = new EditFrameNode();
    n.setCellEdits([{ row: "1", column: "done", value: "TRUE" }]);
    n.setCellEdits([{ row: "1", column: "done", value: "FALSE" }, { row: "2", column: "done", value: "TRUE" }]);
    expect(n.cellEdits).toEqual([{ row: "1", column: "done", value: "FALSE" }, { row: "2", column: "done", value: "TRUE" }]);
    n.removeCellEdit(0);
    expect(n.cellEdits).toEqual([{ row: "2", column: "done", value: "TRUE" }]);
  });

  it("saves from the popup only the cells that changed", () => {
    const seed = [["a", "FALSE"], ["b", "TRUE"]];
    expect(changedCells(seed, [["a", "TRUE"], ["b", "TRUE"]], ["k1", "k2"], ["task", "done"]))
      .toEqual([{ row: "k1", column: "done", value: "TRUE" }]);
  });
});
