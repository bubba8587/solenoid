// [[C25]] firstClassUnits, [[C16]] polarsEngine: readings on an offset scale (°C, °F) through
// the frame and cube verbs answer as a formula does. Both engines are held to the values by
// the corpus (fixtures/frame-verbs, `readingScale`); this file pins the units and the lowering.
import { describe, it, expect } from "vitest";
import { applyVerb, groupByFrame, pivotFrame, windowFrame, windowCube, withReadingScales, type FrameOp } from "../../src/graph/frameVerbs";
import { lowerForEngine } from "../../src/graph/frameBackend";
import { columnUnitFromSpec } from "../../src/graph/unitColumn";
import { isSolError } from "../../src/graph/errorValue";
import { isUnitCell, READINGS_ADD, type UnitCell } from "../../src/graph/unitValue";
import { cubeFromColumns, frameToCube, type FrameColumn, type FrameValue } from "../../src/graph/frame";
import { CubeRollupNode } from "../../src/graph/nodes/cube";
import { GetColumnNode } from "../../src/graph/nodes/frame";
import { AggregateNode } from "../../src/graph/nodes/list";

const unit = (spec: string) => columnUnitFromSpec(spec)!;
const frame = (...columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const temps = (spec: string) => frame(
  { name: "k", type: "string", values: ["a", "a", "b"] },
  { name: "t", type: "number", values: [20, 26, 30], unit: unit(spec) },
);
const col = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)!;
const K = { dim: { temperature: 1 } };

describe("GROUPBY over readings", () => {
  const out = groupByFrame(temps("degC"), ["k"], ["sum", "product", "avg", "min", "median", "mode", "count", "stdevp", "varp"].map((op) => ({ column: "t", op: op as never, as: op })));

  it("a sum or product is #UNIT! in every group and carries no unit", () => {
    for (const name of ["sum", "product"]) {
      expect(col(out, name).values.every((v) => isSolError(v) && v.code === "#UNIT!")).toBe(true);
      expect(col(out, name).unit).toBeUndefined();
    }
    expect((col(out, "sum").values[0] as { message?: string }).message).toBe(READINGS_ADD);
  });

  it("the averages and picks stay readings in °C; count is plain", () => {
    for (const name of ["avg", "min", "median", "mode"]) expect(col(out, name).unit?.display).toBe("degC");
    expect(col(out, "avg").values).toEqual([23, 30]);
    expect(col(out, "count").unit).toBeUndefined();
  });

  it("a spread is a delta in kelvin and var a squared one", () => {
    expect(col(out, "stdevp").unit).toEqual(K);
    expect(col(out, "stdevp").values).toEqual([3, 0]);
    expect(col(out, "varp").unit).toEqual({ dim: { temperature: 2 } });
    expect(col(out, "varp").values).toEqual([9, 0]);
  });

  it("a °F spread converts to kelvin", () => {
    const f = groupByFrame(temps("degF"), ["k"], [{ column: "t", op: "stdevp", as: "s" }, { column: "t", op: "varp", as: "v" }]);
    expect(col(f, "s").values[0]).toBeCloseTo(3 * 5 / 9, 12);
    expect(col(f, "v").values[0]).toBeCloseTo(9 * 25 / 81, 12);
    expect(col(f, "s").unit).toEqual(K);
  });

  it("a linear unit is untouched: a km sum stays km, and so does the mode", () => {
    const f = groupByFrame(temps("km"), ["k"], [{ column: "t", op: "sum", as: "s" }, { column: "t", op: "mode", as: "m" }]);
    expect(col(f, "s").values).toEqual([46, 30]);
    expect(col(f, "s").unit?.display).toBe("km");
    expect(col(f, "m").unit?.display).toBe("km");
  });
});

describe("PIVOTBY over readings", () => {
  it("SUM is #UNIT!, AVERAGE stays °C", () => {
    const sum = pivotFrame(temps("degC"), { rowFields: ["k"], colFields: [], values: ["t"], funcs: ["sum"] } as never);
    expect(sum.columns[1].values.every((v) => isSolError(v) && v.code === "#UNIT!")).toBe(true);
    const avg = pivotFrame(temps("degC"), { rowFields: ["k"], colFields: [], values: ["t"], funcs: ["avg"] } as never);
    expect(avg.columns[1].values).toEqual([23, 30]);
    expect(avg.columns[1].unit?.display).toBe("degC");
  });
});

describe("Window over readings", () => {
  const w = (fn: string, spec = "degC") => col(windowFrame(temps(spec), { partitionBy: [], fn: fn as never, column: "t", as: "out", n: 2 }), "out");

  it("diff is a delta in kelvin", () => {
    expect(w("diff").values).toEqual([null, 6, 4]);
    expect(w("diff").unit).toEqual(K);
    expect(w("diff", "degF").values[1]).toBeCloseTo(6 * 5 / 9, 12);
  });

  it("the sums, share and pct_change are #UNIT! in every row", () => {
    for (const fn of ["cumsum", "rolling_sum", "group_sum", "share", "pct_change"]) {
      expect(w(fn).values.every((v) => isSolError(v) && v.code === "#UNIT!"), fn).toBe(true);
      expect(w(fn).unit, fn).toBeUndefined();
    }
  });

  it("the running and rolling averages stay readings", () => {
    expect(w("cumavg").values).toEqual([20, 23, 76 / 3]);
    expect(w("cumavg").unit?.display).toBe("degC");
    expect(w("rolling_avg").unit?.display).toBe("degC");
  });

  it("a cube's window reads its cells' unit the same way", () => {
    const out = windowCube(frameToCube(temps("degC")), { partitionBy: [], fn: "diff", column: "t", as: "d" });
    const d = out.columns.find((c) => c.name === "d")!.cells[1] as UnitCell;
    expect(isUnitCell(d) && d.value).toBe(6);
    expect(d.display).toBeUndefined();
  });
});

describe("the native engine gets the reading scale on the op", () => {
  it("withReadingScales names a °F column's scale and leaves a linear one alone", () => {
    const f = frame({ name: "t", type: "number", values: [], unit: unit("degF") }, { name: "d", type: "number", values: [], unit: unit("km") });
    const op = withReadingScales(f, { kind: "groupBy", keys: [], aggs: [{ column: "t", op: "stdev", as: "s" }, { column: "d", op: "sum", as: "n" }] }) as Extract<FrameOp, { kind: "groupBy" }>;
    expect(op.aggs[0].readingScale).toBeCloseTo(5 / 9, 15);
    expect(op.aggs[1].readingScale).toBeUndefined();
  });

  it("lowerForEngine reads each op against the schema it meets, through a rename", () => {
    const { wire, schema } = lowerForEngine(temps("degC"), [
      { kind: "rename", map: { t: "temp" } },
      { kind: "window", partitionBy: ["k"], fn: "diff", column: "temp", as: "d" },
    ]);
    expect((wire[1] as { readingScale?: number }).readingScale).toBe(1);
    expect(schema!.columns.find((c) => c.name === "d")!.unit).toEqual(K);
  });

  it("the oracle honors an explicit scale on a unitless frame, as the corpus runs it", () => {
    const bare = frame({ name: "t", type: "number", values: [50, 59] });
    const out = applyVerb(bare, { kind: "window", partitionBy: [], fn: "diff", column: "t", as: "d", readingScale: 5 / 9 });
    expect(col(out, "d").values[1]).toBeCloseTo(5, 12);
  });
});

describe("Cube Rollup carries units", () => {
  const rollup = (agg: string, nested: unknown) => {
    const n = new CubeRollupNode({ agg: agg as never });
    n.stringLiterals.nested = "items"; n.stringLiterals.column = "t";
    const cube = cubeFromColumns([{ name: "k", cells: ["a"], type: "string" }, { name: "items", cells: [nested as never] }]);
    const out = n.data({ cube: [cube] }).frame as FrameValue;
    return out.columns[out.columns.length - 1];
  };

  it("a nested frame's km column rolls up in km", () => {
    const c = rollup("sum", frame({ name: "t", type: "number", values: [2, 3], unit: unit("km") }));
    expect(c.values).toEqual([5]);
    expect(c.unit?.display).toBe("km");
  });

  it("a nested cube's tagged cells roll up in their unit, not to zero", () => {
    const c = rollup("avg", frameToCube(frame({ name: "t", type: "number", values: [20, 26], unit: unit("degC") })));
    expect(c.values).toEqual([23]);
    expect(c.unit?.display).toBe("degC");
  });

  it("readings have no rolled-up sum", () => {
    const c = rollup("sum", frame({ name: "t", type: "number", values: [20, 26], unit: unit("degC") }));
    expect(isSolError(c.values[0]) && c.values[0].code).toBe("#UNIT!");
  });
});

describe("Get Column into Aggregate", () => {
  const list = (): never => {
    const g = new GetColumnNode();
    g.stringLiterals.name = "t";
    return g.data({ frame: [temps("degC")] }).values as never;
  };

  it("a column of readings has no SUM but has an AVERAGE", () => {
    const sum = new AggregateNode({ op: "sum" }).data({ list: [list()] }).result;
    expect(isSolError(sum) && sum.code).toBe("#UNIT!");
    const avg = new AggregateNode({ op: "avg" }).data({ list: [list()] }).result as UnitCell;
    expect(avg.display).toBe("degC");
  });
});
