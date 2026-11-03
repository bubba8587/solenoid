// [[D114]] dateIsAKind
// A date matches the same date, never its serial and never another date: membership, tallies, matches and SWITCH.
import { describe, it, expect } from "vitest";
import { throughBoundary } from "./boundaryKit";
import { IsInNode, TallyNode, XMatchNode } from "../../src/graph/nodes/list";
import { SwitchNode } from "../../src/graph/nodes/logic";
import { solDate } from "../../src/graph/dateValue";
import { evaluateOnCore } from "../../src/graph/coreValues";
import type { FrameValue } from "../../src/graph/frame";
import type { GraphNode } from "../../src/graph/graphModel";

const card = <T extends GraphNode>(n: T): T => { throughBoundary(n as never); return n; };
const [jan1, jan5, mar3] = [solDate(44927), solDate(44931), solDate(44988)];

describe("dates as members and keys", () => {
  it("Is In: a date is in a set only beside the same date", async () => {
    const r = await card(new IsInNode()).data({ a: [[jan1, jan5]], b: [[mar3, jan5]] });
    expect((r as { result: unknown }).result).toEqual([false, true]);
  });
  it("Tally: each day counts on its own", async () => {
    const r = (await card(new TallyNode()).data({ list: [[jan1, jan1, jan5]] })) as { frame: FrameValue };
    expect(r.frame.columns[1].values).toEqual([2, 1]);
  });
  it("XMatch: a date finds its own position, exact and approximate", async () => {
    const n = card(new XMatchNode());
    expect(((await n.data({ value: [jan5], array: [[jan1, jan5, mar3]] })) as { result: unknown }).result).toBe(2);
    (n as unknown as { matchMode: string }).matchMode = "next_larger";
    expect(((await n.data({ value: [solDate(44932)], array: [[jan1, jan5, mar3]] })) as { result: unknown }).result).toBe(3);
  });
});

describe("SWITCH over dates", () => {
  it("the card takes the case whose date equals the expression", async () => {
    const n = card(new SwitchNode());
    const r = await n.data({ expr: [jan5], when0: [jan1], then0: ["a"], when1: [jan5], then1: ["b"], when2: [mar3], then2: ["c"] });
    expect((r as { result: unknown }).result).toBe("b");
  });
  it("the formula matches a date with the same date", () => {
    expect(evaluateOnCore('SWITCH(DATE(2023,3,2), DATE(2023,1,1), "a", DATE(2023,3,2), "b")', {})).toBe("b");
  });
});
