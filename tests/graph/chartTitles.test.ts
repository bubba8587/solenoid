// [[C100]] chartIsAValue, [[D75]] builderExposesEveryOption
import { describe, it, expect } from "vitest";
import { CHART_TARGET_LIST, chartBuilderKeys, parseChartOptions, type ChartBuilderKey } from "../../src/graph/nodes/chartOptions";
import { chartValueOps } from "../../src/graph/chartValue";
import { UNTITLED_FIGURES, SELF_TITLED_FIGURES } from "../../src/graph/components/chartTitle";
import { parseGanttViewOptions } from "@solenoid/gantt-layout";

const SAMPLE: Record<ChartBuilderKey, string> = {
  title: "T", xlabel: "X", ylabel: "Y", color: "#123456", grid: "off", marker: "on", pielabels: "inside",
  radarscale: "shared", ymin: "1", ymax: "2", linewidth: "2", markersize: "4", alpha: "0.5", fontsize: "12",
  zoom: "week", layout: "calendar", tiers: "1", fit: "page", critical: "off", baseline: "off", arrows: "off",
  today: "off", status: "off", weekends: "off", labels: "off", histogram: "on", minutes: "on",
  window: "2026-01-01,2026-02-01", columns: "name", collapse: "0", week: "us", fiscal_start: "4", group_by: "off",
  cardsize: "l", clamp: "on",
  x: "t", y: "a,b", s: "n", c: "k", annotate: "name", by: "group", linestyle: "--", aspect: "equal", xmin: "0", xmax: "5",
};
const RECORD_ONLY = new Set<ChartBuilderKey>(["cardsize", "clamp"]);

describe("chart titles", () => {
  it("every Chart Builder target that offers a title has a renderer that draws it", () => {
    const missing = CHART_TARGET_LIST
      .filter((t) => t.keys.includes("title"))
      .filter((t) => !UNTITLED_FIGURES.has(t.op) && !SELF_TITLED_FIGURES.has(t.op))
      .map((t) => t.id);
    expect(missing, "add the op to UNTITLED_FIGURES (ChartFigure draws the strip) or make its view draw options.title").toEqual([]);
  });
  it("no op is in both sets, which would draw the title twice", () => {
    expect([...UNTITLED_FIGURES].filter((op) => SELF_TITLED_FIGURES.has(op))).toEqual([]);
  });
});

describe("Chart Builder key lists", () => {
  it("every target draws a real chart op", () => {
    const ops = new Set<string>(chartValueOps());
    expect(CHART_TARGET_LIST.filter((t) => !ops.has(t.op)).map((t) => t.id)).toEqual([]);
  });

  it("every offered key is one a parser reads", () => {
    const lists = [...CHART_TARGET_LIST.map((t) => [t.id, t.keys] as const), ["gantt calendar", chartBuilderKeys("gantt", "calendar")] as const];
    for (const [id, keys] of lists) {
      for (const k of keys) {
        const s = `${k}=${SAMPLE[k]}`;
        const read = RECORD_ONLY.has(k)
          ? id === "record"
          : Object.keys(parseChartOptions(s)).length > 0 || Object.keys(parseGanttViewOptions(s, () => 1)).length > 0;
        expect(read, `${id}:${k}`).toBe(true);
      }
    }
  });

  it("only the Gantt target offers the Gantt view keys", () => {
    const leaks = CHART_TARGET_LIST
      .filter((t) => t.id !== "gantt")
      .flatMap((t) => t.keys.filter((k) => Object.keys(parseGanttViewOptions(`${k}=${SAMPLE[k]}`, () => 1)).length > 0).map((k) => `${t.id}:${k}`));
    expect(leaks).toEqual([]);
  });
});
