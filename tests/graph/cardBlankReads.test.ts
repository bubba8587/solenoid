// [[C10]] socketLattice, [[C80]] blankArgIsExcelBlank: a card reads 0 and FALSE as values, never as nothing wired, and
// never reads text as a number.
import { it, expect } from "vitest";
import { RandArrayNode } from "../../src/graph/nodes/list";
import { isSolError } from "../../src/graph/errorValue";

it("RANDARRAY's Min and Max are numbers: text is #VALUE!, never glued onto the draws", () => {
  const n = new RandArrayNode();
  const r = n.data({ count: [3], min: ["a"], max: [5] }).list;
  expect(isSolError(r) && r.code).toBe("#VALUE!");
  const ok = new RandArrayNode().data({ count: [3], min: [0], max: [1] }).list as number[];
  expect(ok.every((x) => typeof x === "number" && x >= 0 && x <= 1)).toBe(true);
});
