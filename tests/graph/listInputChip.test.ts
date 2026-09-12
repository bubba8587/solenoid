import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ListInputNode } from "../../src/graph/nodes/list";

// The List Input's value box draws the list through ValueDisplay, whose chip opens the
// ordinary list value popup (one element per cell, Row / Column switcher). The card never
// hosts a chip of its own and never rewires the popup: 758a2d70 added a dummy 1x1 table
// chip and a raw-row editor, and every "fix" since broke the popup a new way.
describe("List Input: the plain value box", () => {
  it("emits a rank-1 list: every typed row's values, in row order, as ONE flat list (the author's rule)", () => {
    const n = new ListInputNode();
    const k0 = Object.keys(n.inputs)[0];
    n.stringLiterals[k0] = "1, 2, 3";
    n.stringLiterals[n.addValueInput()] = "3, 4, 5";
    const out = (n as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown } }).data({});
    expect(out.list).toEqual([1, 2, 3, 3, 4, 5]);
  });

  it("the card hosts no ArrayChip and hands ValueDisplay no popup overrides", () => {
    const src = readFileSync("src/graph/components/ListInputNode.tsx", "utf8");
    expect(src).not.toMatch(/<ArrayChip/);
    expect(src).not.toMatch(/popupOverrides/);
    expect(src).toMatch(/<ValueDisplay value=\{data\.cachedList as DisplayValue\} \/>/);
  });
});
