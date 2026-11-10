// [[C44]] dateSerials, [[frame-verbs#Type inference]]
import { describe, it, expect } from "vitest";
import { isSolDate } from "../../../src/graph/dateValue";
import { isSolError } from "../../../src/graph/errorValue";
import { frameFromCells, frameSourceToText, type FrameValue } from "../../../src/graph/frame";
import { FrameInputNode, GetColumnNode } from "../../../src/graph/nodes/frame";
import { CastNode } from "../../../src/graph/nodes/cast";
import { DateTimeValueNode } from "../../../src/graph/nodes/date";
import { isDateOrder } from "../../../src/graph/dateOrder";
import { extractInit } from "../../../src/graph/nodeInit";

const JAN_2_2026 = 46024, FEB_1_2026 = 46054, MAR_15_2026 = 46096;
const day = (v: unknown) => (isSolDate(v) ? Math.floor(v.__date) : v);
const US = ["1/2/26", "3/15/26", "13/2/26"];

describe("a date order reads dates written in numbers alone", () => {
  it("Get Column read as Date takes its order; Auto keeps the four-digit-year rule", () => {
    const f = frameFromCells(["when"], US.map((t) => [t]));
    const read = (n: GetColumnNode) => (n.data({ frame: [f], name: ["when"] }).values as unknown[]).map(day);
    const mdy = read(new GetColumnNode({ readAs: "date", dateOrder: "MDY" }));
    expect(mdy.slice(0, 2)).toEqual([JAN_2_2026, MAR_15_2026]);
    expect(mdy[2]).toBeNaN();
    expect(read(new GetColumnNode({ readAs: "date" })).every((v) => Number.isNaN(v))).toBe(true);
  });

  it("Cast to Date takes its order, and a date that doesn't fit it is #VALUE!", () => {
    const n = new CastNode({ op: "date", dateOrder: "DMY" });
    n.data({ value: [US] });
    const out = n.cachedResult as unknown[];
    expect(day(out[0])).toBe(FEB_1_2026);
    expect(isSolError(out[1])).toBe(true);
  });

  it("the DATEVALUE card passes its order", () => {
    const n = new DateTimeValueNode({ op: "date", dateOrder: "MDY" });
    n.stringLiterals.text = "1/2/26";
    expect(day(n.data({}).result)).toBe(JAN_2_2026);
  });

  it("a Frame Input's order reads every Date column", () => {
    const frameText = frameSourceToText([{ name: "when", type: "date", cells: US }]);
    const values = (n: FrameInputNode) => (n.data({}).frame as FrameValue).columns[0].values;
    expect(values(new FrameInputNode({ frameText, dateOrder: "MDY" })).slice(0, 2)).toEqual([JAN_2_2026, MAR_15_2026]);
    expect(values(new FrameInputNode({ frameText })).slice(0, 2).every((v) => Number.isNaN(v))).toBe(true);
  });

  it("the order saves with the card, and anything but the four is dropped", () => {
    expect(extractInit(new CastNode({ op: "date", dateOrder: "YMD" })).dateOrder).toBe("YMD");
    expect(new GetColumnNode({ dateOrder: "mdy" as never }).dateOrder).toBe("");
    expect(["", "MDY", "DMY", "YMD"].every(isDateOrder)).toBe(true);
  });
});
