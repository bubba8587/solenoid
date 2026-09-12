import { describe, it, expect } from "vitest";
import { ChartBuilderNode } from "../../src/graph/nodes/visual";
import { CHART_BUILDER_TARGETS } from "../../src/graph/nodes/chartOptions";
import { parseGanttViewOptions } from "@solenoid/gantt-layout";

// The Chart Builder's Gantt target drives the hand-rolled Gantt figure (chart op "gantt"):
// every row writes the key the figure's own parser reads, and round-trips through it.
describe("Chart Builder › Gantt target", () => {
  it("offers every view key the figure parses and each one round-trips", () => {
    const keys = CHART_BUILDER_TARGETS.gantt.keys;
    for (const k of ["zoom", "tiers", "layout", "fit", "critical", "baseline", "arrows", "today", "weekends", "labels", "histogram", "minutes", "window", "columns"]) {
      expect(keys, k).toContain(k);
    }
    const b = new ChartBuilderNode({ target: "gantt" });
    Object.assign(b.stringLiterals, {
      zoom: "week", tiers: "1", layout: "calendar", fit: "page", critical: "off", baseline: "off", arrows: "off",
      today: "off", weekends: "off", labels: "off", histogram: "on", minutes: "on", columns: "name,finish",
    });
    const out = b.data({}).result as string;
    const v = parseGanttViewOptions(out, () => null);
    expect(v).toMatchObject({
      zoom: "week", tiers: 1, layout: "calendar", fit: "page", critical: false, baseline: false, arrows: false,
      today: false, weekends: false, labels: false, histogram: true, minutes: true, columns: ["name", "finish"],
    });
  });

  it("an untouched Gantt builder adds nothing, so the figure keeps its own defaults", () => {
    expect(new ChartBuilderNode({ target: "gantt" }).data({}).result).toBe("");
  });
});
