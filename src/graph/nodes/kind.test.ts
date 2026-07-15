import { describe, it, expect } from "vitest";
import { nodeDomWeight } from "./kind";
import { NumberInputNode, BooleanInputNode } from "./input";
import { ChartNode, HistogramNode, TreemapNode, SankeyNode, MermaidNode, HeatmapCellNode, SparklineNode, GaugeNode, ChartBuilderNode } from "./visual";
import { TornadoNode } from "./tornado";
import { SvgPickerNode } from "./annotation";
import { BuildFrameNode } from "./frame";
import { ComparisonNode } from "./logic";

// nodeDomWeight feeds the HTML-in-Canvas engage gate: a chart / inlined-SVG /
// frame-grid card weighs more than a scalar card because it is far more DOM. The
// exact numbers are coarse-by-design, so we pin the ORDERING (the tiers) rather
// than assert brittle magic values — a scalar is the unit, and each heavier kind
// is strictly heavier than the tier below it.

describe("nodeDomWeight", () => {
  it("weighs a scalar / logic card as the baseline 1", () => {
    expect(nodeDomWeight(new NumberInputNode())).toBe(1);
    expect(nodeDomWeight(new BooleanInputNode())).toBe(1);
    expect(nodeDomWeight(new ComparisonNode())).toBe(1);
  });

  it("weighs a frame-grid preview above a scalar but below a chart", () => {
    const grid = nodeDomWeight(new BuildFrameNode());
    expect(grid).toBeGreaterThan(nodeDomWeight(new NumberInputNode()));
    expect(grid).toBeLessThan(nodeDomWeight(new ChartNode()));
  });

  it("weighs small inline figures above a frame grid", () => {
    for (const n of [new SparklineNode(), new GaugeNode(), new ChartBuilderNode()]) {
      expect(nodeDomWeight(n)).toBeGreaterThan(nodeDomWeight(new BuildFrameNode()));
      expect(nodeDomWeight(n)).toBeLessThan(nodeDomWeight(new ChartNode()));
    }
  });

  it("weighs full chart / diagram figures as the heavy tier", () => {
    for (const n of [new ChartNode(), new HistogramNode(), new TreemapNode(), new SankeyNode(), new MermaidNode()]) {
      expect(nodeDomWeight(n)).toBeGreaterThan(nodeDomWeight(new SparklineNode()));
    }
    // Grid-of-cells / inline-bar figures sit between the small figures and full charts.
    for (const n of [new HeatmapCellNode(), new TornadoNode()]) {
      expect(nodeDomWeight(n)).toBeGreaterThan(nodeDomWeight(new SparklineNode()));
      expect(nodeDomWeight(n)).toBeLessThan(nodeDomWeight(new ChartNode()));
    }
  });

  it("weighs an inlined SVG document heaviest of all", () => {
    const svg = nodeDomWeight(new SvgPickerNode());
    expect(svg).toBeGreaterThan(nodeDomWeight(new ChartNode()));
  });

  it("calibrates ~10 full charts to the default 100 engage threshold", () => {
    expect(nodeDomWeight(new ChartNode()) * 10).toBeGreaterThanOrEqual(100);
  });
});
