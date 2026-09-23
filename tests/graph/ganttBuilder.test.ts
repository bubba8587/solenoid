// [[C63]], [[B11]], [[C96]] chartOptionsAreMatplotlib
import { describe, it, expect } from "vitest";
import { ChartBuilderNode } from "../../src/graph/nodes/visual";
import { CHART_BUILDER_TARGETS, chartBuilderKeys } from "../../src/graph/nodes/chartOptions";
import { parseGanttViewOptions } from "@solenoid/gantt-layout";

// The Chart Builder's Gantt target drives the hand-rolled Gantt figure (chart op "gantt"):
// every row writes the key the figure's own parser reads, and round-trips through it.
describe("Chart Builder › Gantt target", () => {
  it("offers every view key the figure parses and each one round-trips", () => {
    const keys = CHART_BUILDER_TARGETS.gantt.keys;
    for (const k of ["zoom", "tiers", "layout", "fit", "critical", "baseline", "arrows", "today", "weekends", "labels", "histogram", "minutes", "window", "columns", "status", "collapse", "group_by", "week", "fiscal_start"]) {
      expect(keys, k).toContain(k);
    }
    const b = new ChartBuilderNode({ target: "gantt" });
    Object.assign(b.stringLiterals, {
      zoom: "week", tiers: "1", layout: "calendar", fit: "page", critical: "off", baseline: "off", arrows: "off",
      today: "off", weekends: "off", labels: "off", histogram: "on", minutes: "on", columns: "name,finish",
      status: "off", collapse: "1", group_by: "off", week: "us", fiscal_start: "4",
    });
    const out = b.data({}).result as string;
    const v = parseGanttViewOptions(out, () => null);
    expect(v).toMatchObject({
      zoom: "week", tiers: 1, layout: "calendar", fit: "page", critical: false, baseline: false, arrows: false,
      today: false, weekends: false, labels: false, histogram: true, minutes: true, columns: ["name", "finish"],
      status: false, collapse: 1, group_by: false, week: "us", fiscal_start: 4,
    });
  });

  it("an untouched Gantt builder adds nothing, so the figure keeps its own defaults", () => {
    expect(new ChartBuilderNode({ target: "gantt" }).data({}).result).toBe("");
  });

  // The month-calendar layout draws its own grid: it ignores the scale, bars, links and
  // grid pane, so the builder offers a smaller set than the timeline (which the default is).
  it("narrows the offered options for the calendar layout", () => {
    const timeline = chartBuilderKeys("gantt", undefined);
    expect(timeline).toBe(CHART_BUILDER_TARGETS.gantt.keys);
    expect(chartBuilderKeys("gantt", "")).toBe(timeline);

    const calendar = new Set(chartBuilderKeys("gantt", "calendar"));
    // Honored in the month grid.
    for (const k of ["title", "fontsize", "layout", "critical", "minutes", "window", "week"]) {
      expect(calendar, k).toContain(k);
    }
    // Timeline-only — drawn unconditionally or not at all in the calendar.
    for (const k of ["zoom", "tiers", "fit", "baseline", "arrows", "today", "weekends", "labels", "histogram", "columns", "status", "collapse", "group_by", "fiscal_start"]) {
      expect(calendar, k).not.toContain(k);
    }
    // The layout switch itself must survive so the user can return to the timeline.
    expect(calendar.has("layout")).toBe(true);
  });
});
