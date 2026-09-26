// [[E15]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";
import { readSetting, requiredSetting } from "../../src/graph/nodes/shared";
import { TakeDropNode, ExpandNode, TableSelectNode } from "../../src/graph/nodes/matrix";
import { RoundNNode } from "../../src/graph/nodes/scalar";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const blank = [null as unknown as number];
const m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

describe("[[E15]] a blank wired into a setting means the setting was left out", () => {
  it("readSetting: unwired uses the typed value, a wired blank overrides it with the left-out value", () => {
    expect(readSetting(undefined, 5, 0)).toBe(5);
    expect(readSetting([7], 5, 0)).toBe(7);
    expect(readSetting(blank, 5, 0)).toBe(0);
  });

  it("requiredSetting: a setting with no default answers #SYNTAX! when blank, wired or not", () => {
    expect(requiredSetting([[1, 2]], undefined, "Row indices")).toEqual([1, 2]);
    for (const v of [requiredSetting(undefined, undefined, "Row indices"), requiredSetting(blank, undefined, "Row indices")]) {
      expect(isSolError(v) && v.code).toBe("#SYNTAX!");
    }
  });

  it("TAKE / DROP cards: a wired blank count keeps that axis instead of blanking the table", () => {
    const take = new TakeDropNode({ op: "take" });
    take.literals.rows = 1;
    expect(take.data({ data: [m], rows: blank, cols: [2] }).result).toEqual([[1, 2], [4, 5], [7, 8]]);
    const drop = new TakeDropNode({ op: "drop" });
    expect(drop.data({ data: [m], rows: blank, cols: [1] }).result).toEqual([[2, 3], [5, 6], [8, 9]]);
  });

  it("EXPAND card: a wired blank size keeps the current size", () => {
    const node = new ExpandNode();
    node.literals.rows = 9;
    expect(node.data({ matrix: [[[1, 2]]], rows: blank, cols: [3], fill: [0] }).result).toEqual([[1, 2, 0]]);
  });

  it("ROUND: a blank digits setting is 0 on the card and in a formula; a blank inside a digits list stays at its spot", () => {
    const node = new RoundNNode();
    node.literals.digits = 2;
    expect(node.data({ value: [1.567], digits: blank }).result).toBe(2);
    expect(node.data({ value: [[1.567, 1.567]], digits: [[1, null as unknown as number]] }).result).toEqual([1.6, null]);
    expect(ev("ROUND(1.567, d)", { d: null })).toBe(2);
  });

  it("CHOOSEROWS: the indices have no default, so blank is #SYNTAX!; a blank index picks a blank row there", () => {
    const node = new TableSelectNode({ op: "chooserows" });
    const none = node.data({ matrix: [m] }).result;
    expect(isSolError(none) && none.code).toBe("#SYNTAX!");
    const wired = node.data({ matrix: [m], indices: [null as unknown as number[]] }).result;
    expect(isSolError(wired) && wired.code).toBe("#SYNTAX!");
    expect(node.data({ matrix: [m], indices: [[3, null as unknown as number]] }).result).toEqual([[7, 8, 9], [null, null, null]]);
    const f = ev("CHOOSEROWS(m, r)", { m, r: null });
    expect(isSolError(f) && f.code).toBe("#SYNTAX!");
    expect(ev("CHOOSECOLS(m, c)", { m, c: [1, null] })).toEqual([[1, null], [4, null], [7, null]]);
  });

  it("an error in a setting still passes on; blank data still blanks the answer", () => {
    const err = ev("TAKE(m, 1/0, 1)", { m });
    expect(isSolError(err)).toBe(true);
    expect(ev("TAKE(m, 1)", { m: null })).toBeNull();
  });
});
