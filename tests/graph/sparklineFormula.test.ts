// [[D82]] sparklineCell
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { sparklineSeries, sparklineImage, SPARKLINE_MAX_POINTS } from "../../src/graph/nodes/visualOps";
import { isSolError, solError } from "../../src/graph/errorValue";

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const svgOf = (url: unknown) => decodeURIComponent(String(url).replace(/^data:image\/svg\+xml,/, ""));

describe("SPARKLINE", () => {
  it("answers data:image/svg+xml text with one path for a line", () => {
    const r = ev("SPARKLINE(x)", { x: [1, 3, 2, 5] });
    expect(typeof r).toBe("string");
    expect(String(r).startsWith("data:image/svg+xml,")).toBe(true);
    const svg = svgOf(r);
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toContain("fill='none'");
  });

  it("draws columns and a two-color win/loss strip", () => {
    expect(svgOf(ev("SPARKLINE(x, \"column\")", { x: [1, 2, 3] })).match(/<path/g)).toHaveLength(1);
    const wl = svgOf(ev("SPARKLINE(x, \"winloss\")", { x: [1, -2, 0, 3] }));
    expect(wl.match(/<path/g)).toHaveLength(2);
    expect(wl).toContain("#00b862");
    expect(wl).toContain("#e0473a");
  });

  it("refuses an unknown type and passes a cell error through", () => {
    const bad = ev("SPARKLINE(x, \"pie\")", { x: [1, 2] });
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
    const err = solError("#DIV/0!", "x");
    expect(ev("SPARKLINE(x)", { x: [1, err, 3] })).toMatchObject({ code: "#DIV/0!" });
  });

  it("is blank with no numbers, and skips text and blanks", () => {
    expect(ev("SPARKLINE(x)", { x: ["a", null] })).toBeNull();
    expect(sparklineSeries([1, "a", null, 2, true])).toEqual([1, 2]);
  });

  it("reads a matrix row by row", () => {
    expect(ev("SPARKLINE(x)", { x: [[1, 2], [3, 4]] })).toBe(sparklineImage([1, 2, 3, 4], "line"));
  });

  it("caps a long range, so the picture's size doesn't grow with the data", () => {
    const long = Array.from({ length: 10_000 }, (_, i) => Math.sin(i / 50));
    const series = sparklineSeries(long);
    expect(series).toHaveLength(SPARKLINE_MAX_POINTS);
    const a = sparklineImage(long, "column")!;
    const b = sparklineImage(long.slice(0, 400), "column")!;
    expect(a.length).toBeLessThan(3000);
    expect(Math.abs(a.length - b.length)).toBeLessThan(400);
  });
});
