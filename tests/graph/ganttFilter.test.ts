// [[C100]] chartIsAValue
import { describe, it, expect } from "vitest";
import { ganttMatching } from "../../src/graph/components/ganttFilter";
import type { GanttPayload } from "@solenoid/gantt-layout";

const task = (id: string, name: string, level: number, summary = false, resource?: string) =>
  ({ id, name, level, summary, milestone: false, start: 0, finish: 1, complete: 0, critical: false, late: false, violated: false, float: null, ...(resource ? { resource } : {}) });

const plan = {
  kind: "gantt",
  tasks: [
    task("1", "Design", 0, true), task("2", "Sketch", 1), task("3", "Review", 1, false, "Ada"),
    task("4", "Build", 0, true), task("5", "Frame", 1), task("6", "Roof", 1),
  ],
  links: [{ from: "2", to: "3" }, { from: "3", to: "5" }, { from: "5", to: "6" }],
} as unknown as GanttPayload;

describe("the Gantt popup's Filter", () => {
  it("keeps a match with the summaries above it, and only the links between kept tasks", () => {
    const { payload, matches } = ganttMatching(plan, "review");
    expect(matches).toBe(1);
    expect(payload.tasks.map((t) => t.id)).toEqual(["1", "3"]);
    expect(payload.links).toEqual([]);
  });

  it("a matching summary keeps its subtree; a resource matches too", () => {
    expect(ganttMatching(plan, "build").payload.tasks.map((t) => t.id)).toEqual(["4", "5", "6"]);
    expect(ganttMatching(plan, "ada").payload.tasks.map((t) => t.id)).toEqual(["1", "3"]);
    expect(ganttMatching(plan, "build").payload.links.map((l) => l.from)).toEqual(["5"]);
  });
});
