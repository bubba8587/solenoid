import { describe, it, expect } from "vitest";
import * as Nodes from "./rete-nodes";
import seed from "./seedGraphs/units-by-dimension.json";
import { isUnitCell, magnitudeOf, unitLabelOf, type UnitCell } from "./unitValue";
import type { BuildFrameNode, GetColumnNode } from "./nodes/frame";
import type { AggregateNode } from "./nodes/list";
import type { ArithmeticNode, NumberInputNode } from "./rete-nodes";

// The "Units by Dimension" seed is a teaching graph. This test drives its two lanes
// through the REAL node classes (built from the seed's inits) and asserts the
// captioned behaviors — so the demo can't quietly become a lie (the same guard the
// Unit Flow seed test provides for the FC display flow).

function build<T>(id: string): T {
  const sn = seed.nodes.find((n) => n.id === id)!;
  const Ctor = (Nodes as unknown as Record<string, new (init?: Record<string, unknown>) => unknown>)[sn.type];
  const node = new Ctor({ ...(sn.init as Record<string, unknown>) }) as Record<string, unknown>;
  if ("stringLiterals" in sn && sn.stringLiterals) node.stringLiterals = { ...(sn.stringLiterals as unknown as Record<string, string>) };
  return node as T;
}

describe("Units by Dimension seed — the captioned behaviors hold", () => {
  it("A · 5 m ÷ 1 s = 5 m/s through Number → Arithmetic", () => {
    const numD = build<NumberInputNode>("numD");
    const numT = build<NumberInputNode>("numT");
    const ari = build<ArithmeticNode>("ariB");
    const a = numD.data().value;   // 5 m (base-SI UnitCell)
    const b = numT.data().value;   // 1 s
    expect(isUnitCell(a)).toBe(true);
    const r = ari.data({ a: [a] as never, b: [b] as never }).result;
    expect(isUnitCell(r)).toBe(true);
    expect(magnitudeOf(r)).toBe(5);
    expect(unitLabelOf(r)).toBe("m/s");
  });

  it("B · a `Revenue ($0.00)` column locks to $, rides out, and SUMs to $18", () => {
    const tbl = build<{ data: (i: Record<string, unknown>) => { table: number[][] } }>("tblA");
    const hdr = build<{ data: (i: Record<string, unknown>) => { list: string[] } }>("hdrA");
    const bf = build<BuildFrameNode>("bfA");
    const gc = build<GetColumnNode>("gcA");
    const agg = build<AggregateNode>("aggA");

    const matrix = tbl.data({}).table;
    const headers = hdr.data({}).list;
    expect(headers).toEqual(["Revenue ($0.00)"]);
    const frame = bf.data({ matrix: [matrix], headers: [headers] }).frame!;
    // The column is cleaned to "Revenue" and locked to the currency unit.
    expect(frame.columns[0].name).toBe("Revenue");
    expect(frame.columns[0].unit?.display).toBe("usd");

    const list = gc.data({ frame: [frame], name: ["Revenue"] }).values as UnitCell[];
    expect(list.every((c) => isUnitCell(c))).toBe(true);
    const total = agg.data({ list: [list as never] }).result;
    expect(isUnitCell(total)).toBe(true);
    expect(magnitudeOf(total)).toBe(18); // 5 + 6 + 7
    expect(unitLabelOf(total)).toBe("¤"); // currency dimension
  });
});
