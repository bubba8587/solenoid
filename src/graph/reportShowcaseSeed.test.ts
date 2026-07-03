import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { isChartValue } from "./chartValue";
import { extractEmbedNames } from "./reportEmbeds";
import seed from "./seedGraphs/report-showcase.json";

// The Report Showcase seed exercises all three Report ref/embed paths end to
// end: a scalar ref (=total), a chart ref (=fig -> a first-class chart value),
// and an inline embed token (![[Methodology]]).

type SavedNode = { id: string; type: string; init?: Record<string, unknown>; literals?: Record<string, number>; stringLiterals?: Record<string, string> };

function build() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

describe("Report Showcase seed", () => {
  it("resolves a scalar ref, a chart ref, and an embed token", async () => {
    const { editor, engine } = build();
    const byId = new Map<string, ClassicPreset.Node>();
    for (const sn of (seed.nodes as SavedNode[])) {
      const Ctor = (Nodes as unknown as Record<string, new (i?: Record<string, unknown>) => ClassicPreset.Node>)[sn.type];
      expect(Ctor, `unknown type ${sn.type}`).toBeTypeOf("function");
      const node = new Ctor({ ...sn.init });
      const anyN = node as unknown as Record<string, unknown>;
      if (sn.literals) anyN.literals = { ...sn.literals };
      if (sn.stringLiterals) anyN.stringLiterals = { ...sn.stringLiterals };
      byId.set(sn.id, node);
      await editor.addNode(node as Schemes["Node"]);
    }
    for (const c of seed.connections) {
      await editor.addConnection(new ClassicPreset.Connection(byId.get(c.source)!, c.sourceOutput, byId.get(c.target)!, c.targetInput) as Schemes["Connection"]);
    }
    const report = byId.get("report") as unknown as { refValue: (k: string) => unknown; body: string };
    for (const n of editor.getNodes()) await engine.fetch(n.id);

    expect(report.refValue("total")).toBe(113); // 12+19+14+23+18+27
    const fig = report.refValue("fig");
    expect(isChartValue(fig)).toBe(true);
    expect((fig as { op: string }).op).toBe("column");
    expect(extractEmbedNames(report.body)).toContain("Methodology");
  });
});
