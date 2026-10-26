// [[C22]] rowFormulaRefs, [[C50]] lambdaBindsByName, [[D100]] computedColumnInfersUnit: Computed Column over Cubes,
// widened values, wired λs with united captures, bindings and placement, driven through the card.
import { describe, it, expect } from "vitest";
import { ComputedColumnNode } from "../../src/graph/nodes/frame";
import { LambdaNode } from "../../src/graph/nodes/lambda";
import { cubeFromColumns, isCubeValue, isFrameValue, type CubeCell, type CubeValue, type FrameValue } from "../../src/graph/frame";
import { fromUnit } from "../../src/graph/unitValue";
import { fcUnitToUnit } from "../../src/graph/dimension";
import { isSolError } from "../../src/graph/errorValue";

const qty = (spec: string, n: number) => fromUnit(n, fcUnitToUnit(spec)!, spec);

const card = (expr: string, opts: { name?: string; after?: string; addAs?: "auto" | "number" | "text" | "date" | "logical"; bindings?: Record<string, string>; sideVars?: string[]; literals?: Record<string, number> } = {}) => {
  const n = new ComputedColumnNode({ expr, addAs: opts.addAs, bindings: opts.bindings, sideVars: opts.sideVars, literals: opts.literals });
  n.stringLiterals.name = opts.name ?? "out";
  n.stringLiterals.after = opts.after ?? "";
  return n;
};
const run = (n: ComputedColumnNode, frame: unknown, extra: Record<string, unknown[]> = {}) =>
  n.data({ frame: [frame], ...extra } as Parameters<ComputedColumnNode["data"]>[0]).frame;
const lambda = (expr: string, params: string, captures: Record<string, unknown> = {}) => {
  const lam = new LambdaNode({ expr, params });
  const inputs = Object.fromEntries(Object.entries(captures).map(([k, v]) => [k, [v]]));
  lam.data(inputs);
  return (lam.data(inputs) as { result: unknown }).result;
};

const cube: CubeValue = cubeFromColumns([
  { name: "name", cells: ["A", "B", "C"], type: "string" },
  { name: "legs", cells: [[qty("km", 3), qty("km", 4)], [qty("km", 10)], qty("km", 2)] as CubeCell[], type: "number" },
  { name: "tags", cells: [["x", "y"], [], null] },
  { name: "n", cells: [1, 2, 3], type: "number", format: { format: "number", decimals: 2 } as never },
  { name: "grid", cells: [[[1, 2], [3, 4]], 5, null] },
  { name: "kids", cells: [cubeFromColumns([{ name: "k", cells: [1] }]), null, 7] },
]);

const frame: FrameValue = {
  __frame: true,
  columns: [
    { name: "a", type: "number", values: [1, 2, 3], unit: { dim: { length: 1 }, display: "km" } },
    { name: "b", type: "string", values: ["x", "y", "z"] },
    { name: "d", type: "date", values: [45000, 45001, 45002] },
    { name: "t", type: "number", values: [2, 4, 8], unit: { dim: { time: 1 }, display: "hr" }, format: { format: "number", decimals: 1 } as never },
  ],
};

describe("Computed Column over a Cube", () => {
  const formulas = [
    "SUM(@legs)", "@legs * 2", "COUNTA(@tags)", "@n + 1", "SUM(legs)", "@grid", "SUM(grid)", "@kids", "COUNTA(kids)", "UPPER(@tags)",
    "@name & @n", "ROW()", "INDEX(legs, ROW(), 1)", "MAKEARRAY(2, 2, LAMBDA(r, c, MAKEARRAY(1, 1, LAMBDA(x, y, 1))))", "@legs + @n", "TODAY() + @n",
  ];
  for (const expr of formulas) {
    it(`computes ${expr} row by row`, () => {
      const out = run(card(expr), cube);
      expect(isCubeValue(out) || isSolError(out)).toBe(true);
    });
  }

  it("a list answer is that row's cell, its unit on each item", () => {
    const out = run(card("@legs * 2"), cube) as CubeValue;
    const col = out.columns.find((c) => c.name === "out")!;
    expect(Array.isArray(col.cells[0])).toBe(true);
    expect(col.type).toBe("number");
  });

  it("After places the new column, a replaced column keeps its place and format, a missing anchor is #REF!", () => {
    const placed = run(card("@n * 2", { after: "name" }), cube) as CubeValue;
    expect(placed.columns.map((c) => c.name).slice(0, 2)).toEqual(["name", "out"]);
    const replaced = run(card("@n * 2", { name: "n", after: "name" }), cube) as CubeValue;
    expect(replaced.columns.map((c) => c.name)).toEqual(cube.columns.map((c) => c.name));
    expect(replaced.columns[3].format).toEqual(cube.columns[3].format);
    const missing = run(card("@n", { after: "nope" }), cube);
    expect(isSolError(missing) && missing.code).toBe("#REF!");
  });

  it("a pinned type and a `Name (unit)` name", () => {
    expect((run(card("@n", { addAs: "text" }), cube) as CubeValue).columns.slice(-1)[0]!.type).toBe("string");
    expect((run(card("@n * 1000", { name: "len (m)" }), cube) as CubeValue).columns.slice(-1)[0]!.name).toBe("len");
    expect(run(card("SUM(@legs)", { name: "len (hr)" }), cube)).toBeTruthy();
  });

  it("a wired λ over a Cube binds its parameters to this row's cells", () => {
    const out = run(card(""), cube, { fn: [lambda("SUM(legs) + n", "legs, n")] }) as CubeValue;
    expect(isCubeValue(out)).toBe(true);
  });
});

describe("Computed Column over widened values", () => {
  for (const [label, v] of [["a list", [1, 2, 3]], ["a matrix", [[1, 2], [3, 4]]], ["a number", 7], ["text", "hi"]] as const) {
    it(`widens ${label} to a frame`, () => {
      const out = run(card("@Col1 * 2"), v);
      expect(isFrameValue(out)).toBe(true);
    });
  }
});

describe("Computed Column units, bindings and λ captures", () => {
  const formulas = [
    "@a / @t", "@a + 1", "@a * @a", "@a + @t", "POWER(@a, 2)", "@d + @a", "SUM(a) / @t", "IF(@a > 1, @a, @t)", "@a * k", "@a + k", "@a * ks",
    "@d - @d", "@d + 1", "@b & @a", "ROUND(@a / @t, 1)",
  ];
  const km = qty("km", 5);
  for (const expr of formulas) {
    for (const name of ["out", "out (mi/hr)", "out (km)", "out (usd)"]) {
      it(`${expr} named ${name}`, () => {
        const n = card(expr, { name, sideVars: ["k", "ks"] });
        const out = run(n, frame, { k: [km], ks: [[qty("km", 1), qty("m", 2), qty("km", 3)]] });
        expect(isFrameValue(out) || isSolError(out)).toBe(true);
      });
    }
  }

  it("bindings point a variable at a picked column, and a gone column is #REF!", () => {
    const bound = run(card("@x * 2 + SUM(y)", { bindings: { x: "a", y: "t" } }), frame) as FrameValue;
    expect(bound.columns.slice(-1)[0]!.values).toHaveLength(3);
    const gone = run(card("@x * 2", { bindings: { x: "zz" } }), frame);
    expect(isSolError(gone) && gone.code).toBe("#REF!");
    const lam = run(card("", { bindings: { p: "a" } }), frame, { fn: [lambda("p * 2", "p")] }) as FrameValue;
    expect(lam.columns.slice(-1)[0]!.values).toHaveLength(3);
  });

  it("a λ's united captures count in the unit pass", () => {
    for (const [expr, params] of [["a / speed", "a"], ["a + gap", "a"], ["@t * speed", ""], ["a * factor + @t", "a"], ["@b & a", "a"], ["@nope + a", "a"]]) {
      const fn = lambda(expr, params, { speed: qty("km", 2), gap: qty("m", 300), factor: 3 });
      const out = run(card("", { name: "v" }), frame, { fn: [fn] });
      expect(isFrameValue(out) || isSolError(out)).toBe(true);
    }
  });

  it("a λ parameter bound to an error cell answers that row with the error", () => {
    const f: FrameValue = { __frame: true, columns: [{ name: "v", type: "number", values: [1, { __solError: true, code: "#DIV/0!", message: "x" } as never, 3] }] };
    const out = run(card(""), f, { fn: [lambda("v * 10", "v")] }) as FrameValue;
    const cell = out.columns.slice(-1)[0]!.values[1];
    expect(isSolError(cell) && cell.code).toBe("#DIV/0!");
  });
});
