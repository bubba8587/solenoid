// [[D99]] rustIsSpec, [[C28]] literalsIffEditable: the input widgets, lookups, random draws and small frame cards
// driven through their bodies over the fields and inputs that matter, so their frozen cases hold them.
import { describe, it, expect } from "vitest";
import { AngleDialNode, XYPadNode, DateRangeNode, PointPlotterNode, CurveNode, GridPainterNode, CableSwitchNode, ValueInputNode } from "../../../src/graph/nodes/control";
import { ColorPickerNode, ColorBlendNode, ConstantNode, SliderInputNode, type BlendMode, type ConstantOp } from "../../../src/graph/nodes/input";
import { NaNode } from "../../../src/graph/nodes/logic";
import { PhysicsConstantNode } from "../../../src/graph/nodes/physicsConstants";
import type { PhysConstOp } from "../../../src/graph/nodes/physicsConstantsOps";
import { ElementNode, MolarMassNode } from "../../../src/graph/nodes/chemistry";
import { ResistorCodeNode } from "../../../src/graph/nodes/electrical";
import { RandBetweenNode } from "../../../src/graph/nodes/display";
import { ShuffleNode, RandArrayNode } from "../../../src/graph/nodes/list";
import { UuidNode, PromoNode } from "../../../src/graph/nodes/text";
import { DistributionsNode } from "../../../src/graph/nodes/distribution";
import { inEditor, Src } from "../cardPasses";
import { HeadersNode, SplitFrameNode, SettleNode, DescribeNode, CorrMatrixNode, PcaNode, DecisionSensitivityNode } from "../../../src/graph/nodes/frame";
import { SvgPickerNode } from "../../../src/graph/nodes/annotation";
import { isSolError, solError } from "../../../src/graph/errorValue";
import { isUnitCell } from "../../../src/graph/unitValue";
import type { FrameValue, CubeValue, FrameColType } from "../../../src/graph/frame";

const frame = (...cols: [string, FrameColType, unknown[]][]): FrameValue =>
  ({ __frame: true, columns: cols.map(([name, type, values]) => ({ name, type, values })) }) as FrameValue;
const cube = (...cols: [string, unknown[]][]): CubeValue =>
  ({ __cube: true, columns: cols.map(([name, cells]) => ({ name, cells })) }) as CubeValue;

describe("the fixed-output widgets", () => {
  it("Angle Dial answers its degrees", () => {
    for (const v of [0, 15, 45, 90, 180, 270, 359, 12.5, -30, 720]) {
      const n = new AngleDialNode({ value: v });
      expect(n.data().value).toBe(v);
    }
  });

  it("XY Pad answers its two literals, a missing one as the middle", () => {
    for (const [fx, fy] of [[0, 0], [1, 1], [0.25, 0.75], [0.5, 0.1], [0.9, 0.333]]) {
      expect(new XYPadNode({ fx, fy }).data()).toEqual({ x: fx, y: fy });
    }
    const n = new XYPadNode();
    delete (n.literals as Record<string, number>).fx;
    expect(n.data()).toEqual({ x: 0.5, y: 0.5 });
  });

  it("Date Range orders its ends and blanks a missing one", () => {
    const run = (start?: number | null, end?: number | null) => {
      const n = new DateRangeNode();
      n.literals = {};
      if (start !== undefined) n.literals.start = start;
      if (end !== undefined) n.literals.end = end;
      return n.data();
    };
    expect(run(45000, 45007)).toEqual({ start: 45000, end: 45007 });
    expect(run(45010, 45001)).toEqual({ start: 45001, end: 45010 });
    expect(run(null, 45001)).toEqual({ start: null, end: 45001 });
    expect(run(45001, null)).toEqual({ start: 45001, end: null });
    // A day before 1900 is a date ([[date-values#Days before 1900 are dates everywhere, as days after it are]]).
    expect(run(0, 45001)).toEqual({ start: 0, end: 45001 });
    expect(run(45001, -5)).toEqual({ start: -5, end: 45001 });
    expect(run()).toEqual({ start: null, end: null });
    expect(run(45000.5, 45000.25)).toEqual({ start: 45000.25, end: 45000.5 });
    expect(run(45000, 45000)).toEqual({ start: 45000, end: 45000 });
  });

  it("Constant answers each constant", () => {
    const ops: ConstantOp[] = ["pi", "tau", "e", "phi", "inf", "neg-inf", "zero", "one", "neg-one", "true", "false"];
    const out = ops.map((op) => new ConstantNode({ op }).data().value);
    expect(out[0]).toBe(Math.PI);
    expect(out[4]).toBe(Infinity);
    expect(out[5]).toBe(-Infinity);
    expect(out[9]).toBe(1);
  });

  it("NA answers #N/A under any label", () => {
    for (const label of ["NA", "Missing", ""]) {
      const r = new NaNode({ label }).data().result;
      expect(isSolError(r) && r.code).toBe("#N/A");
    }
  });

  it("Physics Constant answers each constant", () => {
    const ops: PhysConstOp[] = ["c", "G", "h", "hbar", "g0", "atm", "e", "eps0", "mu0", "ke", "z0", "faraday", "me", "mp", "mn", "a0", "rydberg", "na", "kb", "rgas", "sigma", "wien"];
    const out = ops.map((op) => new PhysicsConstantNode({ op }).data().value);
    expect(out[0]).toBe(299792458);
    expect(out.every((v) => typeof v === "number" && v > 0)).toBe(true);
  });

  it("Element answers each element's mass and number", () => {
    for (const symbol of ["H", "He", "C", "O", "Na", "Cl", "Fe", "U", "Og", "Lr", "Tc", "Xx"]) {
      const r = new ElementNode({ symbol }).data();
      expect(typeof r.mass).toBe("number");
      expect(typeof r.number).toBe("number");
    }
    expect(new ElementNode({ symbol: "Fe" }).data().number).toBe(26);
  });

  it("Resistor Color Code decodes four and five bands", () => {
    const run = (bands: "4" | "5", lits: Record<string, string>) => new ResistorCodeNode({ bands, stringLiterals: lits }).data();
    expect(run("4", { b1: "brown", b2: "black", mult: "red", tol: "gold" })).toEqual({ ohms: 1000, tolerance: 5 });
    expect(run("4", { b1: "yellow", b2: "violet", mult: "orange", tol: "silver" })).toEqual({ ohms: 47000, tolerance: 10 });
    expect(run("4", { b1: "red", b2: "red", mult: "gold", tol: "brown" })).toEqual({ ohms: 2.2, tolerance: 1 });
    expect(run("5", { b1: "brown", b2: "black", b3: "black", mult: "brown", tol: "brown" })).toEqual({ ohms: 1000, tolerance: 1 });
    expect(run("5", { b1: "orange", b2: "white", b3: "violet", mult: "silver", tol: "violet" })).toEqual({ ohms: 3.97, tolerance: 0.1 });
    expect(isSolError(run("4", { b1: "gold" }).ohms)).toBe(true);
    expect(isSolError(run("4", { mult: "pink" }).tolerance)).toBe(true);
    expect(isSolError(run("4", { tol: "black" }).ohms)).toBe(true);
    expect(isSolError(run("5", { b3: "silver" }).ohms)).toBe(true);
    expect(run("4", { b1: "white", b2: "white", mult: "white", tol: "gray" }).ohms).toBe(99e9);
  });
});

describe("the drawn widgets", () => {
  it("Point Plotter frames its points text", () => {
    for (const t of ["", "1, 2", "1, 2\n3, 4\n-1.5, 0", "bad\n1,2,3\n4, x\n5, 6", "  7 ,  8  \n\n9,10", "1e3, 2e-3\nInfinity, 1", "0.1, 0.2\n0.1, 0.3"]) {
      const n = new PointPlotterNode({ pointsText: t });
      expect(n.data().result.columns.map((c) => c.name)).toEqual(["X", "Y"]);
    }
  });

  it("Curve samples its points at each count and range", () => {
    const cases: [string, number, number, number][] = [
      ["0, 0\n1, 1", 0, 1, 32], ["0, 0\n0.5, 1\n1, 0", 0, 1, 5], ["0, 0\n0.5, 1\n1, 0", -1, 2, 11],
      ["", 0, 1, 32], ["0.3, 0.7", 0, 1, 4], ["0, 0\n0.2, 0.9\n0.4, 0.1\n1, 1", 0, 1, 1.4], ["1, 1\n0, 0\n1, 0.5", 0, 1, 3],
      ["0, 0\n1, 1", 0, 1, 5000], ["0, 0\n0.25, 0.25\n0.5, 0.5\n1, 0.75", 0.1, 0.9, 9], ["0, 1\n1, 1", 0, 10, 3],
    ];
    for (const [pointsText, xmin, xmax, samples] of cases) {
      const n = new CurveNode({ pointsText, xmin, xmax, samples });
      const f = n.data().result;
      expect(f.columns.map((c) => c.name)).toEqual(["X", "Value"]);
    }
  });

  it("Grid Painter reads its grid at its size", () => {
    const cases: [string, number, number][] = [["", 6, 8], ["1,2\n3,4", 2, 2], ["1,,3\n,5,", 3, 3], ["x,1\n2,y", 2, 2], ["1.5, 2.25", 1, 2], ["1,2,3", 0, 100], ["1\n2\n3", 2.6, 1.2]];
    for (const [tableText, rows, cols] of cases) {
      const n = new GridPainterNode({ tableText, rows, cols });
      expect(Array.isArray(n.data().result)).toBe(true);
    }
  });

  it("Slider clamps its value to the bounds, wired or typed", () => {
    const run = (value: number, inputs: Record<string, number[] | undefined>, lits?: Record<string, number>) => {
      const n = new SliderInputNode({ value, ...lits });
      return [n.data(inputs).value, n.effectiveMin, n.effectiveMax, n.effectiveStep];
    };
    expect(run(50, {})).toEqual([50, 0, 100, 1]);
    expect(run(150, {})).toEqual([100, 0, 100, 1]);
    expect(run(5, { min: [10] })).toEqual([10, 10, 100, 1]);
    expect(run(5, { min: [80], max: [20] })).toEqual([20, 20, 80, 1]);
    expect(run(5, { step: [0] })).toEqual([5, 0, 100, 1]);
    expect(run(5, { step: [-2] }, { step: 0.5 })).toEqual([5, 0, 100, 0.5]);
    expect(run(5, { step: [2.5] })).toEqual([5, 0, 100, 2.5]);
    expect(run(5, { max: [NaN] }, { max: 3 })).toEqual([3, 0, 3, 1]);
    expect(run(-5, { min: [Infinity] })).toEqual([0, 0, 100, 1]);
    expect(run(-5, {}, { min: -10, max: -1 })).toEqual([-5, -10, -1, 1]);
  });
});

describe("the colour cards", () => {
  it("Color Picker answers each mode in each format", () => {
    const run = (mode: "rgb" | "hsv" | "hex", format: "hex" | "rgb", c: [number, number, number], hex = "#56b4e9") => {
      const n = new ColorPickerNode({ mode, format, c0: c[0], c1: c[1], c2: c[2] });
      n.stringLiterals.hex = hex;
      return n.data().color;
    };
    expect(run("rgb", "hex", [255, 0, 0])).toBe("#ff0000");
    expect(run("rgb", "rgb", [12.4, 300, -4])).toBe("rgb(12, 255, 0)");
    expect(run("hsv", "hex", [120, 100, 100])).toBe("#00ff00");
    expect(run("hsv", "rgb", [200, 50, 80])).toMatch(/^rgb\(/);
    expect(run("hsv", "hex", [-30, 120, 40])).toMatch(/^#/);
    expect(run("hsv", "hex", [400, 10, 90])).toMatch(/^#/);
    expect(run("hex", "hex", [0, 0, 0], "tomato")).toBe("#ff6347");
    expect(run("hex", "rgb", [0, 0, 0], "#abc")).toBe("rgb(170, 187, 204)");
    expect(run("hex", "hex", [0, 0, 0], "not a colour")).toBe("#000000");
    expect(run("hex", "rgb", [0, 0, 0], "#11223380")).toBe("rgba(17, 34, 51, 0.5)");
    expect(run("hex", "hex", [0, 0, 0], "")).toBe("#000000");
    expect(run("hex", "hex", [0, 0, 0], "hsl(200, 50%, 40%)")).toMatch(/^#/);
    expect(run("hex", "hex", [0, 0, 0], "rgb(10 20 30 / 50%)")).toBe("#0a141e80");
    expect(run("hex", "hex", [0, 0, 0], "transparent")).toBe("#00000000");
  });

  it("Color Blend reads every colour syntax colord does", () => {
    const run = (mode: BlendMode, a: unknown, b: unknown) => {
      const n = new ColorBlendNode({ mode });
      return n.data({ a: [a as string], b: [b as string] }).color;
    };
    for (const [a, b] of [
      ["#fff", "#000"], ["rgb(255, 0, 0)", "rgba(0,0,255,0.5)"], ["hsl(120, 100%, 50%)", "hsla(240deg, 50%, 50%, 1)"],
      ["hsl(0.5turn 100% 50%)", "rgb(100% 0% 50%)"], ["  Navy ", "REBECCAPURPLE"], ["#12345678", "#1234"], ["hsl(1rad, 40%, 60%)", "hsl(100grad, 40%, 60%)"],
      ["rgb(10, 20%, 30)", "#ff0000"], ["#ggg", "#000"], ["rgb(300, -5, 20)", "hsl(-90, 150%, 50%)"],
    ]) {
      expect(typeof run("multiply", a, b) === "string" || isSolError(run("multiply", a, b))).toBe(true);
      run("overlay", a, b);
      run("soft-light", b, a);
    }
  });
});

describe("Input Switch", () => {
  it("routes the active slot in one mode and collects the checked ones in many", () => {
    const n = new CableSwitchNode();
    n.addValueInput();
    for (const i of [0, 1, 2, 5, -1]) {
      n.activeIndex = i;
      n.data({ v0: [1], v1: ["two"], v2: [[3, 4]] });
    }
    n.activeIndex = 1;
    expect(n.data({ v0: [1] }).out).toBeNull();
    expect(n.data({ v1: [frame(["a", "number", [1, 2]])] }).out).toEqual(frame(["a", "number", [1, 2]]));
    n.multiSelect = true;
    n._sourceNames = { v0: "  ", v1: "Second", v2: " Third " };
    n.selectedKeys = ["v2", "v0", "gone"];
    const out = n.data({ v0: [1], v2: [frame(["a", "number", [1]])] }).out as CubeValue;
    expect(out.columns[0].cells).toEqual(["Input 1", "Third"]);
    n.selectedKeys = ["v1"];
    expect((n.data({ v1: [[1, 2, 3]] }).out as CubeValue).columns[1].cells).toEqual([[1, 2, 3]]);
    expect((n.data({ v1: [null] }).out as CubeValue).columns[1].cells).toEqual([null]);
  });
});

describe("Value Input outside dates", () => {
  it("reads numbers with their unit, text and logicals", () => {
    const run = (op: "number" | "string" | "logical", value: string, unit = "none", customUnit = "") => new ValueInputNode({ op, value, unit, customUnit }).data().value;
    expect(run("number", "")).toBe(0);
    expect(run("number", " 42 ")).toBe(42);
    expect(run("number", "1e3")).toBe(1000);
    expect(isSolError(run("number", "0x1F"))).toBe(true); // text, as in Excel ([[C58]] tableInputRawText)
    expect(isSolError(run("number", "abc"))).toBe(true);
    expect(isSolError(run("number", "Infinity"))).toBe(true);
    expect(isUnitCell(run("number", "2", "km"))).toBe(true);
    expect(isUnitCell(run("number", "3", "custom", " Widgets "))).toBe(true);
    expect(run("number", "3", "custom", "  ")).toBe(3);
    expect(run("number", "4", "pct")).toBeDefined();
    expect(run("number", "5", "nope")).toBe(5);
    expect(run("string", "  hi  ")).toBe("  hi  ");
    // Nothing typed is nothing, so ISBLANK downstream is TRUE; spaces stay text (docs/p7-walk.md).
    expect(run("string", "")).toBeNull();
    expect(run("string", " ")).toBe(" ");
    expect(run("logical", " TRUE ")).toBe(true);
    expect(isSolError(run("logical", "yes"))).toBe(true); // the card keeps its type, as a Number card does
    expect(run("logical", "true")).toBe(true);
  });
});

describe("the random draws' bodies", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("RAND draws between the bounds, either way round", () => {
    const n = new RandBetweenNode();
    const r = n.data({}).result as number;
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
    const s = n.data({ bound1: [20], bound2: [10] }).result as number;
    expect(s).toBeGreaterThan(10);
    expect(s).toBeLessThanOrEqual(20);
    expect(n.data({ bound1: [null as unknown as number] })).toEqual({ result: null });
  });

  it("RAND holds its roll through passes and rescales it live; a recalc rolls again", async () => {
    const n = new RandBetweenNode();
    const g = await inEditor(n);
    const a = (await g.pass("result")) as number;
    expect(await g.pass("result")).toBe(a);
    n.literals = { bound1: 10, bound2: 20 };
    n.edited();
    expect(await g.pass("result")).toBeCloseTo(10 + a * 10, 12);
    g.recalc();
    expect(await g.pass("result")).not.toBe(10 + a * 10);
    g.dispose();
  });

  it("RANDARRAY answers an error in Count, Min or Max, the first in that order", () => {
    const n = new RandArrayNode();
    const na = solError("#N/A", "x");
    const div = solError("#DIV/0!", "y");
    expect(n.data({ min: [na], max: [div] }).list).toMatchObject({ code: "#N/A" });
    expect(n.data({ min: [3], max: [div] }).list).toMatchObject({ code: "#DIV/0!" });
    expect(n.data({ count: [div], min: [na] }).list).toMatchObject({ code: "#DIV/0!" });
    expect(n.data({ count: [-1], min: [na] }).list).toMatchObject({ code: "#N/A" });
    expect(n.data({ count: [2], min: [3], max: [4] }).list).toHaveLength(2);
  });

  it("RANDARRAY holds its rolls: a longer count extends them, new bounds rescale them, a recalc rolls again", async () => {
    const n = new RandArrayNode();
    n.literals = { count: 3 };
    const g = await inEditor(n);
    const a = (await g.pass("list")) as number[];
    expect(a).toHaveLength(3);
    expect(await g.pass("list")).toEqual(a);
    n.literals = { count: 5 };
    n.edited();
    const longer = (await g.pass("list")) as number[];
    expect(longer.slice(0, 3)).toEqual(a);
    n.literals = { count: 5, min: 0, max: 10 };
    n.edited();
    expect(((await g.pass("list")) as number[]).map((x) => x / 10)).toEqual(longer.map((x) => expect.closeTo(x, 12)));
    g.recalc();
    expect(((await g.pass("list")) as number[]).slice(0, 3)).not.toEqual(a.map((x) => x * 10));
    g.dispose();
  });

  it("Shuffle answers a permutation, weighted or not", () => {
    const n = new ShuffleNode();
    expect([...(n.data({ list: [["a", "b", "c"]] }).result as string[])].sort()).toEqual(["a", "b", "c"]);
    expect((n.data({ list: [["a", "b", "c"]], weights: [[0, 1, 0]] }).result as string[])[0]).toBe("b");
    expect(isSolError(n.data({ list: [["a", "b", "c"]], weights: [[1]] }).result)).toBe(true);
    expect(isSolError(n.data({ list: [["a", "b", "c"]], weights: [[0, 0, 0]] }).result)).toBe(true);
    expect(n.data({ list: [[]] }).result).toEqual([]);
    expect([...(n.data({ list: [[1, 2]], weights: [[2, "x", 5]] }).result as number[])].sort()).toEqual([1, 2]);
  });

  it("Shuffle holds its order through passes while values change in place", async () => {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    const src = new Src(letters);
    const n = new ShuffleNode();
    const g = await inEditor(n);
    await g.wire(src, "list");
    const a = (await g.pass("result")) as string[];
    expect(await g.pass("result")).toEqual(a);
    src.out = letters.map((l) => l.toUpperCase());
    expect(await g.pass("result")).toEqual(a.map((l) => l.toUpperCase()));
    g.dispose();
  });

  it("UUID and Promo hold their draw through passes; a recalc draws again", async () => {
    const u = new UuidNode();
    expect(u.data().result).toMatch(UUID);
    const g = await inEditor(u);
    const id = await g.pass("result");
    expect(id).toMatch(UUID);
    expect(await g.pass("result")).toBe(id);
    g.recalc();
    expect(await g.pass("result")).not.toBe(id);
    g.dispose();
    const p = new PromoNode();
    expect(typeof p.data().value).toBe("string");
    const h = await inEditor(p);
    const line = await h.pass("value");
    expect(typeof line).toBe("string");
    expect(await h.pass("value")).toBe(line);
    h.dispose();
  });

  it("Distributions samples every family", () => {
    for (const op of ["normal", "binom", "poisson", "t", "expon", "hypgeom", "beta", "weibull", "negbinom", "chisq"] as const) {
      const n = new DistributionsNode({ op, form: "sample" });
      n.literals.count = 7;
      expect(n.data({}).result).toHaveLength(7);
    }
    const n = new DistributionsNode({ op: "normal", form: "sample" });
    expect(n.data({ count: [[3, 9]], mean: [[5]] }).result).toHaveLength(3);
    expect(n.data({ count: [null] }).result).toBeNull();
    expect(n.data({ count: [-4] }).result).toEqual([]);
  });
});

describe("the small frame cards", () => {
  const people = frame(["Person", "string", ["Ada", "Bo", "Cy", "ada"]], ["Paid", "number", [300, 100, 0, 20]], ["Share", "number", [1, 1, 2, null]]);
  const mixed = frame(["Name", "string", ["x", "y", "z"]], ["A", "number", [1, 2, 4]], ["B", "number", [2, 4, 9]], ["When", "date", [45000, 45001, 45002]], ["Ok", "logical", [true, false, true]]);

  it("Headers promotes and demotes", () => {
    for (const action of ["promote", "demote"] as const) {
      const n = new HeadersNode({ action });
      n.data({ frame: [mixed] });
      n.data({ frame: [frame(["c1", "string", ["Name", "Ada"]], ["c2", "number", [7, 8]])] });
      n.data({ frame: [frame()] });
      n.data({ frame: [null] });
    }
  });

  it("Split Frame splits by each column type", () => {
    for (const colType of ["all", "number", "string", "date", "logical"] as const) {
      const n = new SplitFrameNode({ colType });
      n.data({ frame: [mixed] });
      n.data({ frame: [frame(["A", "number", [1, null, 3]], ["B", "number", [NaN, 5]])] });
    }
    const s = new SplitFrameNode({ colType: "string" });
    expect(s.data({ frame: [frame(["T", "string", ["a", null, 3]])] }).matrix).toEqual([["a"], [""], ["3"]]);
  });

  it("Group Cost Settle settles totals and a ledger", () => {
    for (const split of ["equal", "weighted"] as const) {
      const n = new SettleNode({ split });
      n.data({ in: [people] });
      n.data({ in: [frame(["Who", "string", ["A", "B"]], ["Amount", "number", [50, 0]])] });
      n.data({ in: [frame(["Who", "string", ["A"]])] });
      n.data({ in: [cube(["Person", ["A", "B"]], ["Paid", [10, 30]])] });
    }
    const t = new SettleNode({ mode: "transactions" });
    t.data({ in: [cube(["Amount", [30, 60, 12]], ["Paid by", ["Ada", "Bo", "Cy"]], ["For", ["", "Ada, Cy", "Bo"]])] });
    t.data({ in: [frame(["Amount", "number", [30, 60]], ["Paid by", "string", ["Ada", "Bo"]], ["For", "string", ["Bo", ""]])] });
    t.data({ in: [cube(["Cost", [5]], ["Payer", ["Ada"]])] });
    t.data({ in: [cube(["Amount", [5]])] });
    t.data({ in: [null] });
  });

  it("Settle's ledger answers an error among its names, and #VALUE! for a logical", () => {
    const t = new SettleNode({ mode: "transactions" });
    const na = solError("#N/A", "no payer");
    const code = (r: { transfers: unknown; net: unknown }) => [r.transfers, r.net].map((v) => (isSolError(v) ? v.code : v));
    expect(code(t.data({ in: [cube(["Amount", [30, 60]], ["Paid by", ["Ada", na]], ["For", ["", ""]])] }))).toEqual(["#N/A", "#N/A"]);
    expect(code(t.data({ in: [cube(["Amount", [30, 60]], ["Paid by", ["Ada", "Bo"]], ["For", ["", ["Ada", na]]])] }))).toEqual(["#N/A", "#N/A"]);
    expect(code(t.data({ in: [cube(["Amount", [30]], ["Paid by", [true]])] }))).toEqual(["#VALUE!", "#VALUE!"]);
    expect(code(t.data({ in: [frame(["Amount", "number", [30, 60]], ["Paid by", "string", ["Ada", "Bo"]], ["For", "logical", [null, false]])] }))).toEqual(["#VALUE!", "#VALUE!"]);
    expect(isSolError(t.data({ in: [cube(["Amount", [30, 5]], ["Paid by", ["", "Ada"]], ["For", [na, ""]])] }).transfers)).toBe(false);
  });

  it("Describe and Correlation Matrix summarize", () => {
    const d = new DescribeNode();
    d.data({ frame: [mixed] });
    d.data({ frame: [frame(["A", "number", [1, null, NaN, 4]], ["S", "string", ["a", "a", "", null]])] });
    d.data({ frame: [frame()] });
    for (const method of ["pearson", "spearman", "kendall", "covariance"] as const) {
      const c = new CorrMatrixNode({ method });
      c.data({ frame: [mixed] });
      c.data({ frame: [frame(["A", "number", [1, 2, null, 4]], ["B", "number", [3, 3, 3, 3]], ["C", "number", [4, 1, 2, null]])] });
    }
  });

  it("PCA fits the number columns", () => {
    for (const standardize of [false, true]) {
      const n = new PcaNode({ standardize });
      n.data({ frame: [mixed] });
      n.data({ frame: [frame(["A", "number", [1, 2, null, 4, 5]], ["B", "number", [2, 1, 4, 3, 6]], ["C", "number", [0, 0, 1, 1, 0]])] });
      n.data({ frame: [frame(["S", "string", ["a"]])] });
      n.data({ frame: [frame(["A", "number", [1]])] });
    }
  });

  it("Decision Sensitivity runs scenarios and flip points", () => {
    const scores = frame(["Option", "string", ["A", "B", "C"]], ["Cost", "number", [7, 5, 8]], ["Speed", "number", [9, 6, 4]], ["Risk", "number", [4, 8, 6]]);
    const scenarios = frame(["Criterion", "string", ["Cost", "Speed", "Risk"]], ["Balanced", "number", [-1, 1, -1]], ["Cost-first", "number", [-3, 1, -1]], ["Speed-first", "number", [-1, 3, -1]]);
    const weights = frame(["Criterion", "string", ["Cost", "Speed", "Risk"]], ["Weight", "number", [-1, 2, -1]]);
    for (const normalize of ["max", "range", "rank", "none"] as const) {
      const s = new DecisionSensitivityNode({ normalize });
      s.data({ scores: [scores], scenarios: [scenarios] });
      s.data({ scores: [scores], scenarios: [frame(["Criterion", "string", ["Cost"]], ["Only", "number", [2]])] });
      const f = new DecisionSensitivityNode({ normalize, mode: "flips" });
      f.data({ scores: [scores], scenarios: [weights] });
      f.data({ scores: [scores] });
    }
  });
});

describe("SVG Picker", () => {
  it("names a picked layer only where the markup has it", () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg"><g id="Roof"><rect width="1" height="1"/></g><path data-name="Door &amp; Frame" d="M0 0"/><g inkscape:label='Win&#65;'/></svg>`;
    for (const [layer, want] of [["Roof", "Roof"], ["Door & Frame", "Door & Frame"], ["WinA", "WinA"], ["Chimney", null], ["", null]] as const) {
      const n = new SvgPickerNode({ source: src, selectedLayer: layer });
      expect(n.data().layer).toBe(want);
    }
    expect(new SvgPickerNode({ source: "" }).data()).toEqual({ chart: null, layer: null });
  });
});

describe("Molar Mass", () => {
  it("reads one formula", () => {
    const run = (f: unknown) => new MolarMassNode().data({ formula: [f as string] }).result;
    expect(run("H2O")).toBeCloseTo(18.015, 3);
    expect(isSolError(run(["H2O", "CO2"]))).toBe(true);
    expect(run("  ")).toBeNull();
    expect(isSolError(run("Zz"))).toBe(true);
  });
});
