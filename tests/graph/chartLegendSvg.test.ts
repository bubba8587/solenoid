// [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { legendToSvg } from "../../src/graph/canvasCapture";

describe("legendToSvg", () => {
  it("draws one swatch and one label per series, escaping the names", () => {
    const svg = legendToSvg([{ color: "rgb(1, 2, 3)", label: "north" }, { color: "#f5b914", label: "a<b" }], 200, "#999");
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg.match(/<text /g)).toHaveLength(2);
    expect(svg).toContain('fill="rgb(1, 2, 3)"');
    expect(svg).toContain(">a&lt;b</text>");
  });
  it("centers the row in the width it is given", () => {
    const x = Number(/<rect x="([\d.]+)"/.exec(legendToSvg([{ color: "red", label: "ab" }], 100, "#999"))![1]);
    expect(x).toBeGreaterThan(30);
    expect(x).toBeLessThan(50);
  });
});
