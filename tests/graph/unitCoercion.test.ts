// The unit-blind boundary (FC A4 regression, 2026-07-13): a `UnitCell` must never
// leak raw into a node that doesn't run the dimension algebra — it unwraps to its
// DISPLAY magnitude (the number the user typed) at the central coercion seam, so a
// comparison / threshold / chart downstream of an FC computes on `5`, not on a
// NaN-coercing object or the base-SI `5000`. Unit-aware nodes and pure
// passthroughs keep the tags (the algebra + display propagation live there).
import { describe, it, expect, beforeAll } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { NumberInputNode, FormatControllerNode, ComparisonNode, RoundNNode, DisplayNode, ArithmeticNode, ConvertNode, AggregateNode, ListInputNode } from "../../src/graph/rete-nodes";
import { isUnitCell, type UnitCell } from "../../src/graph/unitValue";
import { stripUnitCells, displayMagnitudeOf } from "../../src/graph/unitBridge";

type AnyNode = ClassicPreset.Node;

function makeGraph() {
  const editor = new NodeEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  installInputCoercion(editor as never);
  installErrorGuards(editor as never);
  const conn = (a: AnyNode, ao: string, b: AnyNode, bi: string) =>
    editor.addConnection(new ClassicPreset.Connection(a as never, ao, b as never, bi) as never);
  const fetch = async (n: AnyNode) => engine.fetch(n.id) as Promise<Record<string, unknown>>;
  return { editor, engine, conn, fetch };
}

describe("stripUnitCells (pure)", () => {
  const km5: UnitCell = { __unitCell: true, value: 5000, dim: { length: 1 }, display: "km" };
  it("unwraps to the display magnitude, not base SI", () => {
    expect(displayMagnitudeOf(km5)).toBe(5);
    expect(stripUnitCells(km5)).toBe(5);
  });
  it("a display-less algebra cell reads as its base magnitude", () => {
    expect(stripUnitCells({ __unitCell: true, value: 12, dim: { length: 1, time: -1 } })).toBe(12);
  });
  it("recurses lists and matrices, same ref when clean", () => {
    expect(stripUnitCells([km5, 3, null])).toEqual([5, 3, null]);
    expect(stripUnitCells([[km5], [2]])).toEqual([[5], [2]]);
    const clean = [1, 2, 3];
    expect(stripUnitCells(clean)).toBe(clean);
  });
});

describe("unit-blind consumers get display magnitudes (the 5 km > 3 regression)", () => {
  it("Comparison downstream of an FC compares the typed number", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5 });
    const fc = new FormatControllerNode({ unit: "km" });
    const thr = new NumberInputNode({ label: "t", value: 3 });
    const cmp = new ComparisonNode({ op: "gt" });
    for (const n of [num, fc, thr, cmp]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", cmp, "a");
    await g.conn(thr, "value", cmp, "b");
    expect((await g.fetch(cmp)).result).toBe(true); // 5 > 3 — was FALSE (NaN) before the boundary
  });

  it("Round downstream of an FC rounds the typed number", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5.4 });
    const fc = new FormatControllerNode({ unit: "km" });
    const round = new RoundNNode({ op: "round" });
    for (const n of [num, fc, round]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", round, "value");
    expect((await g.fetch(round)).result).toBe(5); // not 5400
  });
});

describe("unit-aware nodes and passthroughs keep the tags", () => {
  it("Display forwards the UnitCell unchanged", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5 });
    const fc = new FormatControllerNode({ unit: "km" });
    const disp = new DisplayNode({ label: "d" });
    for (const n of [num, fc, disp]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", disp, "in");
    const out = (await g.fetch(disp)).out;
    expect(isUnitCell(out)).toBe(true);
    expect((out as UnitCell).display).toBe("km");
  });

  it("a bare number added to a currency value adopts $ (=$7, keeps display)", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5 });
    const fc = new FormatControllerNode({ unit: "usd" });
    const two = new NumberInputNode({ label: "t", value: 2 });
    const add = new ArithmeticNode({ op: "add" });
    for (const n of [num, fc, two, add]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", add, "a");
    await g.conn(two, "value", add, "b");
    const out = (await g.fetch(add)).result;
    expect(isUnitCell(out)).toBe(true);
    expect((out as UnitCell).value).toBe(7);
    expect((out as UnitCell).dim).toEqual({ currency: 1 });
    expect((out as UnitCell).display).toBe("usd");
  });

  it("$ × a bare number keeps the $ display (no bare ¤ derived symbol)", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5000 });
    const fc = new FormatControllerNode({ unit: "usd" });
    const two = new NumberInputNode({ label: "t", value: 2 });
    const mul = new ArithmeticNode({ op: "mul" });
    for (const n of [num, fc, two, mul]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", mul, "a");
    await g.conn(two, "value", mul, "b");
    const out = (await g.fetch(mul)).result as UnitCell;
    expect(isUnitCell(out)).toBe(true);
    expect(out.value).toBe(10000);
    expect(out.dim).toEqual({ currency: 1 });
    expect(out.display).toBe("usd"); // was dropped → rendered "10000 ¤"
  });

  it("Arithmetic runs the dimension algebra on the tags", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 2 });
    const fc = new FormatControllerNode({ unit: "km" });
    const three = new NumberInputNode({ label: "m", value: 3 });
    const mul = new ArithmeticNode({ op: "mul" });
    for (const n of [num, fc, three, mul]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", mul, "a");
    await g.conn(three, "value", mul, "b");
    const out = (await g.fetch(mul)).result;
    expect(isUnitCell(out)).toBe(true);
    expect((out as UnitCell).value).toBe(6000); // 2 km × 3, base SI
    expect((out as UnitCell).dim).toEqual({ length: 1 });
  });
});

describe("dimensioned cells shape without #SHAPE! (the $ USD regression)", () => {
  it("a currency scalar into an Aggregate widens to a singleton, not #SHAPE!", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5 });
    const fc = new FormatControllerNode({ unit: "usd" });
    const agg = new AggregateNode({ op: "sum" });
    for (const n of [num, fc, agg]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", agg, "list");
    const out = (await g.fetch(agg)).result;
    expect(isUnitCell(out)).toBe(true);
    expect((out as UnitCell).dim).toEqual({ currency: 1 });
    expect((out as UnitCell).value).toBe(5);
  });

  it("a currency LIST sums to a currency total", async () => {
    const g = makeGraph();
    const list = new ListInputNode({ label: "prices" });
    (list as unknown as { stringLiterals: Record<string, string> }).stringLiterals = { v0: "10, 20, 30" };
    const fc = new FormatControllerNode({ unit: "usd" });
    const agg = new AggregateNode({ op: "sum" });
    for (const n of [list, fc, agg]) await g.editor.addNode(n as never);
    await g.conn(list, "list", fc, "in");
    await g.conn(fc, "out", agg, "list");
    const out = (await g.fetch(agg)).result;
    expect(isUnitCell(out)).toBe(true);
    expect((out as UnitCell).value).toBe(60);
    expect((out as UnitCell).dim).toEqual({ currency: 1 });
    expect((out as UnitCell).display).toBe("usd"); // SUM keeps $ (was 60 ¤)
  });

  it("a currency value into a unit-blind Comparison compares magnitudes (no #SHAPE!)", async () => {
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5 });
    const fc = new FormatControllerNode({ unit: "usd" });
    const thr = new NumberInputNode({ label: "t", value: 3 });
    const cmp = new ComparisonNode({ op: "gt" });
    for (const n of [num, fc, thr, cmp]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc, "in");
    await g.conn(fc, "out", cmp, "a");
    await g.conn(thr, "value", cmp, "b");
    expect((await g.fetch(cmp)).result).toBe(true); // $5 > 3
  });
});

describe("FC lock states live on the value layer (A2 arrows)", () => {
  let fc2: FormatControllerNode;
  let fcAfterConvert: FormatControllerNode;
  let fcBeforeConvert: FormatControllerNode;
  beforeAll(async () => {
    // Number → FC(km) → FC(none): the second FC INHERITS (forwarding).
    const g = makeGraph();
    const num = new NumberInputNode({ label: "n", value: 5 });
    const fc1 = new FormatControllerNode({ unit: "km" });
    fc2 = new FormatControllerNode({ unit: "none" });
    for (const n of [num, fc1, fc2]) await g.editor.addNode(n as never);
    await g.conn(num, "value", fc1, "in");
    await g.conn(fc1, "out", fc2, "in");
    for (const n of g.editor.getNodes()) if (n instanceof FormatControllerNode) n.refreshAnnotation(g.editor as never);
    await g.fetch(fc2);

    // Number → Convert(m→km) → FC: the FC INHERITS the converted value's unit
    // (forwarding — the unit arrives WITH the value; dictation is the other way).
    const h = makeGraph();
    const src = new NumberInputNode({ label: "n", value: 5000 });
    const cv = new ConvertNode({ fromUnit: "m", toUnit: "km" });
    fcAfterConvert = new FormatControllerNode({ unit: "none" });
    for (const n of [src, cv, fcAfterConvert]) await h.editor.addNode(n as never);
    await h.conn(src, "value", cv, "in");
    await h.conn(cv, "out", fcAfterConvert, "in");
    for (const n of h.editor.getNodes()) if (n instanceof FormatControllerNode) n.refreshAnnotation(h.editor as never);
    await h.fetch(fcAfterConvert);

    // Number → FC → Convert(m→km): the FC FEEDS a Convert, so the Convert's
    // fromUnit DICTATES it (← ← lockedByConvert, dropdown locked to m) — Convert
    // primacy: the value must be tagged in the unit the Convert reads it as.
    const k = makeGraph();
    const src2 = new NumberInputNode({ label: "n", value: 5 });
    fcBeforeConvert = new FormatControllerNode({ unit: "none" });
    const cv2 = new ConvertNode({ fromUnit: "m", toUnit: "km" });
    for (const n of [src2, fcBeforeConvert, cv2]) await k.editor.addNode(n as never);
    await k.conn(src2, "value", fcBeforeConvert, "in");
    await k.conn(fcBeforeConvert, "out", cv2, "in");
    for (const n of k.editor.getNodes()) if (n instanceof FormatControllerNode) n.refreshAnnotation(k.editor as never);
    await k.fetch(cv2);
  });

  it("an FC fed by another FC forwards: → → arrows, dropdown mirrors km and LOCKS", () => {
    // An inherited unit is the value's, set elsewhere in the chain (author
    // ruling 2026-07-31) — the downstream FC never re-authors over it.
    expect(fc2.forwarding).toBe(true);
    expect(fc2.lockedByConvert).toBe(false);
    expect(fc2.unitLocked).toBe(true);
    expect(fc2.unit).toBe("km");
  });

  it("an FC fed by a Convert forwards the converted unit: → →, mirrors km and LOCKS", () => {
    expect(fcAfterConvert.forwarding).toBe(true);
    expect(fcAfterConvert.lockedByConvert).toBe(false);
    expect(fcAfterConvert.unitLocked).toBe(true);
    expect(fcAfterConvert.unit).toBe("km");
  });

  it("an FC FEEDING a Convert is dictated its fromUnit: ← ←, locked to m", () => {
    expect(fcBeforeConvert.lockedByConvert).toBe(true);
    expect(fcBeforeConvert.unitLocked).toBe(true);
    expect(fcBeforeConvert.unit).toBe("m");
  });
});

describe("Convert primacy on the outgoing value", () => {
  it("Convert to a non-FC-registry unit (yd) still displays yd downstream, not base m", async () => {
    const g = makeGraph();
    const src = new NumberInputNode({ label: "n", value: 10 });
    const cv = new ConvertNode({ fromUnit: "m", toUnit: "yd" });
    const disp = new DisplayNode({ label: "d" });
    for (const n of [src, cv, disp]) await g.editor.addNode(n as never);
    await g.conn(src, "value", cv, "in");
    await g.conn(cv, "out", disp, "in");
    const out = (await g.fetch(disp)).out as UnitCell;
    expect(isUnitCell(out)).toBe(true);
    expect(out.display).toBe("yd");                    // primacy: toUnit rides the value
    expect(displayMagnitudeOf(out)).toBeCloseTo(10.936, 3); // renders in yards, not meters
  });

  it("a tagged value whose dimension clashes with the Convert target errors", async () => {
    const g = makeGraph();
    const src = new NumberInputNode({ label: "n", value: 5 });
    const fc = new FormatControllerNode({ unit: "usd" });
    const cv = new ConvertNode({ fromUnit: "m", toUnit: "km" });
    for (const n of [src, fc, cv]) await g.editor.addNode(n as never);
    await g.conn(src, "value", fc, "in");
    await g.conn(fc, "out", cv, "in");
    const out = (await g.fetch(cv)).out as { __solError?: boolean; code?: string };
    expect(out && out.__solError).toBe(true);
    expect(out.code).toBe("#UNIT!"); // primacy can't hold → error, never a silent pass
  });
});
