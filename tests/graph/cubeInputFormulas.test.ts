// [[C22]] rowFormulaRefs: Cube Input's formula columns over list, grid and table cells, driven through the card.
import { describe, it, expect } from "vitest";
import { CubeInputNode } from "../../src/graph/nodes/cube";
import { isCubeValue, type CubeValue } from "../../src/graph/frame";
import { isSolError } from "../../src/graph/errorValue";

const cubeOf = (columns: object[], rows: object[]): CubeValue => {
  const out = new CubeInputNode({ cubeText: JSON.stringify({ columns, rows }) }).data().cube;
  if (!isCubeValue(out)) throw new Error(`expected a cube, got ${JSON.stringify(out)}`);
  return out;
};
const col = (cube: CubeValue, name: string) => cube.columns.find((c) => c.name === name)!;

const rows = [
  { name: "A", s: [3, 9, 1, 7], t: ["x", "y"], n: 2, d: "2026-09-01", ok: true, g: [[1, 2], [3, 4]] },
  { name: "B", s: [4, 2], t: [], n: 5, d: "2026-09-03", ok: false, g: [[5]] },
  { name: "C", s: 6, t: ["z"], n: null, d: null, ok: true, g: 7 },
  { name: "D", s: null, t: null, n: -1, d: "2026-10-10", ok: null, g: null },
];
const typed = [{ name: "name", type: "string" }, { name: "s", type: "number" }, { name: "t" }, { name: "n", type: "number" }, { name: "d", type: "date" }, { name: "ok", type: "logical" }, { name: "g" }];

describe("Cube Input formula columns", () => {
  it("reads this row's list with @ and its whole column stacked", () => {
    const cube = cubeOf([...typed, { name: "top", expr: "LARGE(@s, 1)" }, { name: "all", expr: "SUM(s)" }, { name: "share", expr: "SUM(@s) / SUM(s)" }], rows);
    expect(col(cube, "top").cells).toEqual([9, 4, 6, null]);
    expect(col(cube, "all").cells).toEqual([32, 32, 32, 32]);
    expect((col(cube, "share").cells[0] as number).toFixed(4)).toBe("0.6250");
  });

  it("a row may answer a list, typed by its items", () => {
    const cube = cubeOf([...typed, { name: "sorted", expr: "SORT(@s)" }, { name: "up", expr: "UPPER(@t)" }, { name: "twice", expr: "@s * 2" }], rows);
    expect(col(cube, "sorted").cells[0]).toEqual([3, 9, 1, 7]);
    expect(col(cube, "sorted").type).toBe("number");
    expect(col(cube, "up").cells[0]).toEqual(["X", "Y"]);
    expect(col(cube, "up").type).toBe("string");
    expect(col(cube, "twice").cells[1]).toEqual([8, 4]);
  });

  it("grids, deeper answers, NaN and errors are per row", () => {
    const cube = cubeOf([...typed, { name: "gg", expr: "@g" }, { name: "deep", expr: "MAKEARRAY(2, 2, LAMBDA(r, c, r * c))" }, { name: "root", expr: "SQRT(@n)" }, { name: "inv", expr: "1 / @n" }], rows);
    expect(col(cube, "gg").cells[0]).toEqual([[1, 2], [3, 4]]);
    expect(col(cube, "deep").cells[0]).toEqual([[1, 2], [2, 4]]);
    const root = col(cube, "root").cells;
    expect(isSolError(root[3])).toBe(true);
    expect(col(cube, "inv").cells[0]).toBe(0.5);
  });

  it("a whole read of a column with a grid in a row is #SHAPE!, and its @ still reads", () => {
    const cube = cubeOf([...typed, { name: "w", expr: "ROWS(g)" }, { name: "c", expr: "COUNT(@g)" }], rows);
    const w = col(cube, "w").cells[0];
    expect(isSolError(w) && w.code).toBe("#SHAPE!");
    expect(col(cube, "c").cells).toEqual([4, 1, 1, 0]);
  });

  it("a nested table is #SHAPE! on its own row", () => {
    const cube = cubeOf([{ name: "k" }, { name: "kids" }, { name: "n", expr: "COUNTA(@kids)" }, { name: "all", expr: "COUNTA(kids)" }],
      [{ k: 1, kids: [{ a: 1 }, { a: 2 }] }, { k: 2, kids: [5, 6] }, { k: 3, kids: null }]);
    const n = col(cube, "n").cells;
    expect(isSolError(n[0]) && n[0].code).toBe("#SHAPE!");
    expect(n[1]).toBe(2);
    const all = col(cube, "all").cells[0];
    expect(isSolError(all) && all.code).toBe("#SHAPE!");
  });

  it("types: dates stay dates, text keeps text, logicals read", () => {
    const cube = cubeOf([...typed, { name: "next", expr: "@d + 1" }, { name: "gap", expr: "@d - @d" }, { name: "label", expr: "@name & \"-\" & @n" },
      { name: "flag", expr: "IF(@ok, \"yes\", \"no\")" }, { name: "when", expr: "IF(@ok, @d, @d + 7)" }, { name: "num", expr: "ROW()" }], rows);
    expect(col(cube, "next").type).toBe("date");
    expect(col(cube, "gap").type).toBe("number");
    expect(col(cube, "label").cells[0]).toBe("A-2");
    expect(col(cube, "flag").cells).toEqual(["yes", "no", "yes", null]);
    expect(col(cube, "when").type).toBe("date");
    expect(col(cube, "num").cells).toEqual([1, 2, 3, 4]);
  });

  it("an untyped column of numbers in text reads by inference; a text column keeps 5 as text", () => {
    const cube = cubeOf([{ name: "a" }, { name: "b", type: "string" }, { name: "x", expr: "@a + 1" }, { name: "y", expr: "ISTEXT(@b)" }, { name: "z", expr: "LEN(@b)" }],
      [{ a: "5", b: 5 }, { a: 7, b: "seven" }, { a: "", b: null }]);
    expect(col(cube, "x").cells.slice(0, 2)).toEqual([6, 8]);
    expect(col(cube, "y").cells.slice(0, 2)).toEqual([true, true]);
  });

  it("formula columns order by what they read, and cycles, misses, blanks and bad formulas say so", () => {
    const cube = cubeOf([{ name: "v" }, { name: "c", expr: "@b * 2" }, { name: "b", expr: "@v + 1" }, { name: "loop1", expr: "@loop2" }, { name: "loop2", expr: "loop1" },
      { name: "self", expr: "@self + 1" }, { name: "miss", expr: "@nope" }, { name: "bare", expr: "nope" }, { name: "blank", expr: "  " }, { name: "bad", expr: "SUM(" },
      { name: "res", expr: "@[two words] & \"!\"" }, { name: "two words" }], [{ v: 1, "two words": "hi" }, { v: 2, "two words": "yo" }]);
    expect(col(cube, "c").cells).toEqual([4, 6]);
    const loop = col(cube, "loop1").cells[0];
    expect(isSolError(loop) && loop.message).toContain("Circular");
    expect(isSolError(col(cube, "self").cells[0])).toBe(true);
    const miss = col(cube, "miss").cells[0];
    expect(isSolError(miss) && miss.code).toBe("#REF!");
    expect(isSolError(col(cube, "bare").cells[0])).toBe(true);
    expect(col(cube, "blank").cells).toEqual([null, null]);
    const bad = col(cube, "bad").cells[0];
    expect(isSolError(bad) && bad.message).toBe("The formula does not parse");
    expect(col(cube, "res").cells).toEqual(["hi!", "yo!"]);
  });

  it("whole-column functions and lookups across rows", () => {
    const formulas = [
      "INDEX(s, ROW(), 2)", "MAX(n) - @n", "COUNTIF(n, \">0\")", "SUMPRODUCT(@s, @s)", "AVERAGE(@s)", "FILTER(@s, @s > 3)", "TEXTJOIN(\",\", TRUE, @t)",
      "XLOOKUP(@n, n, name)", "RANK(@n, n)", "SEQUENCE(@n)", "TRANSPOSE(@s)", "@s + @n", "IFERROR(1 / @n, \"none\")", "ISBLANK(@n)", "COUNTA(@t)",
      "MAP(@s, LAMBDA(x, x * 10))", "REDUCE(0, @s, LAMBDA(a, x, a + x))", "LET(k, @n * 2, k + 1)", "CHOOSE(2, @n, @name)", "@g * 2", "SUM(g)", "TAKE(@s, 2)",
      "VSTACK(@s, @n)", "IF(@n > 1, @s, @n)", "NOW() > 0", "@name = \"A\"", "-@s", "@s%", "@s ^ 2", "@ok + 1", "TEXT(@d, \"yyyy\")", "YEAR(@d)",
    ];
    const cube = cubeOf([...typed, ...formulas.map((expr, i) => ({ name: `f${i}`, expr }))], rows);
    for (let i = 0; i < formulas.length; i++) expect(col(cube, `f${i}`).cells).toHaveLength(rows.length);
  });

  it("no rows, no formula columns, and an empty source", () => {
    expect(cubeOf([{ name: "a" }, { name: "f", expr: "@a" }], []).columns.map((c) => c.name)).toEqual(["a", "f"]);
    expect(cubeOf([{ name: "a" }], [{ a: 1 }]).columns[0].cells).toEqual([1]);
    expect(isCubeValue(new CubeInputNode({ cubeText: "" }).data().cube)).toBe(true);
  });
});
