import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards, isSolError, type SolError } from "./errorValue";
import { isFrameValue, type FrameValue } from "./frame";
import seed from "./seedGraphs/frames.json";

// Runs the Frames showcase seed through a real editor + DataflowEngine (with the
// same coercion + error guards Canvas uses) and checks it actually demonstrates
// what it claims: text columns survive, columns read back, AND the three
// deliberate mismatches produce the #SHAPE! / #VALUE! badges. Authoring mistakes
// (a wrong socket key, a producer that quietly returns null) fail here, not in-app.

type SavedNode = {
  id: string; type: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};

describe("frames seed", () => {
  it("shows frame capabilities and the shape/type errors it claims", async () => {
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
      if (sn.literals) anyNode.literals = { ...sn.literals };
      if (sn.stringLiterals) anyNode.stringLiterals = { ...sn.stringLiterals };
      byId.set(sn.id, node);
      await editor.addNode(node as unknown as Schemes["Node"]);
    }
    for (const c of seed.connections) {
      await editor.addConnection(
        new ClassicPreset.Connection(byId.get(c.source)!, c.sourceOutput, byId.get(c.target)!, c.targetInput) as Schemes["Connection"],
      );
    }

    // Seed ids are not the rete instance ids — fetch by the instance's real id.
    const out = async (seedId: string) => (await engine.fetch(byId.get(seedId)!.id)) as Record<string, unknown>;
    const columns = (f: unknown) => (f as FrameValue).columns;

    // ── Capabilities ────────────────────────────────────────────────────────
    // A mixed frame keeps its text column.
    const fin = await out("fin");
    expect(isFrameValue(fin.frame)).toBe(true);
    const region = columns(fin.frame).find((c) => c.name === "Region")!;
    expect(region.type).toBe("string");
    expect(region.values).toEqual(["North", "South", "East", "West"]);

    // Get Column → text reads the strings back; → number gives all N/A.
    expect((await out("getRegT")).values).toEqual(["North", "South", "East", "West"]);
    expect(((await out("getRegN")).values as number[]).every((v) => Number.isNaN(v))).toBe(true);

    // Numeric column → Reduce; Add Column appends a computed Margin column.
    expect((await out("sumProfit")).result).toBe(30 + 42 + 51 + 60);
    const addc = await out("addcol");
    expect(columns(addc.frame).some((c) => c.name === "Margin")).toBe(true);

    // Split Frame → a real matrix + headers.
    const split = await out("split");
    expect((split.matrix as number[][]).length).toBe(4);
    expect(split.headers).toEqual(["Year", "Revenue", "Profit"]);

    // ── Deliberate errors ───────────────────────────────────────────────────
    const code = (v: unknown) => { expect(isSolError(v), `not an error: ${JSON.stringify(v)}`).toBe(true); return (v as SolError).code; };
    expect(code((await out("mmult")).result)).toBe("#SHAPE!"); // 4×3 × 4×3, inner dims clash
    expect(code((await out("cast")).result)).toBe("#VALUE!");  // "hello" → number
  });
});
