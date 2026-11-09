// [[C42]], [[B11]], [[palette-and-theme#Card colors]], [[html-in-canvas#When it runs]]
import { describe, it, expect } from "vitest";
import { nodeDomWeight, nodeAccent, nodeAccentSlot, nodeKindOf, explicitKindOf } from "../../../src/graph/nodes/kind";
import { majorityColor } from "../../../src/graph/groupLogic";
import { ValueInputNode } from "../../../src/graph/nodes/control";
import { ChartNode, HistogramNode, ProportionNode, SankeyNode, MermaidNode, HeatmapNode, SparklineNode, GaugeNode, ChartBuilderNode, KpiNode, RecordNode } from "../../../src/graph/nodes/visual";
import { GanttNode } from "../../../src/graph/nodes/gantt";
import { UrlEncodeNode } from "../../../src/graph/nodes/text";
import { EpochNode } from "../../../src/graph/nodes/date";
import { CombinatoricsNode } from "../../../src/graph/nodes/scalar";
import { TornadoNode } from "../../../src/graph/nodes/tornado";
import { SvgPickerNode } from "../../../src/graph/nodes/annotation";
import { BuildFrameNode } from "../../../src/graph/nodes/frame";
import { ComparisonNode } from "../../../src/graph/nodes/logic";
import { ListInputNode } from "../../../src/graph/nodes/list";
import { TableInputNode } from "../../../src/graph/nodes/matrix";
import { NODE_KIND_ACCENTS } from "../../../src/graph/nodes/shared";
import { SOCKET_COLORS } from "../../../src/graph/sockets";
import { themeAccent, socketVarHex, resolveColor } from "../../../src/graph/palette";

// The weights are coarse by design, so these hold the tiers' order, not their values.
describe("nodeDomWeight", () => {
  it("weighs a scalar / logic card as the baseline 1", () => {
    expect(nodeDomWeight(new ValueInputNode())).toBe(1);
    expect(nodeDomWeight(new ValueInputNode({ op: "logical" }))).toBe(1);
    expect(nodeDomWeight(new ComparisonNode())).toBe(1);
  });

  it("weighs a frame-grid preview above a scalar but below a chart", () => {
    const grid = nodeDomWeight(new BuildFrameNode());
    expect(grid).toBeGreaterThan(nodeDomWeight(new ValueInputNode()));
    expect(grid).toBeLessThan(nodeDomWeight(new ChartNode()));
  });

  it("weighs small inline figures above a frame grid", () => {
    for (const n of [new SparklineNode(), new GaugeNode(), new ChartBuilderNode()]) {
      expect(nodeDomWeight(n)).toBeGreaterThan(nodeDomWeight(new BuildFrameNode()));
      expect(nodeDomWeight(n)).toBeLessThan(nodeDomWeight(new ChartNode()));
    }
  });

  it("weighs full chart / diagram figures as the heavy tier", () => {
    for (const n of [new ChartNode(), new HistogramNode(), new ProportionNode(), new SankeyNode(), new MermaidNode(), new HeatmapNode()]) {
      expect(nodeDomWeight(n)).toBeGreaterThan(nodeDomWeight(new SparklineNode()));
    }
    for (const n of [new TornadoNode()]) {
      expect(nodeDomWeight(n)).toBeGreaterThan(nodeDomWeight(new SparklineNode()));
      expect(nodeDomWeight(n)).toBeLessThan(nodeDomWeight(new ChartNode()));
    }
  });

  it("weighs an SVG Picker as a light idle figure (rasterized <img>, not the old inlined SVG)", () => {
    const svg = nodeDomWeight(new SvgPickerNode());
    expect(svg).toBeGreaterThan(nodeDomWeight(new ValueInputNode()));
    expect(svg).toBeLessThan(nodeDomWeight(new ChartNode()));
  });

  it("calibrates ~10 full charts to the default 100 engage threshold", () => {
    expect(nodeDomWeight(new ChartNode()) * 10).toBeGreaterThanOrEqual(100);
  });
});

describe("nodeAccent", () => {
  it("gives a plain node its theme-resolved kind color", () => {
    const n = new ComparisonNode();
    expect(nodeAccent(n, "dark")).toBe(themeAccent(NODE_KIND_ACCENTS[nodeKindOf(n)], "dark"));
  });

  it("always resolves to a concrete hex, never a raw CSS var", () => {
    expect(nodeAccent(new ListInputNode(), "dark")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(nodeAccent(new ListInputNode(), "light")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("tracks the element-socket color across a List Input retype", () => {
    const n = new ListInputNode();
    expect(nodeAccent(n, "dark")).toBe(socketVarHex(SOCKET_COLORS[n.valueSocket.dataType], "dark"));
    const before = nodeAccent(n, "dark");
    n.setDataType("string");
    expect(nodeAccent(n, "dark")).toBe(socketVarHex(SOCKET_COLORS[n.valueSocket.dataType], "dark"));
    expect(nodeAccent(n, "dark")).not.toBe(before); // the whole point: it recolored
  });

  it("tracks the element-socket color across a Table Input retype", () => {
    const n = new TableInputNode();
    const before = nodeAccent(n, "dark");
    n.setDataType("string");
    expect(nodeAccent(n, "dark")).not.toBe(before);
  });
});

describe("chart cards wear the chart green", () => {
  it("the chart figures and the Chart Builder are the chart kind", () => {
    for (const n of [new ChartNode(), new SankeyNode(), new KpiNode(), new GanttNode(), new ChartBuilderNode(), new GaugeNode(), new MermaidNode(), new RecordNode()]) {
      expect(nodeKindOf(n), n.constructor.name).toBe("chart");
    }
  });
});

describe("[[B14]] oneDesignSystem", () => {
  it("a card no family lists wears its one non-numeric output's color", () => {
    for (const n of [new UrlEncodeNode(), new EpochNode()]) {
      expect(explicitKindOf(n), n.constructor.name).toBeNull();
      const out = Object.values(n.outputs)[0]!.socket as unknown as { dataType: keyof typeof SOCKET_COLORS };
      expect(nodeAccent(n, "dark"), n.constructor.name).toBe(socketVarHex(SOCKET_COLORS[out.dataType], "dark"));
    }
  });
  it("a numeric fallback keeps math blue, and a listed card keeps its family", () => {
    const math = new CombinatoricsNode();
    expect(nodeAccent(math, "dark")).toBe(themeAccent(NODE_KIND_ACCENTS.math, "dark"));
    const sankey = new SankeyNode();
    expect(nodeAccent(sankey, "dark")).toBe(themeAccent(NODE_KIND_ACCENTS.chart, "dark"));
  });
});

describe("nodeAccentSlot", () => {
  it("is the slot behind the accent the card paints", () => {
    for (const n of [new UrlEncodeNode(), new EpochNode(), new CombinatoricsNode(), new SankeyNode()]) {
      expect(themeAccent(resolveColor(nodeAccentSlot(n)), "dark"), n.constructor.name).toBe(nodeAccent(n, "dark"));
    }
  });
  it("a group of unfiled text cards takes their lime, not math blue", () => {
    expect(majorityColor([new UrlEncodeNode(), new UrlEncodeNode(), new CombinatoricsNode()])).toBe(nodeAccentSlot(new UrlEncodeNode()));
    expect(nodeAccentSlot(new UrlEncodeNode())).toBe("lime");
  });
});
