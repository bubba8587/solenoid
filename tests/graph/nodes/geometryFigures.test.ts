// [[C25]]
import { describe, it, expect } from "vitest";
import { CircleSolverNode, RegularPolygonNode, TwoPointsNode, PolygonPointsNode, SolidNode } from "../../../src/graph/nodes/geometryFigures";
import { isSolError } from "../../../src/graph/errorValue";
import type { FrameValue } from "../../../src/graph/frame";
import type { ColumnUnit } from "../../../src/graph/unitValue";

type Row = Record<string, number | string | null | undefined>;
const frameOf = (rows: Row[], units: Record<string, ColumnUnit> = {}): FrameValue => {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return {
    __frame: true,
    columns: names.map((name) => ({ name, type: "number", values: rows.map((r) => r[name] ?? null), ...(units[name] ? { unit: units[name] } : {}) })),
  } as FrameValue;
};
const solve = (node: { data: (i: Record<string, unknown[]>) => unknown }, key: string, rows: Row[], units: Record<string, ColumnUnit> = {}) =>
  node.data({ [key]: [frameOf(rows, units)] }) as { frame: FrameValue; valid?: unknown[] };
const cell = (f: FrameValue, name: string, row = 0) => f.columns.find((c) => c.name === name)?.values[row];
const code = (v: unknown) => (isSolError(v) ? v.code : v);

describe("Circle Solver", () => {
  const circle = (g: Row) => solve(new CircleSolverNode(), "circles", [g]);
  it("a radius and an angle give every part", () => {
    const { frame, valid } = circle({ r: 5, angle: 60 });
    expect(cell(frame, "d")).toBe(10);
    expect(cell(frame, "arc")).toBeCloseTo((5 * Math.PI) / 3, 12);
    expect(cell(frame, "chord")).toBeCloseTo(5, 12);
    expect(cell(frame, "sector")).toBeCloseTo((25 * Math.PI) / 6, 12);
    expect(cell(frame, "height")).toBeCloseTo(5 * (1 - Math.cos(Math.PI / 6)), 12);
    expect(valid).toEqual([true]);
  });
  it("any whole-circle part gives the radius; with no arc part the arc columns stay blank", () => {
    const { frame } = circle({ area: Math.PI * 16 });
    expect(cell(frame, "r")).toBeCloseTo(4, 12);
    expect(cell(frame, "circumference")).toBeCloseTo(8 * Math.PI, 12);
    expect(cell(frame, "arc")).toBeNull();
  });
  it("two arc parts find both; a chord with a radius fits a minor and a major arc, unless it is the diameter", () => {
    const arc = (5 * Math.PI) / 3, chord = 5;
    expect(cell(circle({ arc, chord }).frame, "r")).toBeCloseTo(5, 9);
    expect(cell(circle({ arc, chord }).frame, "angle")).toBeCloseTo(60, 7);
    expect(cell(circle({ arc, sector: (25 * Math.PI) / 6 }).frame, "r")).toBeCloseTo(5, 12);
    expect(code(cell(circle({ r: 5, chord: 5 }).frame, "angle"))).toBe("#SOLVE!");
    expect(cell(circle({ r: 5, chord: 10 }).frame, "angle")).toBeCloseTo(180, 5);
    expect(cell(circle({ r: 5, height: 5 * (1 - Math.cos(Math.PI / 6)) }).frame, "angle")).toBeCloseTo(60, 7);
    expect(code(cell(circle({ r: 5, chord: 11 }).frame, "angle"))).toBe("#DOMAIN!");
  });
  it("an extra part checks; an angle past a turn is #DOMAIN!", () => {
    expect(circle({ r: 5, angle: 60, chord: 5 }).valid).toEqual([true]);
    expect(circle({ r: 5, angle: 60, chord: 6 }).valid).toEqual([false]);
    expect(code(cell(circle({ r: 5, angle: 400 }).frame, "arc"))).toBe("#DOMAIN!");
  });
  it("[[C25]] lengths read in the first length's unit, the areas in its square", () => {
    const cm = { dim: { length: 1 }, display: "cm" }, m = { dim: { length: 1 }, display: "m" };
    const { frame, valid } = solve(new CircleSolverNode(), "circles", [{ r: 50, d: 1, angle: 90 }], { r: cm, d: m });
    expect(valid).toEqual([true]);
    expect(cell(frame, "d")).toBeCloseTo(100, 12);
    expect(frame.columns.find((c) => c.name === "arc")?.unit?.display).toBe("cm");
    expect(frame.columns.find((c) => c.name === "area")?.unit?.dim).toEqual({ length: 2 });
  });
});

describe("Regular Polygon", () => {
  const poly = (g: Row) => solve(new RegularPolygonNode(), "polygons", [g]);
  it("n and a size give every part", () => {
    const { frame, valid } = poly({ n: 6, side: 4 });
    expect(cell(frame, "circumradius")).toBeCloseTo(4, 12);
    expect(cell(frame, "apothem")).toBeCloseTo(2 * Math.sqrt(3), 12);
    expect(cell(frame, "area")).toBeCloseTo(24 * Math.sqrt(3), 12);
    expect([cell(frame, "interior"), cell(frame, "exterior")]).toEqual([120, 60]);
    expect(valid).toEqual([true]);
  });
  it("an angle gives n; two sizes find it; n must be whole and at least 3", () => {
    expect(cell(poly({ interior: 108, perimeter: 10 }).frame, "n")).toBe(5);
    expect(cell(poly({ exterior: 45, apothem: 1 }).frame, "n")).toBe(8);
    expect(cell(poly({ side: 4, circumradius: 4 }).frame, "n")).toBe(6);
    expect(cell(poly({ side: 2, perimeter: 14 }).frame, "n")).toBe(7);
    expect(code(cell(poly({ n: 2.5, side: 1 }).frame, "area"))).toBe("#DOMAIN!");
    expect(code(cell(poly({ interior: 100, side: 1 }).frame, "area"))).toBe("#DOMAIN!");
  });
  it("n alone answers the angles and leaves the sizes blank; an extra size checks", () => {
    expect(cell(poly({ n: 4 }).frame, "interior")).toBe(90);
    expect(cell(poly({ n: 4 }).frame, "side")).toBeNull();
    expect(poly({ n: 4, side: 1, area: 1 }).valid).toEqual([true]);
    expect(poly({ n: 4, side: 1, area: 2 }).valid).toEqual([false]);
  });
  it("n takes no unit", () => {
    const { frame } = solve(new RegularPolygonNode(), "polygons", [{ n: 6, side: 1 }], { n: { dim: { length: 1 }, display: "m" } });
    expect(code(cell(frame, "area"))).toBe("#UNIT!");
  });
});

describe("Two Points", () => {
  const pts = (g: Row) => solve(new TwoPointsNode(), "points", [g]).frame;
  it("the segment and the line through it", () => {
    const f = pts({ x1: 1, y1: 2, x2: 5, y2: 5 });
    expect(cell(f, "distance")).toBe(5);
    expect([cell(f, "dx"), cell(f, "dy"), cell(f, "mid x"), cell(f, "mid y")]).toEqual([4, 3, 3, 3.5]);
    expect(cell(f, "slope")).toBe(0.75);
    expect(cell(f, "angle")).toBeCloseTo((Math.atan2(3, 4) * 180) / Math.PI, 12);
    expect(cell(f, "y-intercept")).toBe(1.25);
    expect(cell(f, "x-intercept")).toBeCloseTo(-5 / 3, 12);
    expect(cell(f, "equation")).toBe("y = 0.75x + 1.25");
  });
  it("what a vertical or horizontal line leaves undefined is #DIV/0!", () => {
    const v = pts({ x1: 2, y1: 0, x2: 2, y2: 3 });
    expect([code(cell(v, "slope")), code(cell(v, "y-intercept")), cell(v, "x-intercept"), cell(v, "equation")]).toEqual(["#DIV/0!", "#DIV/0!", 2, "x = 2"]);
    const h = pts({ x1: 0, y1: -1, x2: 4, y2: -1 });
    expect([cell(h, "slope"), code(cell(h, "x-intercept")), cell(h, "equation")]).toEqual([0, "#DIV/0!", "y = -1"]);
    expect(cell(pts({ x1: 0, y1: 0, x2: 1, y2: -1 }), "equation")).toBe("y = -x");
    expect(code(cell(pts({ x1: 1, y1: 1, x2: 1, y2: 1 }), "slope"))).toBe("#DIV/0!");
  });
  it("a missing coordinate leaves the row blank", () => {
    expect(cell(pts({ x1: 1, y1: 2, x2: 5 }), "distance")).toBeNull();
  });
});

describe("keyed tables", () => {
  it("each card solves its own default", () => {
    expect((new CircleSolverNode().data({}) as { valid: unknown[] }).valid).toEqual([true]);
    expect((new RegularPolygonNode().data({}) as { valid: unknown[] }).valid).toEqual([true]);
    expect(cell((new TwoPointsNode().data({}) as { frame: FrameValue }).frame, "distance")).toBe(5);
  });
});

describe("Polygon from Points", () => {
  const poly = (rows: Row[]) => new PolygonPointsNode().data({ vertices: [frameOf(rows)] }) as { vertices: FrameValue; polygon: FrameValue };
  const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  it("the shoelace area, perimeter, centroid; each vertex's edge and interior angle", () => {
    const { vertices, polygon } = poly(square);
    expect([cell(polygon, "vertices"), cell(polygon, "area"), cell(polygon, "perimeter")]).toEqual([4, 4, 8]);
    expect([cell(polygon, "centroid x"), cell(polygon, "centroid y")]).toEqual([1, 1]);
    expect([cell(polygon, "convex"), cell(polygon, "orientation")]).toEqual([true, "counterclockwise"]);
    expect(vertices.columns.find((c) => c.name === "angle")!.values).toEqual([90, 90, 90, 90]);
    expect(vertices.columns.find((c) => c.name === "edge")!.values).toEqual([2, 2, 2, 2]);
  });
  it("a clockwise or concave polygon keeps its interior angles; a reflex one is over 180°", () => {
    const cw = poly([...square].reverse());
    expect(cell(cw.polygon, "orientation")).toBe("clockwise");
    expect(cell(cw.polygon, "area")).toBe(4);
    expect(cw.vertices.columns.find((c) => c.name === "angle")!.values).toEqual([90, 90, 90, 90]);
    const dart = poly([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 4 }]);
    expect(cell(dart.polygon, "convex")).toBe(false);
    const angles = dart.vertices.columns.find((c) => c.name === "angle")!.values as number[];
    expect(angles.reduce((a, b) => a + b, 0)).toBeCloseTo(360, 9);
    expect(Math.max(...angles)).toBeGreaterThan(180);
  });
  it("crossing edges have no one area; blank rows are skipped; fewer than three vertices is no polygon", () => {
    expect(code(cell(poly([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }]).polygon, "area"))).toBe("#DOMAIN!");
    expect(cell(poly([...square, { x: null, y: null }]).polygon, "area")).toBe(4);
    expect(cell(poly(square.slice(0, 2)).polygon, "area")).toBeNull();
    expect(code(cell(poly([...square, { x: 1, y: null }]).polygon, "area"))).toBe("#VALUE!");
  });
});

describe("Solid", () => {
  const solid = (op: string, g: Row) => solve(new SolidNode({ op }), "solids", [g]);
  it("each shape from its dimensions", () => {
    expect(cell(solid("sphere", { r: 3 }).frame, "volume")).toBeCloseTo(36 * Math.PI, 12);
    expect(cell(solid("cube", { side: 3 }).frame, "diagonal")).toBeCloseTo(3 * Math.sqrt(3), 12);
    expect(cell(solid("box", { length: 4, width: 3, height: 2 }).frame, "surface")).toBe(52);
    expect(cell(solid("cylinder", { r: 2, h: 5 }).frame, "lateral")).toBeCloseTo(20 * Math.PI, 12);
    expect(cell(solid("cone", { r: 3, h: 4 }).frame, "slant")).toBe(5);
    expect(cell(solid("pyramid", { base: 4, h: 3 }).frame, "volume")).toBe(16);
  });
  it("back from the measures: a sphere from its volume, a cone from slant and radius, a cylinder from volume and height", () => {
    expect(cell(solid("sphere", { volume: 36 * Math.PI }).frame, "r")).toBeCloseTo(3, 9);
    expect(cell(solid("cone", { r: 3, slant: 5 }).frame, "h")).toBeCloseTo(4, 9);
    expect(cell(solid("cylinder", { volume: 20 * Math.PI, h: 5 }).frame, "r")).toBeCloseTo(2, 9);
    expect(cell(solid("cube", { surface: 54 }).frame, "side")).toBeCloseTo(3, 9);
    expect(cell(solid("box", { length: 4, width: 3, volume: 24 }).frame, "height")).toBeCloseTo(2, 9);
  });
  it("two measures with no dimension: one fit solves, two are #SOLVE!", () => {
    const { frame, valid } = solid("cone", { volume: 12 * Math.PI, slant: 5 });
    // r = 3, h = 4 fits, and so does a second cone with the same slant and volume.
    expect(code(cell(frame, "r"))).toBe("#SOLVE!");
    expect(valid).toEqual([false]);
    const c = solid("cylinder", { d: 4, surface: 28 * Math.PI });
    expect(cell(c.frame, "h")).toBeCloseTo(5, 9);
  });
  it("an extra part checks; a volume takes the lengths' unit cubed; a switch of shape is a new table", () => {
    expect(solid("sphere", { r: 3, d: 6 }).valid).toEqual([true]);
    expect(solid("sphere", { r: 3, d: 7 }).valid).toEqual([false]);
    const cm = { dim: { length: 1 }, display: "cm" };
    const { frame } = solve(new SolidNode({ op: "cube" }), "solids", [{ side: 2 }], { side: cm });
    expect(frame.columns.find((c) => c.name === "volume")?.unit?.dim).toEqual({ length: 3 });
    expect(cell((new SolidNode({ op: "box" }).data({}) as { frame: FrameValue }).frame, "volume")).toBe(24);
  });
});
