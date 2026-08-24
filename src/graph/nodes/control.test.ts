import { describe, it, expect } from "vitest";
import {
  PointPlotterNode, CurveNode, GridPainterNode,
  parsePoints, pointsToText, curvePoints, monotoneCubic,
  parsePaintGrid, paintGridToText,
} from "./control";
import { extractInit } from "../copyPaste";

// The 2026-07-16 draw-your-data controls: Point Plotter / Curve / Grid Painter.
// Their stored truth is TEXT (pointsText / tableText), so the codecs and the
// extractInit round-trips are the load-bearing parts.

describe("point text codec", () => {
  it("parses 'x, y' lines, skipping malformed ones", () => {
    expect(parsePoints("1, 2\nbad line\n3.5, -4\n5")).toEqual([[1, 2], [3.5, -4]]);
    expect(parsePoints("")).toEqual([]);
    expect(parsePoints(undefined)).toEqual([]);
  });

  it("round-trips and trims float dust to 4 decimals", () => {
    const pts: Array<[number, number]> = [[0.30000000000004, 1], [2, 3.14159265]];
    expect(parsePoints(pointsToText(pts))).toEqual([[0.3, 1], [2, 3.1416]]);
  });
});

describe("monotoneCubic", () => {
  it("passes through its control points exactly", () => {
    const f = monotoneCubic([0, 1, 3], [0, 2, 1]);
    expect(f(0)).toBe(0);
    expect(f(1)).toBe(2);
    expect(f(3)).toBe(1);
  });

  it("never overshoots between points (Fritsch–Carlson) and is flat beyond the ends", () => {
    const f = monotoneCubic([0, 1, 2], [0, 0, 10]);
    for (let x = 0; x <= 2; x += 0.05) {
      expect(f(x)).toBeGreaterThanOrEqual(-1e-12);
      expect(f(x)).toBeLessThanOrEqual(10 + 1e-12);
    }
    expect(f(-5)).toBe(0);
    expect(f(99)).toBe(10);
  });

  it("a monotone dataset yields a monotone curve", () => {
    const f = monotoneCubic([0, 1, 2, 3], [0, 0.1, 5, 5.2]);
    let prev = -Infinity;
    for (let x = 0; x <= 3; x += 0.02) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it("curvePoints sorts by x and collapses duplicate x (last wins)", () => {
    expect(curvePoints("2, 5\n0, 1\n2, 9")).toEqual([[0, 1], [2, 9]]);
  });
});

describe("PointPlotterNode", () => {
  it("emits a two-column X / Y frame from its points text", () => {
    const n = new PointPlotterNode({ pointsText: "1, 2\n3, 4" });
    const frame = n.data().result;
    expect(frame.columns.map((c) => c.name)).toEqual(["X", "Y"]);
    expect(frame.columns[0].values).toEqual([1, 3]);
    expect(frame.columns[1].values).toEqual([2, 4]);
    // Empty points → an empty frame (0 rows), not null.
    const empty = new PointPlotterNode().data().result;
    expect(empty.columns.map((c) => c.name)).toEqual(["X", "Y"]);
    expect(empty.columns[0].values).toEqual([]);
  });

  it("points + ranges round-trip through extractInit", () => {
    const n = new PointPlotterNode();
    n.pointsText = "1, 2\n3, 4";
    n.literals.xmax = 20;
    const n2 = new PointPlotterNode(extractInit(n));
    expect(n2.pointsText).toBe("1, 2\n3, 4");
    expect(n2.literals.xmax).toBe(20);
  });
});

describe("CurveNode", () => {
  it("samples the spline across [xmin, xmax], endpoints exact", () => {
    const n = new CurveNode({ pointsText: "0, 0\n1, 1", samples: 5 });
    const out = n.data();
    expect(out.xs).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(out.values[0]).toBe(0);
    expect(out.values[4]).toBe(1);
    // The default diagonal through a monotone spline IS the diagonal.
    expect(out.values[2]).toBeCloseTo(0.5, 9);
  });

  it("clamps samples and handles an empty curve", () => {
    const n = new CurveNode({ pointsText: "", samples: 0 });
    expect(n.data()).toEqual({ values: [], xs: [] });
    expect(n.literals.samples).toBe(2); // clamped
  });

  it("round-trips through extractInit", () => {
    const n = new CurveNode();
    n.pointsText = "0, 1\n0.5, 0\n1, 1";
    n.literals.samples = 8;
    const n2 = new CurveNode(extractInit(n));
    expect(n2.pointsText).toBe(n.pointsText);
    expect(n2.literals.samples).toBe(8);
  });
});

describe("GridPainterNode", () => {
  it("grid text round-trips; blanks stay null", () => {
    const g: (number | null)[][] = [[1, null], [null, 2.5]];
    expect(parsePaintGrid(paintGridToText(g), 2, 2)).toEqual(g);
  });

  it("resizing keeps overlapping cells, pads new ones with null", () => {
    const text = paintGridToText([[1, 2], [3, 4]]);
    expect(parsePaintGrid(text, 3, 3)).toEqual([[1, 2, null], [3, 4, null], [null, null, null]]);
    expect(parsePaintGrid(text, 1, 1)).toEqual([[1]]);
  });

  it("emits its matrix at the literals' dimensions and round-trips", () => {
    const n = new GridPainterNode({ tableText: "1,,\n,2,", rows: 2, cols: 3 });
    expect(n.data()).toEqual({ result: [[1, null, null], [null, 2, null]] });
    const n2 = new GridPainterNode(extractInit(n));
    expect(n2.tableText).toBe("1,,\n,2,");
    expect(n2.literals.rows).toBe(2);
    expect(n2.data()).toEqual(n.data());
  });
});
