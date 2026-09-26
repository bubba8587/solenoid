// [[D86]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { isSolError } from "../../src/graph/errorValue";
import { readFileSync, readdirSync } from "fs";
import { ARG_ROLES, applyRole, setting, required, picks, LEFT_OUT } from "../../src/graph/inputRoles";
import { resolveExcelFunction, EXCEL_IMPL_META } from "../../src/graph/excelFunctions";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { TakeDropNode, ExpandNode, TableSelectNode } from "../../src/graph/nodes/matrix";
import { RoundNNode } from "../../src/graph/nodes/scalar";
import { ListIndexNode } from "../../src/graph/nodes/list";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const blank = [null as unknown as number];
const m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

describe("[[D86]] blankRoles — data stays blank, a setting left blank is its default, a blank pick is dropped", () => {
  it("every declared function exists, and each declared argument is within its arity", () => {
    for (const [name, roles] of Object.entries(ARG_ROLES)) {
      expect(resolveExcelFunction(name), name).not.toBeNull();
      const max = EXCEL_IMPL_META[name]?.arity?.[1];
      for (const k of Object.keys(roles)) if (k !== "rest" && max !== undefined) expect(Number(k), name).toBeLessThan(max);
    }
  });

  it("every card that declares roles reads each declared socket through readRole", () => {
    const dir = "src/graph/nodes";
    const src = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
    const seen = new Set<string>();
    for (const leaf of FLAT_CATALOG.values()) {
      let cls: { name: string; inputRoles?: Record<string, unknown> };
      try { cls = (leaf.create() as { constructor: typeof cls }).constructor; } catch { continue; }
      if (!cls?.inputRoles || seen.has(cls.name)) continue;
      seen.add(cls.name);
      for (const key of Object.keys(cls.inputRoles)) expect(src, `${cls.name}.${key}`).toMatch(new RegExp(`readRole(<[^>]*>)?\\(this, "${key}"`));
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("applyRole: a setting's blank reads as its default, item by item; errors pass", () => {
    expect(applyRole(setting(0), null, "Digits")).toBe(0);
    expect(applyRole(setting(0), [1, null], "Digits")).toEqual([1, 0]);
    expect(applyRole(setting(LEFT_OUT), null, "Rows")).toBeUndefined();
    const e = applyRole(setting(0), ev("1/0"), "Digits");
    expect(isSolError(e) && e.code).toBe("#DIV/0!");
  });

  it("applyRole: a required setting's blank is #SYNTAX! naming it", () => {
    const e = applyRole(required, null, "Delimiter");
    expect(isSolError(e) && e.message).toMatch(/^Delimiter is blank/);
  });

  it("applyRole: blank picks drop, none left is left out or #SYNTAX!, a blank inside a table of positions is #SYNTAX! there", () => {
    expect(applyRole(picks(), [3, null, 1], "Position")).toEqual([3, 1]);
    expect(applyRole(picks(), [null], "Position")).toBeUndefined();
    const none = applyRole(picks({ required: true }), [null], "Row indices");
    expect(isSolError(none) && none.code).toBe("#SYNTAX!");
    const grid = applyRole(picks(), [[1, null]], "Position") as unknown[][];
    expect(grid[0][0]).toBe(1);
    expect(isSolError(grid[0][1]) && grid[0][1].code).toBe("#SYNTAX!");
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

  it("ROUND: a blank digits setting is 0, whole or item by item, on the card, in a formula and per row", () => {
    const node = new RoundNNode();
    node.literals.digits = 2;
    expect(node.data({ value: [1.567], digits: blank }).result).toBe(2);
    expect(node.data({ value: [[1.567, 1.567]], digits: [[1, null as unknown as number]] }).result).toEqual([1.6, 2]);
    expect(ev("ROUND(1.567, d)", { d: null })).toBe(2);
    expect(ev("ROUND(x, d)", { x: [1.567, 1.567], d: [1, null] })).toEqual([1.6, 2]);
    expect(ev("ROUND(x, 1)", { x: [1.567, null] })).toEqual([1.6, null]);
  });

  it("INDEX: a blank in a list of positions is skipped; a list of only blanks is the whole axis; a blank in a table of positions is #SYNTAX! there", () => {
    const x = [10, 20, 30];
    const t = ev("INDEX(x, p)", { x, p: [[1, null], [3, 2]] }) as unknown[][];
    expect([t[0][0], t[1]]).toEqual([10, [30, 20]]);
    expect(isSolError(t[0][1]) && t[0][1].code).toBe("#SYNTAX!");
    expect(ev("INDEX(x, p)", { x, p: [3, null, 1] })).toEqual([30, 10]);
    expect(ev("INDEX(x, p)", { x, p: [null, null] })).toEqual(x);
    expect(new ListIndexNode().data({ list: [x], index: [[3, null as unknown as number]] }).result).toEqual([30]);
  });

  it("CHOOSEROWS: the indices have no default, so blank is #SYNTAX!; a blank index is skipped", () => {
    const node = new TableSelectNode({ op: "chooserows" });
    const none = node.data({ matrix: [m] }).result;
    expect(isSolError(none) && none.code).toBe("#SYNTAX!");
    const wired = node.data({ matrix: [m], indices: [null as unknown as number[]] }).result;
    expect(isSolError(wired) && wired.code).toBe("#SYNTAX!");
    expect(node.data({ matrix: [m], indices: [[3, null as unknown as number]] }).result).toEqual([[7, 8, 9]]);
    const allBlank = node.data({ matrix: [m], indices: [[null as unknown as number]] }).result;
    expect(ev("CHOOSEROWS(m, a, b)", { m, a: null, b: null })).toMatchObject({ code: "#SYNTAX!" });
    expect(ev("CHOOSEROWS(m, a, 2)", { m, a: null })).toEqual([[4, 5, 6]]);
    expect(isSolError(allBlank) && allBlank.code).toBe("#SYNTAX!");
    const f = ev("CHOOSEROWS(m, r)", { m, r: null });
    expect(isSolError(f) && f.code).toBe("#SYNTAX!");
    expect(ev("CHOOSECOLS(m, c)", { m, c: [1, null] })).toEqual([[1], [4], [7]]);
  });

  it("an error in a setting still passes on; blank data still blanks the answer", () => {
    const err = ev("TAKE(m, 1/0, 1)", { m });
    expect(isSolError(err)).toBe(true);
    expect(ev("TAKE(m, 1)", { m: null })).toBeNull();
  });
});

describe("[[D86]] the settings sweep: formulas", () => {
  const isSyntax = (v: unknown) => isSolError(v) && v.code === "#SYNTAX!";
  it("a blank mode is Excel's typed blank when that works, #SYNTAX! when nothing does", () => {
    expect(ev("NORM.DIST(1, 0, 1, c)", { c: null })).toBeCloseTo(ev("NORM.DIST(1, 0, 1, FALSE)") as number, 12);
    expect(isSyntax(ev("MAKEARRAY(r, 3, LAMBDA(i, j, i))", { r: null }))).toBe(true);
    expect(isSyntax(ev("MID(\"abc\", s, 1)", { s: null }))).toBe(true);
  });
  it("an optional setting left blank is the omitted argument", () => {
    expect(ev("LEFT(\"abc\", n)", { n: null })).toBe("a");
    expect(ev("LOG(100, b)", { b: null })).toBeCloseTo(2, 12);
    expect(ev("CLAMP(-5, lo, 3)", { lo: null })).toBe(-5);
  });
  it("a distribution's parameter is data, so a blank one is a blank answer", () => {
    expect(ev("NORM.DIST(1, m, 1, TRUE)", { m: null })).toBeNull();
  });
});
