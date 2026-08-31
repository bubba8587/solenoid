import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "../../src/graph/rete-nodes";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { isChartValue } from "../../src/graph/chartValue";
import { isMermaidValue } from "../../src/graph/mermaidValue";
import { isLambdaValue } from "../../src/graph/nodes/lambda";
import { isFrameValue } from "../../src/graph/frame";
import { isDocumentValue } from "../../src/graph/documentValue";
import seed from "../../src/graph/seedGraphs/report-showcase.json";

// The Report Showcase seed exercises every distinct Report ref/embed render
// path end to end: a scalar ref (=total), an inline frame table (=table), a
// chart figure (=fig -> a first-class chart value), a lambda -> KaTeX equation
// (=model), a Mermaid diagram (=flow -> a chart-family figure), and a Note
// embedded through the SAME `=name` ref mechanism, wired document -> ref.

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
  it("resolves a scalar, a frame, a chart, a lambda, a diagram, and an embed", async () => {
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

    // A frame renders inline as a compact table (FrameDisplay).
    expect(isFrameValue(report.refValue("table"))).toBe(true);

    // A chart value redraws inline where its =fig ref sits.
    const fig = report.refValue("fig");
    expect(isChartValue(fig)).toBe(true);
    expect((fig as { op: string }).op).toBe("column");

    // A lambda renders as a KaTeX equation — the value carries its source body.
    const model = report.refValue("model");
    expect(isLambdaValue(model)).toBe(true);
    expect((model as { expr: string }).expr).toContain("growth");

    // A Mermaid diagram flows the chart socket and renders as a figure.
    const flow = report.refValue("flow");
    expect(isMermaidValue(flow)).toBe(true);
    expect((flow as { source: string }).source).toContain("graph LR");

    // The embedded Note arrives as a DOCUMENT value on an ordinary ref cable.
    const method = report.refValue("Methodology");
    expect(isDocumentValue(method)).toBe(true);
    expect((method as { body: string }).body).toContain("unaudited");
  });
});
