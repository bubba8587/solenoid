// A range function's one-value arguments lift over a list, as in Excel (formula-language § Range functions).
import { describe, it, expect } from "vitest";
import { compileEvaluator, RANGE_FUNCTIONS, RANGE_SCALAR_ARGS } from "../../src/graph/excelFormula";
import { CubeInputNode } from "../../src/graph/nodes/cube";

const env = { x: [5, 1, 9, 3, 7, 2], y: [10, 2, 18, 6, 14, 4] };
const ev = (f: string) => compileEvaluator(f)!(env as never);

describe("a list where a range function takes one value", () => {
  it.each([
    ["LARGE(x, SEQUENCE(3))", [9, 7, 5]],
    ["SMALL(x, SEQUENCE(2))", [1, 2]],
    ["PERCENTILE.INC(x, SEQUENCE(3) / 4)", [2.25, 4, 6.5]],
    ["PERCENTILE.EXC(x, SEQUENCE(3) / 4)", [1.75, 4, 7.5]],
    ["QUARTILE(x, SEQUENCE(3))", [2.25, 4, 6.5]],
    ["PERCENTRANK(x, SEQUENCE(3) * 2)", [0.2, 0.5, 0.7]],
    ["FORECAST.LINEAR(SEQUENCE(2) + 10, y, x)", [22, 24]],
    ["COUNTIF(x, SEQUENCE(3))", [1, 1, 1]],
    ["COUNTIFS(x, SEQUENCE(3))", [1, 1, 1]],
    ["SUMIFS(y, x, SEQUENCE(3))", [2, 4, 6]],
    ["TRIMMEAN(x, SEQUENCE(2) / 10)", [4.5, 4.5]],
  ])("%s", (f, want) => expect(ev(f)).toEqual(want));

  it("each item answers on its own: RANK of a value not in the list is #N/A there", () => {
    const r = ev("RANK(SEQUENCE(3) * 2, x)") as unknown[];
    expect(r[0]).toBe(5);
    expect(r[1]).toMatchObject({ code: "#N/A" });
  });

  it("the answer takes the lifted argument's shape", () => {
    expect(ev("LARGE(x, TOCOL(SEQUENCE(2)))")).toEqual([[9], [7]]);
    expect(ev("LARGE(x, SEQUENCE(1, 2))")).toEqual([[9, 7]]);
  });

  it("a scalar argument still reads the whole range", () => {
    expect(ev("LARGE(x, 2)")).toBe(7);
    expect(ev("COUNTIF(x, \">4\")")).toBe(3);
  });

  it("per row in a Cube formula column", () => {
    const text = JSON.stringify({ columns: [{ name: "s", type: "number" }, { name: "top", expr: "LARGE(@s, SEQUENCE(COUNT(@s) - 1))" }],
      rows: [{ s: [3, 9, 1, 7] }, { s: [4, 2] }] });
    const cube = new CubeInputNode({ cubeText: text }).data().cube as { columns: { name: string; cells: unknown[] }[] };
    expect(cube.columns.find((c) => c.name === "top")!.cells).toEqual([[9, 7, 3], 4]);
  });
});

describe("LARGE and SMALL's k", () => {
  it("below 1 is a wrong input; past the count is not enough data ([[D70]] nullNotEnoughData)", () => {
    expect(ev("LARGE(x, 0)")).toMatchObject({ code: "#DOMAIN!" });
    expect(ev("SMALL(x, -1)")).toMatchObject({ code: "#DOMAIN!" });
    expect(ev("LARGE(x, 99)")).toBeNull();
  });
});

it("every declared one-value argument belongs to a range function", () => {
  for (const name of Object.keys(RANGE_SCALAR_ARGS)) expect(RANGE_FUNCTIONS.has(name), name).toBe(true);
});
