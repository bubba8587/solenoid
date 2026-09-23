// [[B10]], [[C43]], [[C25]]
// A docked FC is part of its host's entity, so deleting a host takes the FCs docked on it.
import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { setEditorRefs, processGraph } from "../../src/graph/process";
import { cableValueStore } from "../../src/graph/cableValueStore";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { insertFcInline } from "../../src/graph/fcDocking";
import { deleteSelection } from "../../src/graph/canvasActions";
import { dockedNodeStore } from "../../src/graph/dockedNodeStore";

function makeGraph() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const view = { rerenderNode: async () => {}, position: () => null, nodeElement: () => null, hasNode: () => false } as unknown as View;
  setEditorRefs(editor, engine, view);
  return { editor, engine, view };
}

// attachFormatController's model half (canvasActions.ts), minus the DOM placement.
async function attach(editor: NodeEditor<Schemes>, hostNodeId: string, socketKey: string) {
  const fc = new FormatControllerNode({ hostNodeId, socketKey, side: "output" });
  await editor.addNode(fc);
  fc.dockSelf(editor);
  await insertFcInline(editor, fc);
  await processGraph();
  return fc;
}

describe("Host → FC → FC, delete the middle FC", () => {
  it("takes the FC docked on it and keeps computing", async () => {
    const { editor, view } = makeGraph();
    const host = new NumberInputNode({ value: 42 });
    await editor.addNode(host);
    await processGraph();
    const fc1 = await attach(editor, host.id, "value");
    const fc2 = await attach(editor, fc1.id, "out");
    expect(editor.getConnections().map((c) => [c.source, c.target])).toEqual([[host.id, fc1.id], [fc1.id, fc2.id]]);
    expect(cableValueStore.get(fc2.id, "out")).toBe(42);

    fc1.selected = true;
    await deleteSelection(editor, view);
    expect(editor.getNode(fc1.id)).toBeUndefined();
    expect(editor.getNode(fc2.id)).toBeUndefined();
    expect(editor.getConnections()).toEqual([]);
    await processGraph();
    expect(cableValueStore.get(host.id, "value")).toBe(42);
  });
});

describe("deleting a host alone", () => {
  it("takes its docked FCs at any depth, so no FC is left docked to a missing host", async () => {
    const { editor, view } = makeGraph();
    const host = new NumberInputNode({ value: 5 });
    await editor.addNode(host);
    const fc1 = await attach(editor, host.id, "value");
    const fc2 = await attach(editor, fc1.id, "out");

    host.selected = true;
    await deleteSelection(editor, view);
    expect(editor.getNodes()).toEqual([]);
    expect(dockedNodeStore.get(fc1.id)).toBeUndefined();
    expect(dockedNodeStore.get(fc2.id)).toBeUndefined();
  });
});

describe("a node removed while a compute pass is in flight", () => {
  it("is skipped by the pass instead of throwing rete-engine's 'node is not initialized'", async () => {
    const { editor } = makeGraph();
    const a = new NumberInputNode({ value: 1 });
    const b = new NumberInputNode({ value: 2 });
    await editor.addNode(a);
    await editor.addNode(b);
    const inFlight = processGraph(); // un-awaited, like the connectionremoved pipe's targeted pass
    await editor.removeNode(b.id);   // engine drops b's setup mid-pass
    await expect(inFlight).resolves.toBeUndefined();
    expect(cableValueStore.get(a.id, "value")).toBe(1);
  });
});
