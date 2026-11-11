// [[C50]] lambdaBindsByName, [[frame-verbs#pivot]]
import { describe, it, expect } from "vitest";
import { frameSourceToText, cubeFromColumns, type FrameValue } from "../../../src/graph/frame";
import { planned } from "../frameRefKit";
import { isSolDate } from "../../../src/graph/dateValue";
import { FrameInputNode, PivotNode } from "../../../src/graph/nodes/frame";
import { LambdaNode } from "../../../src/graph/nodes/lambda";
import { savedNodeBody, type SavedNodeBody } from "../../../src/graph/savedNodeBody";
import { GraphEditor } from "../../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../../src/graph/graphModel";
import { DataflowEngine } from "../../../src/graph/dataflowEngine";
import * as Nodes from "../../../src/graph/nodeClasses";
import type { Schemes } from "../../../src/graph/schemes";
import { readFrame, type FrameInput } from "../../../src/graph/frameBackend";
import seed from "../../../src/graph/seedGraphs/pivot-calculated-fields.json";
import { restoreLiterals } from "../../../src/graph/literalFields";
import { isSolError } from "../../../src/graph/errorValue";
import { pivotLayoutOf, pivotViewFrame } from "../../../src/graph/pivotLayout";

// A fleet's fuel log: MPG per plate per month is miles over gallons in that cell's rows.
const log = new FrameInputNode({
  frameText: frameSourceToText([
    { name: "Month", type: "string", cells: ["2026-01", "2026-01", "2026-02", "2026-01", "2026-02", "2026-02"] },
    { name: "Plate", type: "string", cells: ["ABC-123", "ABC-123", "ABC-123", "XYZ-789", "XYZ-789", "XYZ-789"] },
    { name: "Miles", type: "number", cells: ["100", "200", "200", "200", "150", "250"] },
    { name: "Gallons", type: "number", cells: ["4", "6", "10", "20", "4", "6"] },
  ]),
}).data({}).frame as FrameValue;

const lambda = (params: string, expr: string) => new LambdaNode({ params, expr }).data({}).result;

function pivot(expr: string, params: string, values = "") {
  const n = new PivotNode({ rowTotalDepth: 1, colTotalDepth: 1, valueKeys: ["calcName0", "calcFn0"] });
  Object.assign(n.stringLiterals, { rowFields: "Plate", colFields: "Month", values, calcName0: "MPG" });
  // The graph hands a card its field lists as inputs; a direct call passes them so.
  const valueList = values.split(",").map((v) => v.trim()).filter(Boolean);
  const out = pivotViewFrame(n.data({ frame: [log], rowFields: [["Plate"]], colFields: [["Month"]], values: [valueList], calcFn0: [lambda(params, expr)] }).frame as FrameValue);
  return { n, out, col: (name: string) => out.columns.find((c) => c.name === name)!.values };
}

describe("PIVOTBY calculated fields", () => {
  it("each cell, totals included, is the LAMBDA over its own rows: a ratio of sums, never an average of ratios", () => {
    const { col } = pivot("SUM(Miles) / SUM(Gallons)", "Miles, Gallons");
    expect(col("Plate")).toEqual(["ABC-123", "XYZ-789", "Grand Total"]);
    expect(col("2026-01")).toEqual([30, 10, 500 / 30]);
    expect(col("2026-02")).toEqual([20, 40, 30]);
    // XYZ-789 averages its months to 25; its miles over its gallons are 20.
    expect(col("Grand Total")).toEqual([25, 20, 22]);
  });

  it("the card's Frame leaves the totals to its view: no Grand Total row or column", () => {
    const n = new PivotNode({ rowTotalDepth: 1, colTotalDepth: 1, valueKeys: ["calcName0", "calcFn0"] });
    Object.assign(n.stringLiterals, { rowFields: "Plate", colFields: "Month", values: "", calcName0: "MPG" });
    const raw = n.data({ frame: [log], rowFields: [["Plate"]], colFields: [["Month"]], values: [[]], calcFn0: [lambda("Miles, Gallons", "SUM(Miles) / SUM(Gallons)")] }).frame as FrameValue;
    expect(raw.columns.map((c) => c.name)).toEqual(["Plate", "2026-01", "2026-02"]);
    expect(raw.columns[0].values).toEqual(["ABC-123", "XYZ-789"]);
    expect(pivotViewFrame(raw).columns.map((c) => c.name)).toEqual(["Plate", "2026-01", "2026-02", "Grand Total"]);
  });

  it("sits beside the ordinary value fields, named in the headers as a value is", () => {
    const { col } = pivot("SUM(Miles) / SUM(Gallons)", "Miles, Gallons", "Miles, Gallons");
    expect(col("2026-01 | Miles")).toEqual([300, 200, 500]);
    expect(col("2026-01 | MPG")).toEqual([30, 10, 500 / 30]);
  });

  it("a list answer is #SHAPE!, a parameter naming no column #NAME?, and @ has no row here", () => {
    const code = (expr: string, params: string) => {
      const cell = pivot(expr, params).col("Grand Total")[2];
      return isSolError(cell) ? cell.code : cell;
    };
    expect(code("Miles / Gallons", "Miles, Gallons")).toBe("#SHAPE!");
    expect(code("SUM(Mileage)", "Mileage")).toBe("#NAME?");
    expect(code("SUM(@Miles)", "Miles")).toBe("#REF!");
  });

  it("the field's row saves with the card, and the layout captions it by name", () => {
    const { n, out } = pivot("SUM(Miles) / SUM(Gallons)", "Miles, Gallons");
    expect(savedNodeBody(n).init.valueKeys).toEqual(expect.arrayContaining(["calcName0", "calcFn0"]));
    expect(new PivotNode({ valueKeys: ["calcName3", "calcFn3"] }).valuePairKeys()).toEqual([["calcName3", "calcFn3"]]);
    expect(out.columns.length).toBe(4);
  });
});

// An oracle that never runs the pivot: each cell's MPG worked out from the log by brute force, against the card,
// over seeded random logs (blank plates and values, zero-gallon groups, two row fields, a column field, subtotal
// depths on both axes either side, a filter mask). Default order keeps each group contiguous, so a subtotal is every
// row under its prefix; the core's differential test (`crates/solenoid-core/tests/pivot_calc.rs`) covers the sorts.
describe("PIVOTBY calculated fields over column names with spaces", () => {
  const spaced = new FrameInputNode({
    frameText: frameSourceToText([
      { name: "Plate", type: "string", cells: ["ABC-123", "ABC-123", "ABC-123", "XYZ-789", "XYZ-789", "XYZ-789"] },
      { name: "Miles Driven", type: "number", cells: ["100", "200", "200", "200", "150", "250"] },
      { name: "Fuel Gallons", type: "number", cells: ["4", "6", "10", "20", "4", "6"] },
      { name: "Gallons", type: "number", cells: ["4", "6", "10", "20", "4", "6"] },
    ]),
  }).data({}).frame as FrameValue;
  const byPlate = (params: string, expr: string) => {
    const n = new PivotNode({ rowTotalDepth: 1, valueKeys: ["calcName0", "calcFn0"] });
    Object.assign(n.stringLiterals, { rowFields: "Plate", values: "", calcName0: "MPG" });
    const out = pivotViewFrame(n.data({ frame: [spaced], rowFields: [["Plate"]], colFields: [[]], values: [[]], calcFn0: [lambda(params, expr)] }).frame as FrameValue);
    return out.columns.find((c) => c.name === "MPG")!.values;
  };

  it("a bracketed parameter names a column with a space, and the body reads it in its brackets", () => {
    expect(byPlate("[Miles Driven], [Fuel Gallons]", "SUM([Miles Driven]) / SUM([Fuel Gallons])")).toEqual([25, 20, 22]);
  });

  it("[Column] in the body reads that column over the cell's rows, with no parameter at all", () => {
    expect(byPlate("", "SUM([Miles Driven]) / SUM([Fuel Gallons])")).toEqual([25, 20, 22]);
  });

  it("a bare name no parameter binds reads its column too, and one no column has is #NAME?, never a blank", () => {
    expect(byPlate("", "SUM([Miles Driven]) / SUM(Gallons)")).toEqual([25, 20, 22]);
    const cell = byPlate("", "SUM([Miles Driven]) / SUM(gallons)")[2];
    expect(isSolError(cell) && cell.code).toBe("#NAME?");
    expect(isSolError(cell) && cell.message).toContain('the table has "Gallons"');
  });

  it("a bracket naming no column is #NAME?, and a malformed bracket parameter is refused by the LAMBDA card", () => {
    const cell = byPlate("", "SUM([Miles driven])")[2];
    expect(isSolError(cell) && cell.code).toBe("#NAME?");
    expect(isSolError(cell) && cell.message).toContain('the table has "Miles Driven"');
    const bad = lambda("[Miles", "1");
    expect(isSolError(bad) && bad.code).toBe("#NAME?");
  });
});

describe("PIVOTBY calculated fields against a brute-force oracle", () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mpg = lambda("Miles, Gallons", "SUM(Miles) / SUM(Gallons)");

  it("every cell of 400 random pivots is the miles over the gallons of exactly its rows", () => {
    const rand = rng(20261110);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    let cells = 0;
    for (let k = 0; k < 400; k++) {
      const n = 1 + Math.floor(rand() * 18);
      const rows = Array.from({ length: n }, () => ({
        Plate: pick(["A", "B", "C", ""]),
        Driver: pick(["x", "y"]),
        Month: pick(["01", "02", "03"]),
        Miles: rand() < 0.1 ? "" : String(Math.floor(rand() * 500)),
        Gallons: rand() < 0.1 ? "" : String(pick([0, 1, 2, 5, 8, 13])),
      }));
      const frame = new FrameInputNode({
        frameText: frameSourceToText([
          { name: "Plate", type: "string", cells: rows.map((r) => r.Plate) },
          { name: "Driver", type: "string", cells: rows.map((r) => r.Driver) },
          { name: "Month", type: "string", cells: rows.map((r) => r.Month) },
          { name: "Miles", type: "number", cells: rows.map((r) => r.Miles) },
          { name: "Gallons", type: "number", cells: rows.map((r) => r.Gallons) },
        ]),
      }).data({}).frame as FrameValue;
      const rowFields = pick([[], ["Plate"], ["Plate", "Driver"], ["Driver", "Plate"]]);
      const colFields = pick([[], ["Month"]]);
      const depth = () => Math.floor(rand() * 7) - 3;
      const mask = rand() < 0.3 ? rows.map(() => rand() < 0.75) : null;
      const node = new PivotNode({ rowTotalDepth: depth(), colTotalDepth: depth(), valueKeys: ["calcName0", "calcFn0"] });
      Object.assign(node.stringLiterals, { rowFields: rowFields.join(", "), colFields: colFields.join(", "), values: "", calcName0: "MPG" });
      const raw = node.data({
        frame: [frame], rowFields: [rowFields], colFields: [colFields], values: [[]], calcFn0: [mpg],
        ...(mask ? { filter: [mask] } : {}),
      }).frame as FrameValue;
      const layout = pivotLayoutOf(raw);
      const out = pivotViewFrame(raw);
      expect(layout, `case ${k}`).toBeTruthy();
      const key = (v: unknown) => (v === null || v === undefined || v === "" ? "\u0000" : String(v));
      const matches = (i: number, fields: string[], tuple: unknown[]) =>
        tuple.every((t, j) => key((rows[i] as Record<string, string>)[fields[j]]) === key(t));
      layout!.rows.forEach((ro, r) => {
        layout!.cols.forEach((co, c) => {
          const at = rows.map((_, i) => i).filter((i) => (!mask || mask[i]) && matches(i, rowFields, ro.tuple) && matches(i, colFields, co.tuple));
          const got = out.columns[rowFields.length + c].values[r];
          const where = `case ${k} row ${r} (${ro.kind} ${JSON.stringify(ro.tuple)}) col ${c} (${co.kind} ${JSON.stringify(co.tuple)})`;
          if (at.length === 0) {
            expect(got, where).toBeNull();
          } else {
            const sum = (f: "Miles" | "Gallons") => at.reduce((s, i) => s + (rows[i][f] === "" ? 0 : Number(rows[i][f])), 0);
            const gallons = sum("Gallons");
            if (gallons === 0) expect(isSolError(got) && got.code, where).toBe("#DIV/0!");
            else expect(got as number, where).toBeCloseTo(sum("Miles") / gallons, 12);
          }
          cells++;
        });
      });
    }
    expect(cells).toBeGreaterThan(3000);
  });
});

// Each thing a calculated field could get quietly wrong past plain numbers, on the fleet log.
describe("PIVOTBY calculated fields: what else they read and answer", () => {
  const run = async (cfg: { frame?: unknown; rows?: string[]; cols?: string[]; values?: string[]; calcs: [string, unknown][]; depth?: number }) => {
    const keys = cfg.calcs.flatMap((_, i) => [`calcName${i}`, `calcFn${i}`]);
    const n = new PivotNode({ rowTotalDepth: cfg.depth ?? 1, valueKeys: keys });
    const rows = cfg.rows ?? ["Plate"], cols = cfg.cols ?? [], values = cfg.values ?? [];
    Object.assign(n.stringLiterals, { rowFields: rows.join(", "), colFields: cols.join(", "), values: values.join(", ") });
    const inputs: Record<string, unknown[]> = { frame: [cfg.frame ?? log], rowFields: [rows], colFields: [cols], values: [values] };
    cfg.calcs.forEach(([name, lam], i) => { n.stringLiterals[`calcName${i}`] = name; if (lam !== undefined) inputs[`calcFn${i}`] = [lam]; });
    const out = pivotViewFrame((await n.data(inputs)).frame as FrameValue);
    return { n, out, col: (name: string) => out.columns.find((c) => c.name === name), names: out.columns.map((c) => c.name) };
  };
  const MPG = lambda("Miles, Gallons", "SUM(Miles) / SUM(Gallons)");

  it("binds parameters by name, in any order", async () => {
    const swapped = await run({ calcs: [["MPG", lambda("Gallons, Miles", "SUM(Miles) / SUM(Gallons)")]] });
    expect(swapped.col("MPG")!.values).toEqual([25, 20, 22]);
  });

  it("a LAMBDA's own side value is read as the card holds it", async () => {
    const lpk = new LambdaNode({ params: "Miles, Gallons", expr: "SUM(Miles) / SUM(Gallons) * k", literals: { k: 0.425144 } }).data({ k: [0.425144] }).result;
    const { col } = await run({ calcs: [["KPL", lpk]] });
    expect(col("KPL")!.values[2]).toBeCloseTo(22 * 0.425144, 9);
  });

  it("a date answer makes a Date column; a span of days stays a number", async () => {
    const dated = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "Plate", type: "string", cells: ["A", "A", "B"] },
        { name: "Filled", type: "date", cells: ["2026-01-03", "2026-01-20", "2026-02-01"] },
      ]),
    }).data({}).frame as FrameValue;
    const { col } = await run({ frame: dated, calcs: [["Last", lambda("Filled", "MAX(Filled)")], ["Span", lambda("Filled", "MAX(Filled) - MIN(Filled)")]] });
    expect(col("Last")!.type).toBe("date");
    expect(col("Last")!.values.map((v) => (isSolDate(v) ? v.__date : v))).toEqual([46042, 46054, 46054]);
    expect(col("Span")!.type).toBe("number");
    expect(col("Span")!.values).toEqual([17, 0, 29]);
  });

  it("a text answer makes a Text column", async () => {
    const { col } = await run({ calcs: [["Months", lambda("Month", 'TEXTJOIN(",", TRUE, Month)')]] });
    expect(col("Months")!.type).toBe("string");
    expect(col("Months")!.values[0]).toBe("2026-01,2026-01,2026-02");
  });

  it("an error in the data is the cell's error, as the value path gives it", async () => {
    const bad = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "Plate", type: "string", cells: ["A", "A", "B"] },
        { name: "X", type: "number", cells: ["1", "oops", "2"] },
      ]),
    }).data({}).frame as FrameValue;
    const { out } = await run({ frame: bad, values: ["X"], calcs: [["S", lambda("X", "SUM(X)")]] });
    const code = (v: unknown) => (isSolError(v) ? v.code : v);
    // Value field and calculated field agree cell for cell: B is 2, A and the total carry the bad cell's error.
    expect(out.columns[2].values.map(code)).toEqual(out.columns[1].values.map(code));
    expect(code(out.columns[2].values[1])).toBe(2);
  });

  it("units ride through: miles over gallons is a rate", async () => {
    const withUnits = new FrameInputNode({
      frameText: frameSourceToText([
        { name: "Plate", type: "string", cells: ["A", "A"] },
        { name: "Miles", type: "number", cells: ["100", "200"], unit: "mi" },
        { name: "Gallons", type: "number", cells: ["4", "6"], unit: "gal" },
      ]),
    }).data({}).frame as FrameValue;
    const { col } = await run({ frame: withUnits, calcs: [["MPG", MPG]] });
    const v = col("MPG")!.values[0];
    expect(typeof v === "number" ? v : (v as { value?: number })?.value ?? v).toBe(30);
  });

  it("a Cube and a lazy input read the same as a frame", async () => {
    const asCube = cubeFromColumns(log.columns.map((c) => ({ name: c.name, type: c.type, cells: c.values as never })));
    expect((await run({ frame: asCube, calcs: [["MPG", MPG]] })).col("MPG")!.values).toEqual([25, 20, 22]);
    // A lazy input reads only the columns the card names: the LAMBDA's parameters are among them.
    const lazy = planned(log, { kind: "distinct" });
    expect((await run({ frame: lazy, calcs: [["MPG", MPG]] })).col("MPG")!.values).toEqual([25, 20, 22]);
  });

  it("several fields keep their order; a name a value already has is told apart; blank names and unwired slots", async () => {
    const two = await run({ values: ["Miles"], calcs: [["Miles", MPG], ["", lambda("Gallons", "SUM(Gallons)")], ["Nothing", undefined]] });
    expect(two.names).toEqual(["Plate", "Miles", "Miles2", "Calculated 2"]);
    expect(two.col("Miles2")!.values).toEqual([25, 20, 22]);
    expect(two.col("Calculated 2")!.values).toEqual([20, 30, 50]);
  });

  it("saves and reloads with its fields; removing one keeps the others' slots", () => {
    const n = new PivotNode({ valueKeys: ["calcName0", "calcFn0"] });
    n.addValuePair(); n.addValuePair();
    Object.assign(n.stringLiterals, { calcName0: "MPG", calcName1: "Cost", calcName2: "Range" });
    n.removeValuePair("calcName1");
    expect(n.valuePairKeys()).toEqual([["calcName0", "calcFn0"], ["calcName2", "calcFn2"]]);
    expect(n.stringLiterals.calcName1).toBeUndefined();
    const saved = JSON.parse(JSON.stringify(savedNodeBody(n)));
    const back = new PivotNode(saved.init as never);
    restoreLiterals(back, saved);
    expect(back.valuePairKeys()).toEqual(n.valuePairKeys());
    back.addValuePair();
    expect(back.valuePairKeys()[2]).toEqual(["calcName3", "calcFn3"]);
    expect(back.stringLiterals.calcName2).toBe("Range");
  });
});


describe("the Pivot calculated fields seed", () => {
  it("answers the MPG its note claims, and the averaged ratio it warns about", async () => {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    const byId = new Map<string, GraphNode>();
    const ctors = Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => GraphNode>;
    for (const sn of seed.nodes as SavedNodeBody[] & { id: string }[]) {
      const node = new ctors[sn.type]({ ...sn.init });
      restoreLiterals(node, sn);
      byId.set(sn.id, node);
      await editor.addNode(node as unknown as Schemes["Node"]);
    }
    for (const c of seed.connections) {
      await editor.addConnection(
        new GraphConnection(byId.get(c.source)!, c.sourceOutput, byId.get(c.target)!, c.targetInput) as Schemes["Connection"],
      );
    }
    const table = async (id: string) => {
      const out = (await engine.fetch(byId.get(id)!.id)) as Record<string, unknown>;
      const f = pivotViewFrame((await readFrame(out.frame as FrameInput)) as FrameValue);
      return Object.fromEntries(f.columns.map((c) => [c.name, c.values]));
    };
    const r = (xs: unknown[]) => xs.map((x) => (typeof x === "number" ? Math.round(x * 1e6) / 1e6 : x));

    // Hand-worked from the twelve fill-ups: each cell is its miles over its gallons.
    const m = await table("ByMonth");
    expect(m.Plate).toEqual(["ABC-123", "VAN-01", "XYZ-789", "Grand Total"]);
    expect(r(m["2026-01"])).toEqual([28, 15, 20, 22]); // 420/15, 150/10, 200/10, 770/35
    expect(r(m["2026-02"])).toEqual(r([25, 16.25, 22, 1125 / 55])); // 250/10, 325/20, 550/25
    expect(r(m["2026-03"])).toEqual(r([30, null, 22, 640 / 24])); // VAN-01 drove nothing in March
    expect(r(m["Grand Total"])).toEqual(r([1090 / 39, 475 / 30, 970 / 45, 2535 / 114]));

    const b = await table("Beside");
    expect(b.Miles).toEqual([1090, 475, 970, 2535]);
    expect(b.Gallons).toEqual([39, 30, 45, 114]);
    expect(r(b.MPG)).toEqual(r([1090 / 39, 475 / 30, 970 / 45, 2535 / 114]));

    // The wrong way: each fill's ratio averaged, so the 60-mile top-up weighs as much as a tank.
    const w = await table("Wrong");
    expect(r(w["2026-01"]).slice(0, 3)).toEqual([25, 15, 20]);
  });
});
