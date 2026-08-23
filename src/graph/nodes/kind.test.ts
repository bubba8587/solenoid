import { describe, it, expect } from "vitest";
import { nodeDomWeight, nodeAccent, nodeKindOf } from "./kind";
import { NumberInputNode, BooleanInputNode } from "./input";
import { ChartNode, HistogramNode, TreemapNode, SankeyNode, MermaidNode, HeatmapCellNode, SparklineNode, GaugeNode, ChartBuilderNode } from "./visual";
import { TornadoNode } from "./tornado";
import { SvgPickerNode } from "./annotation";
import { BuildFrameNode } from "./frame";
import { ComparisonNode } from "./logic";
import { ListInputNode } from "./list";
import { TableInputNode } from "./matrix";
import { NODE_KIND_ACCENTS } from "./shared";
import { SOCKET_COLORS } from "../sockets";

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

  it("weighs an SVG Picker as a light idle figure (rasterized <img>, not the old inlined SVG)", () => {
    // Since the rasterize-for-display change the well shows an <img> at rest and
    // only mounts the heavy inline SVG on hover — which never overlaps a pan/zoom
    // gesture, the only time the gate reads this. So its steady-state weight sits
    // down with the frame-grid tier, well below a full chart, NOT heaviest of all.
    const svg = nodeDomWeight(new SvgPickerNode());
    expect(svg).toBeGreaterThan(nodeDomWeight(new NumberInputNode()));
    expect(svg).toBeLessThan(nodeDomWeight(new ChartNode()));
  });

  it("calibrates ~10 full charts to the default 100 engage threshold", () => {
    expect(nodeDomWeight(new ChartNode()) * 10).toBeGreaterThanOrEqual(100);
  });
});

// The card, the minimap and the html-canvas snapshot ALL read nodeAccent — a divergence
// here is a minimap that stays one color while the card recolors. This pins that the
// type-switchable literals track their SOCKET color (so a retype recolors) while a plain
// node keeps its fixed KIND color.
describe("nodeAccent", () => {
  it("gives a plain node its kind color", () => {
    const n = new NumberInputNode();
    expect(nodeAccent(n)).toBe(NODE_KIND_ACCENTS[nodeKindOf(n)]);
  });

  it("tracks the element-socket color across a List Input retype", () => {
    const n = new ListInputNode();
    expect(nodeAccent(n)).toBe(SOCKET_COLORS[n.valueSocket.dataType]);
    const before = nodeAccent(n);
    n.setDataType("string");
    expect(nodeAccent(n)).toBe(SOCKET_COLORS[n.valueSocket.dataType]);
    expect(nodeAccent(n)).not.toBe(before); // the whole point: it recolored
  });

  it("tracks the element-socket color across a Table Input retype", () => {
    const n = new TableInputNode();
    const before = nodeAccent(n);
    n.setDataType("string");
    expect(nodeAccent(n)).not.toBe(before);
  });
});
