// [[C43]] oneFlowSurface, [[D41]] formatFlowsDownstream
import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidConnection } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { setEditorRefs, processGraph } from "../../src/graph/process";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { DisplayNode } from "../../src/graph/nodes/display";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { CompositeInputNode } from "../../src/graph/nodes/composite";
import { insertFcInline, removeFcInline } from "../../src/graph/fcDocking";
import { deleteSelection, type DeleteScope } from "../../src/graph/canvasActions";
import { cableGhostStore } from "../../src/graph/cableState";
import { drawnCableStore } from "../../src/graph/drawnCables";

function makeGraph() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const view = { rerenderNode: async () => {}, position: () => null, nodeElement: () => null, hasNode: () => false } as unknown as View;
  setEditorRefs(editor, engine, view);
  return { editor, view };
}

async function hostWithTwoConsumers(editor: NodeEditor<Schemes>) {
  const host = new NumberInputNode({ value: 7 });
  const a = new DisplayNode();
  const b = new DisplayNode();
  for (const n of [host, a, b]) await editor.addNode(n);
  for (const d of [a, b]) {
    await editor.addConnection(new ClassicPreset.Connection(host, "value", d, "in") as SolenoidConnection);
  }
  const fc = new FormatControllerNode({ hostNodeId: host.id, socketKey: "value", side: "output" });
  await editor.addNode(fc);
  fc.dockSelf(editor);
  await insertFcInline(editor, fc);
  return { host, a, b, fc };
}

const wires = (editor: NodeEditor<Schemes>) =>
  editor.getConnections().map((c) => `${c.source}.${c.sourceOutput}>${c.target}.${c.targetInput}`).sort();

describe("deleting a docked FC unsplices it", () => {
  it("hands every consumer back to the host with solid cables", async () => {
    const { editor, view } = makeGraph();
    const { host, a, b, fc } = await hostWithTwoConsumers(editor);
    expect(editor.getConnections().filter((c) => c.source === fc.id)).toHaveLength(2);

    fc.selected = true;
    await deleteSelection(editor, view);

    expect(editor.getNode(fc.id)).toBeUndefined();
    expect(wires(editor)).toEqual([`${host.id}.value>${a.id}.in`, `${host.id}.value>${b.id}.in`].sort());
    expect(editor.getConnections().some((c) => cableGhostStore.isGhost(c.id))).toBe(false);
  });

  it("goes before its host when both are selected, so the host's own splice still applies", async () => {
    const { editor, view } = makeGraph();
    const src = new NumberInputNode({ value: 3 });
    const host = new DisplayNode();
    const sink = new DisplayNode();
    for (const n of [src, host, sink]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(src, "value", host, "in") as SolenoidConnection);
    await editor.addConnection(new ClassicPreset.Connection(host, "out", sink, "in") as SolenoidConnection);
    const fc = new FormatControllerNode({ hostNodeId: host.id, socketKey: "out", side: "output" });
    await editor.addNode(fc);
    fc.dockSelf(editor);
    await insertFcInline(editor, fc);

    host.selected = true;
    fc.selected = true;
    await deleteSelection(editor, view);

    expect(wires(editor)).toEqual([`${src.id}.value>${sink.id}.in`]);
  });
});

describe("removeFcInline when the host socket is gone", () => {
  it("bridges the FC's source straight to its consumers", async () => {
    const { editor } = makeGraph();
    const { host, a, b, fc } = await hostWithTwoConsumers(editor);
    fc.socketKey = "no_such_socket";
    await removeFcInline(editor, fc);
    expect(wires(editor)).toEqual([`${host.id}.value>${a.id}.in`, `${host.id}.value>${b.id}.in`].sort());
  });
});

describe("a drill-in's delete scope", () => {
  it("keeps boundary markers, leaves the main canvas's layers alone and settles once through the scope", async () => {
    const { editor, view } = makeGraph();
    const marker = new CompositeInputNode({ label: "Input 1" });
    const inner = new DisplayNode();
    await editor.addNode(marker as never);
    await editor.addNode(inner);
    marker.selected = true;
    inner.selected = true;
    const drawn = drawnCableStore.add([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    if (drawn) drawnCableStore.select(drawn.id);

    let gate = 0;
    let settles = 0;
    const scope: DeleteScope = {
      mainLayers: false,
      keeps: (n) => n instanceof CompositeInputNode,
      begin: () => { gate++; },
      end: () => { gate--; },
      settle: async () => { settles++; expect(gate).toBe(0); },
    };
    await deleteSelection(editor, view, scope);

    expect(editor.getNode(marker.id)).toBeDefined();
    expect(editor.getNode(inner.id)).toBeUndefined();
    expect(settles).toBe(1);
    if (drawn) {
      expect(drawnCableStore.selected()).toBe(drawn.id);
      drawnCableStore.remove(drawn.id);
    }
    await processGraph();
  });
});
