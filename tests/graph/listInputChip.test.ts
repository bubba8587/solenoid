import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ListInputNode } from "../../src/graph/nodes/list";

// The List Input's value is a rank-1 list drawn by the value box's own chip, which also
// opens the editor. A second chip beside the box (a dummy 1x1 table) is the regression
// this pins out (758a2d70 added one; the card read "[1×1 Table]" next to its hero box).
describe("List Input: one chip, inside the box", () => {
  it("emits a rank-1 list, never a 1x1 table", () => {
    const n = new ListInputNode();
    n.stringLiterals[Object.keys(n.inputs)[0]] = "1, 2, 3";
    const out = (n as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown } }).data({});
    expect(out.list).toEqual([1, 2, 3]);
  });

  it("the card hosts no ArrayChip of its own; the editor rides ValueDisplay's popupOverrides", () => {
    const src = readFileSync("src/graph/components/ListInputNode.tsx", "utf8");
    expect(src).not.toMatch(/<ArrayChip/);
    expect(src).toMatch(/<ValueDisplay[^>]*popupOverrides=/);
  });
});

describe("List Input editor round trip", () => {
  it("the editor's initial grid is the node's list, one value per row; a commit round-trips", async () => {
    const { listEditorCells, listRowsFromCells } = await import("../../src/graph/literalEditors");
    const n = new ListInputNode();
    const run = () => (n as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown[] } }).data({}).list;
    n.stringLiterals[Object.keys(n.inputs)[0]] = "1, 2, 3";
    expect(listEditorCells(run(), "number")).toEqual([[1], [2], [3]]);
    n.rewriteRows(listRowsFromCells([["1"], ["2"], ["4"], [""]]));
    expect(Object.keys(n.inputs)).toHaveLength(3);
    expect(run()).toEqual([1, 2, 4]);
    expect(listEditorCells(run(), "number")).toEqual([[1], [2], [4]]);
  });
  it("a date list edits as date text, never as serials", async () => {
    const { listEditorCells } = await import("../../src/graph/literalEditors");
    const { parseDateToSerial } = await import("../../src/graph/nodes/dateSerial");
    const s = parseDateToSerial("2026-01-05");
    expect(listEditorCells([s, null], "date")).toEqual([["05-Jan-2026"], [""]]);
  });
});
