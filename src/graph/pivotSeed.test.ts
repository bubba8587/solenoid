import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { isFrameValue, type FrameValue, type FrameCell } from "./frame";
import seed from "./seedGraphs/pivot-tables.json";

// Runs the "Pivot tables (one source, many views)" seed through a real editor +
// DataflowEngine and checks each pivot computes the numbers it claims — so a bad
// rowFields/colFields/values literal, a wrong function, or a totals regression
// fails here, not silently in-app. Expected values are hand-derived from the 36-row
// Orders source (see scripts comment in the seed generator).

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  stringLiterals?: Record<string, string>;
};

describe("pivot-tables seed", () => {
  it("every pivot computes the cross-tab it claims", async () => {
    const editor = new NodeEditor<Schemes>();
    installInputCoercion(editor);
    editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);

    const byId = new Map<string, ClassicPreset.Node>();
    for (const sn of (seed.nodes as SavedNode[])) {
      const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => ClassicPreset.Node>)[sn.type];
      expect(Ctor, `unknown type ${sn.type}`).toBeTypeOf("function");
      const node = new Ctor({ ...sn.init });
      const anyNode = node as unknown as Record<string, unknown>;
      if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
      byId.set(sn.id, node);
      await editor.addNode(node as unknown as Schemes["Node"]);
    }
    for (const c of seed.connections) {
      await editor.addConnection(
        new ClassicPreset.Connection(byId.get(c.source)!, c.sourceOutput, byId.get(c.target)!, c.targetInput) as Schemes["Connection"],
      );
    }

    const frameOf = async (seedId: string) => {
      const out = (await engine.fetch(byId.get(seedId)!.id)) as Record<string, unknown>;
      expect(isFrameValue(out.frame), `${seedId} did not produce a frame`).toBe(true);
      return out.frame as FrameValue;
    };
    const col = (f: FrameValue, name: string): FrameCell[] => {
      const c = f.columns.find((x) => x.name === name);
      expect(c, `column "${name}" not found (have ${f.columns.map((x) => x.name).join(", ")})`).toBeDefined();
      return c!.values;
    };

    // p1 — Region × Category SUM with row + column grand totals.
    const p1 = await frameOf("p1");
    expect(p1.columns.map((c) => c.name)).toEqual(["Region", "Electronics", "Furniture", "Office", "Grand Total"]);
    expect(col(p1, "Region")).toEqual(["North", "South", "East", "West", "Grand Total"]);
    expect(col(p1, "Electronics")[0]).toBe(7000); // North Electronics
    expect(col(p1, "Grand Total")).toEqual([10675, 14775, 17850, 9550, 52850]);

    // p2 — Revenue by Rep, sorted high→low by the measure, with grand total.
    const p2 = await frameOf("p2");
    expect(col(p2, "Rep")).toEqual(["Bo", "Cy", "Ada", "Di", "Grand Total"]);
    expect(col(p2, "Revenue")).toEqual([14975, 13425, 13275, 11175, 52850]);

    // p3 — per-value functions: SUM(Units) and AVERAGE(Price) by Category.
    const p3 = await frameOf("p3");
    expect(col(p3, "Units")).toEqual([62, 60, 154]);
    expect(col(p3, "Price")).toEqual([500, 300, 25]);

    // p4 — Region × Month, columns in chronological first-seen order + col total.
    const p4 = await frameOf("p4");
    expect(p4.columns.map((c) => c.name)).toEqual(["Region", "Jan", "Feb", "Mar", "Grand Total"]);
    expect(col(p4, "Jan")[0]).toBe(3075); // North Jan
    expect(col(p4, "Grand Total")[0]).toBe(10675);

    // p5 — PERCENTOF (% of grand total) by Region.
    const p5 = await frameOf("p5");
    expect((col(p5, "Revenue")[0] as number)).toBeCloseTo(10675 / 52850);
    expect((col(p5, "Revenue") as number[]).reduce((a, b) => a + b, 0)).toBeCloseTo(1);

    // p6 — multi-level rows with subtotals (region subtotal + grand total).
    const p6 = await frameOf("p6");
    const reg6 = col(p6, "Region"), prod6 = col(p6, "Category"), rev6 = col(p6, "Revenue");
    // North group: 3 leaf rows then a "Total" subtotal of 10675.
    expect(prod6[3]).toBe("Total");
    expect(rev6[3]).toBe(10675);
    expect(reg6[reg6.length - 1]).toBe("Grand Total");
    expect(rev6[rev6.length - 1]).toBe(52850);

    // p7 — order COUNT by Region × Channel, with totals (corner = 36 rows).
    const p7 = await frameOf("p7");
    expect(col(p7, "Online")[0]).toBe(5); // North online orders
    expect(col(p7, "Retail")[0]).toBe(4);
    expect(col(p7, "Grand Total")[0]).toBe(9);
    const gt7 = col(p7, "Grand Total");
    expect(gt7[gt7.length - 1]).toBe(36); // grand corner = total order count

    // p8 — MEDIAN(Revenue) and MAX(Units) per Rep (expanded function set).
    const p8 = await frameOf("p8");
    expect(col(p8, "Rep")).toEqual(["Ada", "Bo", "Cy", "Di"]);
    expect(col(p8, "Revenue")[0]).toBe(1500); // Ada median revenue
    expect(col(p8, "Units")[0]).toBe(16);     // Ada max units

    // Source reshape (Power Query column ops on the same Orders frame).
    const sp = await frameOf("splitDate");
    const spNames = sp.columns.map((c) => c.name);
    expect(spNames).toContain("Dept");
    expect(spNames).toContain("Code");
    expect(spNames).not.toContain("SKU"); // the source column is replaced
    expect(col(sp, "Dept")[0]).toBe("EL");   // row 0 is Electronics → EL-001
    expect(col(sp, "Code")[0]).toBe("001");
    const ix = await frameOf("addIdx");
    expect(ix.columns[0].name).toBe("Row");
    expect(col(ix, "Row")[0]).toBe(1);
    expect(col(ix, "Row")[35]).toBe(36);
  });
});
