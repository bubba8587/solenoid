// Host → FC → FC, delete the MIDDLE FC: the graph must keep computing (a docked FC whose
// host is deleted must not leave the engine fetching a node it no longer has).
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
  it("keeps computing and re-homes nothing onto the deleted host", async () => {
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
    for (const c of editor.getConnections()) {
      expect(editor.getNode(c.source), `dangling source ${c.source}`).toBeDefined();
      expect(editor.getNode(c.target), `dangling target ${c.target}`).toBeDefined();
    }
    await processGraph();
    expect(cableValueStore.get(fc2.id, "out")).toBe(42);
    expect(dockedNodeStore.get(fc2.id)?.hostNodeId ?? "").not.toBe(fc1.id);
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
