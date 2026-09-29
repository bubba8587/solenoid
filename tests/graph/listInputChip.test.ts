// [[D93]] oneTextReading
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ListInputNode } from "../../src/graph/nodes/list";
import { wrapNodeData } from "../../src/graph/coerceInputs";

// The List Input's value box draws the list through ValueDisplay, whose chip opens the
// ordinary list value popup (one element per cell, Row / Column switcher). The card never
// hosts a chip of its own and never makes the popup an editor: 758a2d70 added a dummy 1x1
// table chip and a raw-row editor, and every "fix" since broke the popup a new way. The one
// thing it hands the popup is the typed text, for the Source view.
describe("List Input: the plain value box", () => {
  it("emits a rank-1 list: every typed row's values, in row order, as ONE flat list (the author's rule)", () => {
    const n = new ListInputNode();
    const k0 = Object.keys(n.inputs)[0];
    n.stringLiterals[k0] = "1, 2, 3";
    n.stringLiterals[n.addValueInput()] = "3, 4, 5";
    const out = (n as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown } }).data({});
    expect(out.list).toEqual([1, 2, 3, 3, 4, 5]);
  });

  it("the card hosts no ArrayChip and hands the popup only its typed text", () => {
    const src = readFileSync("src/graph/components/ListInputNode.tsx", "utf8");
    expect(src).not.toMatch(/<ArrayChip/);
    expect(src).not.toMatch(/onSaveRaw|onSaveSource|editable/);
    expect(src).toMatch(/popupOverrides=\{[^}]*\{ sourceCells: \[data\.cachedSource\] \}/);
  });

  it("keeps each typed item's text beside its value, so Source shows what was typed", () => {
    const n = new ListInputNode({ dataType: "date" });
    const k0 = Object.keys(n.inputs)[0];
    n.stringLiterals[k0] = "2024, 2025, 01-Jan-2026";
    const k1 = n.addValueInput();
    const out = (n as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown } }).data({ [k1]: [[46024]] });
    expect(out.list).toEqual([2024, 2025, 46023, 46024]);
    expect(n.cachedSource).toEqual(["2024", "2025", "01-Jan-2026", null]);
  });

  it("reads its typed text itself inside the engine, where the input wrapper would parse it first", () => {
    const n = new ListInputNode({ dataType: "date" });
    n.stringLiterals[Object.keys(n.inputs)[0]] = "2024, abc";
    wrapNodeData(n as unknown as Parameters<typeof wrapNodeData>[0]);
    const out = (n as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown } }).data({});
    expect(out.list).toEqual([2024, NaN]);
    expect(n.cachedSource).toEqual(["2024", "abc"]);
  });
});
