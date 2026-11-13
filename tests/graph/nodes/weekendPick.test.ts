// [[C26]] opArgDistinct
// The scheduling cards' Weekend dropdown names Excel's WORKDAY.INTL codes, and has no socket.
import { describe, it, expect } from "vitest";
import { WEEKEND_OPTIONS } from "../../../src/graph/components/WeekendPick";
import { GanttNode } from "../../../src/graph/nodes/gantt";
import { ScheduleNode } from "../../../src/graph/nodes/schedule";
import { EarnedValueNode } from "../../../src/graph/nodes/earnedValue";

describe("the Weekend pick", () => {
  it("names each WORKDAY.INTL code as Excel defines it", () => {
    const at = (code: number) => WEEKEND_OPTIONS.find((o) => o.value === String(code))?.label;
    expect([at(1), at(2), at(7), at(11), at(12), at(17)]).toEqual(["Sat and Sun", "Sun and Mon", "Fri and Sat", "Sun only", "Mon only", "Sat only"]);
    expect(WEEKEND_OPTIONS).toHaveLength(14);
  });

  it("is a saved setting with no socket on every scheduling card", () => {
    for (const C of [GanttNode, ScheduleNode, EarnedValueNode]) {
      expect(new C().inputs.weekend_code).toBeUndefined();
      expect((C as unknown as { savedFields: ReadonlySet<string> }).savedFields.has("weekend_code")).toBe(true);
    }
  });
});
