// [[D99]] rustIsSpec, [[C28]] literalsIffEditable: the input widgets, lookups and random draws
// driven through their bodies over the fields and inputs that matter, so their frozen cases hold them.
import { describe, it, expect } from "vitest";
import { DateRangeNode, CurveNode, GridPainterNode, CableSwitchNode, ValueInputNode } from "../../../src/graph/nodes/control";
import { MolarMassNode } from "../../../src/graph/nodes/chemistry";
import { RandBetweenNode } from "../../../src/graph/nodes/display";
import { ShuffleNode, RandArrayNode } from "../../../src/graph/nodes/list";
import { UuidNode, PromoNode } from "../../../src/graph/nodes/text";
import { DistributionsNode } from "../../../src/graph/nodes/distribution";
import { inEditor, Src } from "../cardPasses";
import { SvgPickerNode } from "../../../src/graph/nodes/annotation";
import { isSolError, solError } from "../../../src/graph/errorValue";
import { isUnitCell } from "../../../src/graph/unitValue";
import type { FrameValue, CubeValue, FrameColType } from "../../../src/graph/frame";

const frame = (...cols: [string, FrameColType, unknown[]][]): FrameValue =>
  ({ __frame: true, columns: cols.map(([name, type, values]) => ({ name, type, values })) }) as FrameValue;

describe("the fixed-output widgets", () => {
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
    // A day before 1900 is a date ([[date-values#Days before 1900]]).
    expect(run(0, 45001)).toEqual({ start: 0, end: 45001 });
    expect(run(45001, -5)).toEqual({ start: -5, end: 45001 });
    expect(run()).toEqual({ start: null, end: null });
    expect(run(45000.5, 45000.25)).toEqual({ start: 45000.25, end: 45000.5 });
    expect(run(45000, 45000)).toEqual({ start: 45000, end: 45000 });
  });

});

describe("the drawn widgets", () => {
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
