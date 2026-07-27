import { describe, it, expect } from "vitest";
import { SvgPickerNode } from "./annotation";
import { extractInit } from "../copyPaste";
import { isSvgValue } from "../svgValue";
import { chartSocket, stringSocket } from "../sockets";

// The SVG Picker's data + persistence contract. The interactive DOM (hover/click)
// is exercised by the author in the running app; the pure layer-resolution logic
// has its own suite (svgLayer.test.ts). Here we pin the output shape + round-trip.

const SVG = '<svg viewBox="0 0 10 10"><rect id="CA" x="0" y="0" width="5" height="5"/></svg>';

describe("SvgPickerNode", () => {
  it("has a chart output and a string Layer output", () => {
    const n = new SvgPickerNode();
    expect(n.outputs.chart?.socket).toBe(chartSocket);
    expect(n.outputs.layer?.socket).toBe(stringSocket);
  });

  it("emits an SvgValue carrying the source, selection, and color", () => {
    const n = new SvgPickerNode({ source: SVG, selectedLayer: "CA", hoverColor: "#ff0000", height: 180 });
    const out = n.data();
    expect(isSvgValue(out.chart)).toBe(true);
    if (isSvgValue(out.chart)) {
      expect(out.chart.source).toBe(SVG);
      expect(out.chart.selected).toBe("CA");
      expect(out.chart.hoverColor).toBe("#ff0000");
      expect(out.chart.height).toBe(180);
    }
    // The Layer output is the picked name — what a downstream Filter compares on.
    expect(out.layer).toBe("CA");
  });

  it("emits a null chart and null layer when empty", () => {
    const out = new SvgPickerNode().data();
    expect(out.chart).toBeNull();
    expect(out.layer).toBeNull();
  });

  it("emits a null layer (missing, not blank) when nothing is picked", () => {
    const out = new SvgPickerNode({ source: SVG }).data();
    expect(isSvgValue(out.chart)).toBe(true);
    expect(out.layer).toBeNull();
  });

  it("round-trips url, hoverColor, selectedLayer, height, width, label through extractInit", () => {
    const n = new SvgPickerNode({
      label: "Map", url: "https://x/y.svg", hoverColor: "#00ff00",
      selectedLayer: "CA", height: 240, width: 300,
    });
    const init = extractInit(n);
    expect(init).toMatchObject({
      label: "Map", url: "https://x/y.svg", hoverColor: "#00ff00",
      selectedLayer: "CA", height: 240, width: 300,
    });
    const n2 = new SvgPickerNode(init);
    expect(n2.hoverColor).toBe("#00ff00");
    expect(n2.selectedLayer).toBe("CA");
    expect(n2.url).toBe("https://x/y.svg");
  });

  it("keeps the SVG markup in stringLiterals so it persists like Mermaid's source", () => {
    const n = new SvgPickerNode({ source: SVG });
    // The bytes live in stringLiterals (restored by persistence), NOT extractInit.
    expect(n.stringLiterals.source).toBe(SVG);
    expect(extractInit(n).source).toBeUndefined();
  });
});
