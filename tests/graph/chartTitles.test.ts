// [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { CHART_BUILDER_TARGETS } from "../../src/graph/nodes/chartOptions";
import { UNTITLED_FIGURES, SELF_TITLED_FIGURES } from "../../src/graph/components/chartTitle";

describe("chart titles", () => {
  it("every Chart Builder target that offers a title has a renderer that draws it", () => {
    const missing = Object.entries(CHART_BUILDER_TARGETS)
      .filter(([, t]) => t.keys.includes("title"))
      .map(([id]) => id)
      .filter((id) => !UNTITLED_FIGURES.has(id) && !SELF_TITLED_FIGURES.has(id));
    expect(missing, "add the op to UNTITLED_FIGURES (ChartFigure draws the strip) or make its view draw options.title").toEqual([]);
  });
  it("no op is in both sets, which would draw the title twice", () => {
    expect([...UNTITLED_FIGURES].filter((op) => SELF_TITLED_FIGURES.has(op))).toEqual([]);
  });
});
