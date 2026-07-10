// FC lambda view-as / chart text-scale: the annotation must reach a downstream
// Display through the REAL resolution chain (the exact wiring DisplayNode uses:
// getForNode → inAnnotation → downstreamAnnotation), with real node classes —
// not duck-typed mocks — so a change to the FC or resolver that drops the new
// fields fails here.
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { FormatControllerNode } from "./nodes/formatController";
import { LambdaNode } from "./nodes/lambda";
import { DisplayNode } from "./nodes/display";
import { ChartNode } from "./nodes/visual";
import { makeAnnotationResolver } from "./unitFlow";
import { formatAnnotationStore } from "./formatAnnotationStore";
import { insertFcInline } from "./fcDocking";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;

const connect = async (e: AnyEditor, s: ClassicPreset.Node, sOut: string, t: ClassicPreset.Node, tIn: string) =>
  e.addConnection(new ClassicPreset.Connection(s as never, sOut, t as never, tIn) as never);

// DisplayNode's resolution order, verbatim (DisplayNode.tsx).
function displayAnn(editor: AnyEditor, displayId: string) {
  const r = makeAnnotationResolver(editor);
  return (
    formatAnnotationStore.getForNode(displayId) ??
    r.inAnnotation(displayId, "in") ??
    r.downstreamAnnotation(displayId, "out")
  );
}

describe("FC lambdaView / chartFontScale reach a downstream Display", () => {
  it("Lambda → FC → Display: the Display resolves the FC's lambdaView", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const lam = new LambdaNode();
    const fc = new FormatControllerNode();
    const disp = new DisplayNode();
    for (const n of [lam, fc, disp]) await editor.addNode(n as never);
    await connect(editor, lam as unknown as ClassicPreset.Node, "result", fc, "in");
    await connect(editor, fc, "out", disp as unknown as ClassicPreset.Node, "in");
    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("lambda");
    fc.lambdaView = "katex";
    fc.refreshAnnotation(editor as never);

    expect(displayAnn(editor, disp.id)?.lambdaView).toBe("katex");
    // The annotation lands on the box BEHIND the FC too (the lambda's output) —
    // its own card deliberately ignores it (LambdaNode.tsx keeps the signature).
    expect(formatAnnotationStore.get(lam.id, "result")?.lambdaView).toBe("katex");

    formatAnnotationStore.delete(lam.id, "result");
  });

  it("Display → trailing FC: the Display resolves lambdaView from AHEAD (downstreamAnnotation path)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const lam = new LambdaNode();
    const disp = new DisplayNode();
    const fc = new FormatControllerNode();
    for (const n of [lam, disp, fc]) await editor.addNode(n as never);
    await connect(editor, lam as unknown as ClassicPreset.Node, "result", disp as unknown as ClassicPreset.Node, "in");
    await connect(editor, disp as unknown as ClassicPreset.Node, "out", fc, "in");
    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("lambda");
    fc.lambdaView = "mono";
    fc.refreshAnnotation(editor as never);

    // Direct annotation on the Display's out socket (the box behind the FC).
    expect(displayAnn(editor, disp.id)?.lambdaView).toBe("mono");

    formatAnnotationStore.delete(disp.id, "out");
  });

  it("the REAL attach flow — Display wired first, FC right-click-attached to the λ output (dockSelf + insertFcInline)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const lam = new LambdaNode();
    const disp = new DisplayNode();
    for (const n of [lam, disp]) await editor.addNode(n as never);
    // The pre-existing cable the user already had.
    await connect(editor, lam as unknown as ClassicPreset.Node, "result", disp as unknown as ClassicPreset.Node, "in");

    // attachFormatController's sequence (canvasActions.ts): construct docked,
    // add, dockSelf (adopts the type + refreshes), splice inline.
    const fc = new FormatControllerNode({ hostNodeId: lam.id, socketKey: "result", side: "output" });
    await editor.addNode(fc as never);
    fc.dockSelf(editor as never);
    await insertFcInline(editor as never, fc);
    expect(fc.socketDataType).toBe("lambda");

    // The dropdown change (FormatControllerNode.tsx onLambdaViewChange → syncNode).
    fc.lambdaView = "syntax";
    for (const n of editor.getNodes()) {
      if (n instanceof FormatControllerNode) n.refreshAnnotation(editor as never);
    }

    // The splice rerouted the Display behind the FC…
    const conns = editor.getConnections();
    expect(conns.some((c) => c.source === fc.id && c.target === disp.id)).toBe(true);
    // …and the Display resolves the view.
    expect(displayAnn(editor, disp.id)?.lambdaView).toBe("syntax");

    formatAnnotationStore.delete(lam.id, "result");
  });

  it("Chart → FC → Display: the Display resolves the FC's chartFontScale", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const chart = new ChartNode();
    const fc = new FormatControllerNode();
    const disp = new DisplayNode();
    for (const n of [chart, fc, disp]) await editor.addNode(n as never);
    await connect(editor, chart as unknown as ClassicPreset.Node, "chart", fc, "in");
    await connect(editor, fc, "out", disp as unknown as ClassicPreset.Node, "in");
    fc.adaptTypeFromConnections(editor as never);
    expect(fc.socketDataType).toBe("chart");
    fc.chartFontScale = 1.5;
    fc.refreshAnnotation(editor as never);

    expect(displayAnn(editor, disp.id)?.chartFontScale).toBe(1.5);

    formatAnnotationStore.delete(chart.id, "chart");
  });
});
