// [[C50]] lambdaBindsByName, [[formula-language#The LAMBDA node and wired lambdas]]
import { describe, it, expect } from "vitest";
import { ByAxisNode, ReduceLambdaNode, ScanLambdaNode } from "../../../src/graph/nodes/tableLambda";
import { LambdaNode, isLambdaValue, formatLambda, formatLambdaSig, undeclaredConsumerVars, type LambdaValue } from "../../../src/graph/nodes/lambda";
import { type SolError } from "../../../src/graph/errorValue";
import { fromUnit, isUnitCell, magnitudeOf, type UnitCell } from "../../../src/graph/unitValue";

/** The node answers a SolError for a broken lambda, so its result is narrowed before `.params` and `.fn`. */
function asLambda(v: unknown): LambdaValue {
  if (!isLambdaValue(v)) throw new Error(`expected a lambda value, got ${JSON.stringify(v)}`);
  return v;
}

describe("Lambda (LAMBDA value)", () => {
  it("emits a callable value binding params positionally", () => {
    const n = new LambdaNode({ params: "a, b", expr: "a * b + 1" });
    const v = asLambda(n.data({}).result);
    expect(v.params).toEqual(["a", "b"]);
    expect(v.fn(3, 4)).toBe(13);
    expect(formatLambda(v)).toBe("λ(a, b)");
  });



});




describe("ScanLambda (SCAN)", () => {
  it("seeds from a scalar `any` socket, not a list", () => {
    expect(new ScanLambdaNode().inputs.initial!.socket.name).toBe("any");
    expect(new ReduceLambdaNode().inputs.initial!.socket.name).toBe("any");
  });

  it("advisory names the consumer vars a lambda used but didn't declare", () => {
    const sig = new ScanLambdaNode().lambdaSig;
    expect(formatLambdaSig(sig)).toBe("acc, value, [step]");
    // captured = body vars that aren't params; advise only those that ARE our vars:
    expect(undeclaredConsumerVars([], sig)).toEqual([]);              // λ(acc, value): nothing captured
    expect(undeclaredConsumerVars(["acc"], sig)).toEqual(["acc"]);    // λ(value): acc captured → advise
    expect(undeclaredConsumerVars(["rate"], sig)).toEqual([]);        // a real constant → fine
    expect(undeclaredConsumerVars(["acc", "value"], sig)).toEqual(["acc", "value"]);
    expect(new ReduceLambdaNode().lambdaSig).toEqual(sig);
  });
});

// A km cell: n km stored as base-SI meters (n*1000), tagged length + display "km".
const KM = { dim: { length: 1 }, scale: 1000 };
const km = (n: number) => fromUnit(n, KM, "km") as UnitCell;
// BYROW answers one-column rows ([[D85]] columnsStayColumns); this reads them back as values.
const perRow = (r: unknown): unknown => (Array.isArray(r) ? (r as unknown[][]).map((row) => row[0]) : r);

describe("LAMBDA hosts carry units over a 1-D list (FC A4)", () => {
  it("BYROW SUM over a km list carries the length dimension + display", () => {
    const list = [km(1), km(2), km(3)]; // base meters 1000/2000/3000
    const out = perRow(new ByAxisNode({ op: "row", expr: "SUM(values)" }).data({ table: [list] }).result) as UnitCell[];
    expect(out.length).toBe(1);
    expect(out[0].dim).toEqual({ length: 1 });
    expect(magnitudeOf(out[0])).toBeCloseTo(6000, 6); // 6 km in meters
    expect(out[0].display).toBe("km");
  });

  it("REDUCE sum over a km list from 0 carries the dimension (initial 0 is the identity)", () => {
    const list = [km(1), km(2), km(3)];
    const r = new ReduceLambdaNode({ expr: "acc + value" }).data({ initial: [0], table: [list] }).result;
    expect(isUnitCell(r) && (r as UnitCell).dim).toEqual({ length: 1 });
    expect(magnitudeOf(r)).toBeCloseTo(6000, 6);
    expect((r as UnitCell).display).toBe("km");
  });




  it("the fold runs in the list's display unit: a bare 1 is 1 km, as on the Arithmetic card ([[C25]] firstClassUnits)", () => {
    const list = [km(1), km(2)];
    const r = new ReduceLambdaNode({ expr: "acc + value + 1" }).data({ initial: [0], table: [list] }).result as UnitCell;
    expect(magnitudeOf(r)).toBeCloseTo(5000, 6); // 0+1+1 + 2+1 = 5 km, never 3002 m
    expect(r.display).toBe("km");
    const cap = perRow(new ByAxisNode({ op: "row", expr: "MIN(MAX(values), 1.5)" }).data({ table: [list] }).result) as UnitCell[];
    expect(magnitudeOf(cap[0])).toBeCloseTo(1500, 6);
    const area = new ReduceLambdaNode({ expr: "acc * value" }).data({ initial: [1], table: [list] }).result as UnitCell;
    expect(magnitudeOf(area)).toBeCloseTo(2e6, 3); // 2 km² in m²
  });

  it("over °C the fold is classified as Expression is: a reading, a difference, or #UNIT!", () => {
    const C = { dim: { temperature: 1 }, scale: 1, offset: 273.15 };
    const list = [fromUnit(20, C, "degC"), fromUnit(30, C, "degC")];
    const by = (expr: string) => perRow(new ByAxisNode({ op: "row", expr }).data({ table: [list] }).result);
    const avg = (by("AVERAGE(values)") as UnitCell[])[0];
    expect(avg.display).toBe("degC");
    expect(magnitudeOf(avg)).toBeCloseTo(298.15, 9); // 25 °C
    const span = (by("MAX(values) - MIN(values)") as UnitCell[])[0];
    expect(span.display).toBeUndefined();
    expect(magnitudeOf(span)).toBeCloseTo(10, 9); // 10 K
    expect((by("SUM(values)") as SolError).code).toBe("#UNIT!");
    const hi = new ReduceLambdaNode({ expr: "MAX(acc, value)" }).data({ initial: [-50], table: [list] }).result as UnitCell;
    expect(magnitudeOf(hi)).toBeCloseTo(303.15, 9); // 30 °C; the bare initial is a reading
    expect((new ReduceLambdaNode({ expr: "acc + value" }).data({ initial: [0], table: [list] }).result as SolError).code).toBe("#UNIT!");
  });


  it("a wired LAMBDA's body drives the dimensional interpretation too", () => {
    const lam = new LambdaNode({ params: "values", expr: "SUM(values)" }).data({}).result;
    const list = [km(2), km(3)];
    const out = perRow(new ByAxisNode({ op: "row" }).data({ table: [list], lambda: [lam] }).result) as UnitCell[];
    expect(out[0].dim).toEqual({ length: 1 });
    expect(magnitudeOf(out[0])).toBeCloseTo(5000, 6);
  });
});

describe("REDUCE's initial value carries its unit into the fold ([[C25]] firstClassUnits)", () => {
  it("over a plain list it is the fold's unit, its bare numbers read in it", async () => {
    const { fcUnitToUnit } = await import("../../../src/graph/dimension");
    const km = fcUnitToUnit("km")!;
    const r = new ReduceLambdaNode().data({ initial: [fromUnit(5, km, "km")], table: [[[1, 2]]] }).result as UnitCell;
    expect(r).toEqual({ __unitCell: true, value: 8000, dim: { length: 1 }, display: "km" });
  });
  it("in another dimension than the list it is #UNIT!", async () => {
    const { fcUnitToUnit } = await import("../../../src/graph/dimension");
    const [km, s] = [fcUnitToUnit("km")!, fcUnitToUnit("s")!];
    const r = new ReduceLambdaNode().data({ initial: [fromUnit(5, s, "s")], table: [[[fromUnit(1, km, "km"), fromUnit(2, km, "km")]]] }).result;
    expect(r).toMatchObject({ code: "#UNIT!", message: "REDUCE's initial value and its list are in different units." });
  });
  it("over a plain list only acc carries it: compound growth stays dollars, a product stays km", async () => {
    const { fcUnitToUnit } = await import("../../../src/graph/dimension");
    const [usd, km] = [fcUnitToUnit("usd")!, fcUnitToUnit("km")!];
    const grow = new ReduceLambdaNode({ expr: "acc * (1 + value)" }).data({ initial: [fromUnit(1000, usd, "usd")], table: [[[0.05, 0.03]]] }).result as UnitCell;
    expect(grow.dim).toEqual({ currency: 1 });
    expect(magnitudeOf(grow)).toBeCloseTo(1081.5, 9);
    const prod = new ReduceLambdaNode({ expr: "acc * value" }).data({ initial: [fromUnit(5, km, "km")], table: [[[2, 3]]] }).result as UnitCell;
    expect(prod).toEqual({ __unitCell: true, value: 30000, dim: { length: 1 }, display: "km" });
  });
});

describe("a wired LAMBDA binds the card's values by name, in any declared order ([[C50]] lambdaBindsByName)", () => {
  // acc * 10 + value is not symmetric: over [1, 2, 3] it folds to 123 only when acc and value land where they're named.
  const reduce = (params: string, expr: string) => {
    const lam = new LambdaNode({ params, expr }).data({}).result;
    return new ReduceLambdaNode().data({ initial: [0], table: [[1, 2, 3]], lambda: [lam] }).result;
  };

  it("reads acc and value by their names whichever is declared first", () => {
    expect(reduce("acc, value", "acc * 10 + value")).toBe(123);
    expect(reduce("value, acc", "acc * 10 + value")).toBe(123);
  });

  it("refuses a parameter the card doesn't offer", () => {
    const r = reduce("acc, thing", "acc + thing") as SolError;
    expect([r.code, r.message]).toEqual(["#VALUE!", "Lambda param thing isn't one of this node's variables (acc, value, step)"]);
  });
});
