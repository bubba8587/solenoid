// [[C42]] htmlInCanvasRenderer, [[html-in-canvas#Cables and overlays on the canvas]]
import { describe, expect, it } from "vitest";
import { shapeD, styleKey, visiblePaint } from "../../src/graph/hicVectors";

const shape = (tag: string, attrs: Record<string, string | number>) =>
  shapeD(tag, (a) => Number(attrs[a] ?? 0), (a) => (attrs[a] === undefined ? null : String(attrs[a])));

describe("shapeD", () => {
  it("passes a path's data through", () => {
    expect(shape("path", { d: "M 0,0 C 1,2 3,4 5,6" })).toBe("M 0,0 C 1,2 3,4 5,6");
  });

  it("turns a line, a rect and a polyline into path data", () => {
    expect(shape("line", { x1: 1, y1: 2, x2: 3, y2: 4 })).toBe("M 1 2 L 3 4");
    expect(shape("rect", { x: 1, y: 2, width: 3, height: 4 })).toBe("M 1 2 H 4 V 6 H 1 Z");
    expect(shape("polyline", { points: "0,0 10,0 10,10" })).toBe("M 0 0 L 10 0 L 10 10");
    expect(shape("polygon", { points: "0 0 10 0 10 10" })).toBe("M 0 0 L 10 0 L 10 10 Z");
  });

  it("draws a circle and an ellipse as two arcs", () => {
    expect(shape("circle", { cx: 5, cy: 5, r: 2 })).toBe("M 3 5 A 2 2 0 1 0 7 5 A 2 2 0 1 0 3 5 Z");
    expect(shape("ellipse", { cx: 0, cy: 0, rx: 2, ry: 1 })).toBe("M -2 0 A 2 1 0 1 0 2 0 A 2 1 0 1 0 -2 0 Z");
  });

  it("gives nothing for a shape that draws nothing", () => {
    expect(shape("circle", { cx: 0, cy: 0, r: 0 })).toBeNull();
    expect(shape("rect", { width: 0, height: 4 })).toBeNull();
    expect(shape("polyline", { points: "1" })).toBeNull();
    expect(shape("text", {})).toBeNull();
  });
});

describe("visiblePaint", () => {
  it("keeps a color and drops none, transparent and zero alpha, so a hit path draws nothing", () => {
    expect(visiblePaint("rgb(255, 0, 0)")).toBe("rgb(255, 0, 0)");
    expect(visiblePaint("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
    expect(visiblePaint("none")).toBeNull();
    expect(visiblePaint("transparent")).toBeNull();
    expect(visiblePaint("rgba(0, 0, 0, 0)")).toBeNull();
    expect(visiblePaint("rgb(0 0 0 / 0)")).toBeNull();
  });
});

describe("styleKey", () => {
  it("is equal for shapes that can share one path and differs on any style", () => {
    const base = { stroke: "red", fill: null, width: 1.8, alpha: 0.72, dash: null, cap: "butt" as const, join: "miter" as const };
    expect(styleKey(base)).toBe(styleKey({ ...base }));
    expect(styleKey(base)).not.toBe(styleKey({ ...base, width: 2.6 }));
    expect(styleKey(base)).not.toBe(styleKey({ ...base, dash: [6, 5] }));
  });
});
