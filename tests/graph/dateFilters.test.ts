// [[D114]] dateIsAKind, [[C137]] datesNeverSerials, [[date-values#Cards]]
import { describe, it, expect } from "vitest";
import { throughBoundary } from "./boundaryKit";
import { readFrame, type FrameRef } from "../../src/graph/frameBackend";
import { FilterFrameNode, GetColumnNode } from "../../src/graph/nodes/frame";
import { FilterNode } from "../../src/graph/nodes/list";
import { solDate } from "../../src/graph/dateValue";
import type { FrameValue } from "../../src/graph/frame";
import type { GraphNode } from "../../src/graph/graphModel";

const card = <T extends GraphNode>(n: T): T => { throughBoundary(n as never); return n; };
const days = [45000, 45001, 45002, null, 45004];
const frame: FrameValue = { __frame: true, columns: [{ name: "When", type: "date", values: days }] };
const op = (n: GraphNode, o: string) => { (n as unknown as { condConfig: Record<string, { op: string }> }).condConfig = { "0": { op: o } }; };

async function frameFilter(o: string, value: unknown): Promise<unknown[]> {
  const n = card(new FilterFrameNode());
  n.stringLiterals.column0 = "When";
  op(n, o);
  const out = await n.data({ frame: [frame], value0: [value] });
  return (await readFrame(out.frame as FrameRef) as FrameValue).columns[0].values;
}

describe("Frame Filter on a Date column", () => {
  it("compares a wired date as a day", async () => {
    expect(await frameFilter("gt", solDate(45001))).toEqual([45002, 45004]);
    expect(await frameFilter("neq", solDate(45001))).toEqual([45000, 45002, 45004]);
    expect(await frameFilter("eq", solDate(45001))).toEqual([45001]);
    expect(await frameFilter("lte", solDate(45001))).toEqual([45000, 45001]);
  });
  it("reads a typed date as a date", async () => {
    expect(await frameFilter("gt", "16-Mar-2023")).toEqual([45002, 45004]);
  });
});

describe("List Filter over a list of dates", () => {
  it("compares each date with a wired date", async () => {
    const g = card(new GetColumnNode());
    g.stringLiterals.name = "When";
    const values = ((await g.data({ frame: [frame] })) as { values: unknown }).values;
    const run = async (o: string) => {
      const l = card(new FilterNode());
      op(l, o);
      return ((await l.data({ list: [values], value0: [solDate(45001)] })) as { result: unknown }).result;
    };
    expect(await run("gt")).toEqual([solDate(45002), solDate(45004)]);
    expect(await run("neq")).toEqual([solDate(45000), solDate(45002), solDate(45004)]);
  });
});
