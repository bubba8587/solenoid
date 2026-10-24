// [[C96]] chartOptionsAreMatplotlib
import { describe, it, expect } from "vitest";
import { chartOptionsOf } from "../coreVerbs";
import { ChartBuilderNode } from "../../../src/graph/nodes/visual";

/** A Chart Builder's options string with these fields typed in. */
function serializeChartOptions(fields: Record<string, string | number | null>): string {
  const n = new ChartBuilderNode();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "number") n.literals[k] = v;
    else if (typeof v === "string") n.stringLiterals[k] = v;
  }
  return n.data({}).result;
}

describe("the Chart card reads its options string", () => {
  it("parses the full matplotlib-style string", () => {
    const o = chartOptionsOf(
      "title=Sales;xlabel=Month;ylabel=USD;color=#56b4e9;grid=on;marker=off;ylim=0,100;linewidth=2;alpha=0.3",
    );
    expect(o).toEqual({
      title: "Sales", xlabel: "Month", ylabel: "USD", color: "#56b4e9",
      grid: true, marker: false, ymin: 0, ymax: 100, linewidth: 2, alpha: 0.3,
    });
  });

  it("is tolerant of whitespace, case, and boolean spellings", () => {
    const o = chartOptionsOf("  TITLE = Hi ; Grid = TRUE ; Marker = 1 ");
    expect(o.title).toBe("Hi");
    expect(o.grid).toBe(true);
    expect(o.marker).toBe(true);
  });

  it("accepts a one-sided ylim and the lw alias", () => {
    expect(chartOptionsOf("ylim=,100")).toEqual({ ymax: 100 });
    expect(chartOptionsOf("ylim=5,")).toEqual({ ymin: 5 });
    expect(chartOptionsOf("lw=3")).toEqual({ linewidth: 3 });
    expect(chartOptionsOf("ms=4")).toEqual({ markersize: 4 });
    expect(chartOptionsOf("markersize=0")).toEqual({});
  });

  it("parses pielabels as off/outside/inside, with on and center aliased", () => {
    expect(chartOptionsOf("pielabels=off").pielabels).toBe("off");
    expect(chartOptionsOf("pielabels=on").pielabels).toBe("outside");
    expect(chartOptionsOf("pielabels=outside").pielabels).toBe("outside");
    expect(chartOptionsOf("pielabels=inside").pielabels).toBe("inside");
    expect(chartOptionsOf("pielabels=center").pielabels).toBe("inside");
    expect(chartOptionsOf("pielabels=nonsense").pielabels).toBeUndefined();
  });

  it("parses radarscale as axis/shared, with normalize and raw aliased", () => {
    expect(chartOptionsOf("radarscale=axis").radarscale).toBe("axis");
    expect(chartOptionsOf("radarscale=normalize").radarscale).toBe("axis");
    expect(chartOptionsOf("radarscale=shared").radarscale).toBe("shared");
    expect(chartOptionsOf("radarscale=raw").radarscale).toBe("shared");
    expect(chartOptionsOf("radarscale=nonsense").radarscale).toBeUndefined();
  });

  it("ignores unknown keys, blank values, and junk", () => {
    expect(chartOptionsOf("bogus=1;title=;color=red;nope")).toEqual({ color: "red" });
    expect(chartOptionsOf("")).toEqual({});
    expect(chartOptionsOf(null)).toEqual({});
  });
});

describe("Chart Builder serialization", () => {
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
    expect(chartOptionsOf(s)).toEqual({ title: "Q1", ylabel: "$", grid: true, linewidth: 2, ymin: 0, ymax: 100 });
  });

  it("serializes the pielabels mode and round-trips it", () => {
    expect(serializeChartOptions({ pielabels: "inside" })).toBe("pielabels=inside");
    expect(chartOptionsOf(serializeChartOptions({ pielabels: "off" }))).toEqual({ pielabels: "off" });
  });
});

describe("heatmap keys", () => {
  it("reads seaborn's names, canonicalizing the cmap and dropping unreadable values", () => {
    expect(chartOptionsOf("cmap=VIRIDIS_R;vmin=-1;vmax=1;center=0;annot=on;fmt=.2f;cbar=off;origin=lower"))
      .toEqual({ cmap: "viridis_r", vmin: -1, vmax: 1, center: 0, annot: true, fmt: ".2f", cbar: false, origin: "lower" });
    expect(chartOptionsOf("cmap=jet;fmt={:.2f};origin=middle;annot=maybe")).toEqual({});
  });

  it("serializes the heatmap fields and round-trips them", () => {
    const s = serializeChartOptions({ cmap: "RdBu_r", annot: "off", fmt: ",.0f", cbar: "off", origin: "lower", vmin: 0, vmax: 10, center: 5 });
    expect(s).toBe("cmap=RdBu_r;annot=off;fmt=,.0f;cbar=off;origin=lower;vmin=0;vmax=10;center=5");
    expect(chartOptionsOf(s)).toEqual({ cmap: "RdBu_r", annot: false, fmt: ",.0f", cbar: false, origin: "lower", vmin: 0, vmax: 10, center: 5 });
  });
});

describe("yscale", () => {
  it("reads linear or log and ignores anything else", () => {
    expect(chartOptionsOf("yscale=LOG").yscale).toBe("log");
    expect(chartOptionsOf("yscale=linear").yscale).toBe("linear");
    expect(chartOptionsOf("yscale=symlog").yscale).toBeUndefined();
  });
});

describe("maxgap", () => {
  it("reads a positive number and ignores the rest", () => {
    expect(chartOptionsOf("maxgap=0.35").maxgap).toBe(0.35);
    expect(chartOptionsOf("maxgap=0").maxgap).toBeUndefined();
    expect(chartOptionsOf("maxgap=wide").maxgap).toBeUndefined();
  });
});
