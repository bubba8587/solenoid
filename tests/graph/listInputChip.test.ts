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

describe("List Input editor", () => {
  it("opens as the LIST popup with the typed rows as text (the switcher, copy paths and no-column-sort rule apply)", () => {
    const src = readFileSync("src/graph/components/ListInputNode.tsx", "utf8");
    expect(src).toMatch(/list: true/);
    expect(src).toMatch(/cellType: "string"/);
    expect(src).not.toMatch(/list: false/);
  });
});
