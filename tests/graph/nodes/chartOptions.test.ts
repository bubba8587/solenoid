import { describe, it, expect } from "vitest";
import { parseChartOptions, serializeChartOptions } from "../../../src/graph/nodes/chartOptions";

describe("parseChartOptions", () => {
  it("parses the full matplotlib-style string", () => {
    const o = parseChartOptions(
      "title=Sales;xlabel=Month;ylabel=USD;color=#56b4e9;grid=on;marker=off;ylim=0,100;linewidth=2;alpha=0.3",
    );
    expect(o).toEqual({
      title: "Sales", xlabel: "Month", ylabel: "USD", color: "#56b4e9",
      grid: true, marker: false, ymin: 0, ymax: 100, linewidth: 2, alpha: 0.3,
    });
  });

  it("is tolerant of whitespace, case, and boolean spellings", () => {
    const o = parseChartOptions("  TITLE = Hi ; Grid = TRUE ; Marker = 1 ");
    expect(o.title).toBe("Hi");
    expect(o.grid).toBe(true);
    expect(o.marker).toBe(true);
  });

  it("accepts a one-sided ylim and the lw alias", () => {
    expect(parseChartOptions("ylim=,100")).toEqual({ ymax: 100 });
    expect(parseChartOptions("ylim=5,")).toEqual({ ymin: 5 });
    expect(parseChartOptions("lw=3")).toEqual({ linewidth: 3 });
    expect(parseChartOptions("ms=4")).toEqual({ markersize: 4 });
    expect(parseChartOptions("markersize=0")).toEqual({});
  });

  it("parses pielabels as off/outside/inside, with on and center aliased", () => {
    expect(parseChartOptions("pielabels=off").pielabels).toBe("off");
    expect(parseChartOptions("pielabels=on").pielabels).toBe("outside");
    expect(parseChartOptions("pielabels=outside").pielabels).toBe("outside");
    expect(parseChartOptions("pielabels=inside").pielabels).toBe("inside");
    expect(parseChartOptions("pielabels=center").pielabels).toBe("inside");
    expect(parseChartOptions("pielabels=nonsense").pielabels).toBeUndefined();
  });

  it("parses radarscale as axis/shared, with normalize and raw aliased", () => {
    expect(parseChartOptions("radarscale=axis").radarscale).toBe("axis");
    expect(parseChartOptions("radarscale=normalize").radarscale).toBe("axis");
    expect(parseChartOptions("radarscale=shared").radarscale).toBe("shared");
    expect(parseChartOptions("radarscale=raw").radarscale).toBe("shared");
    expect(parseChartOptions("radarscale=nonsense").radarscale).toBeUndefined();
  });

  it("ignores unknown keys, blank values, and junk", () => {
    expect(parseChartOptions("bogus=1;title=;color=red;nope")).toEqual({ color: "red" });
    expect(parseChartOptions("")).toEqual({});
    expect(parseChartOptions(null)).toEqual({});
  });
});

describe("serializeChartOptions", () => {
  it("emits only set fields and collapses Y bounds into ylim", () => {
    expect(serializeChartOptions({ title: "A", color: "red", ymin: 0, ymax: 10 }))
      .toBe("title=A;color=red;ylim=0,10");
  });

  it("emits a one-sided ylim and skips empties", () => {
    expect(serializeChartOptions({ ymax: 50 })).toBe("ylim=,50");
    expect(serializeChartOptions({ title: "  ", xlabel: "" })).toBe("");
  });

  it("round-trips back through the parser", () => {
    const s = serializeChartOptions({ title: "Q1", ylabel: "$", grid: "on", linewidth: 2, ymin: 0, ymax: 100 });
    expect(parseChartOptions(s)).toEqual({ title: "Q1", ylabel: "$", grid: true, linewidth: 2, ymin: 0, ymax: 100 });
  });

  it("serializes the pielabels mode and round-trips it", () => {
    expect(serializeChartOptions({ pielabels: "inside" })).toBe("pielabels=inside");
    expect(parseChartOptions(serializeChartOptions({ pielabels: "off" }))).toEqual({ pielabels: "off" });
    expect(parseChartOptions(serializeChartOptions({ pielabels: "inside" }))).toEqual({ pielabels: "inside" });
  });
});
