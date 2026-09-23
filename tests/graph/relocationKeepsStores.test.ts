// [[C40]] storesRegisterForget, [[C43]] oneFlowSurface
import type { View } from "../../src/graph/view";
import { describe, it, expect, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode } from "../../src/graph/schemes";
import { createCompositeFromSelection, unpackComposite } from "../../src/graph/compositeLogic";
import { settleNodeRemoved } from "../../src/graph/canvasActions";
import { setActiveGraph, type EditScope } from "../../src/graph/activeGraph";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { DisplayNode } from "../../src/graph/nodes/display";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { dockedNodeStore } from "../../src/graph/dockedNodeStore";
import { nodeNameStore } from "../../src/graph/nodeNameStore";
import { collapseStore } from "../../src/graph/collapseStore";

function fakeView(): View {
  const pos = new Map<string, { x: number; y: number }>();
  return {
    hasNode: (id: string) => pos.has(id),
    position: (id: string) => pos.get(id) ?? { x: 0, y: 0 },
    nodeElement: () => ({ offsetWidth: 100, offsetHeight: 60 }) as unknown as HTMLElement,
    connectionElement: () => null,
    moveNode: async (id: string, p: { x: number; y: number }) => { pos.set(id, p); },
    rerenderNode: async () => {},
    rerenderCables: async () => {},
  } as unknown as View;
}

/** A drill-in level: its own gate, and the shared `noderemoved` settle on its pipe. */
function drillLevel() {
  const editor = new NodeEditor<Schemes>();
  editor.use(new DataflowEngine<Schemes>());
  const view = fakeView();
  const gate = { up: false };
  const scope: EditScope = { begin: () => { gate.up = true; }, end: () => { gate.up = false; }, settle: async () => {} };
  editor.addPipe((ctx) => {
    if (ctx.type === "noderemoved") settleNodeRemoved(editor, view, ctx.data as SolenoidNode, gate.up);
    return ctx;
  });
  setActiveGraph({ editor, view, scope });
  return { editor, view };
}

afterEach(() => setActiveGraph(null));

describe("Wrap as Composite inside a drill-in relocates, it doesn't delete", () => {
  it("the wrapped nodes keep their docks, names and collapse state; unpack forgets only the composite", async () => {
    const { editor, view } = drillLevel();
    const num = new NumberInputNode({ value: 2 });
    const disp = new DisplayNode();
    const fc = new FormatControllerNode({});
    for (const n of [num, disp, fc]) await editor.addNode(n as SolenoidNode);
    await editor.addConnection(new ClassicPreset.Connection(num, "value", disp, "in") as Schemes["Connection"]);
    fc.hostNodeId = num.id; fc.socketKey = "value"; fc.side = "output";
    fc.dockSelf(editor as never);
    nodeNameStore.rename(num.id, "rate");
    collapseStore.set(disp.id, true);
    num.selected = true; disp.selected = true;

    const compId = await createCompositeFromSelection(editor, view);
    expect(compId).toBeTruthy();
    const comp = editor.getNode(compId!) as CompositeNode;
    expect(comp.internalEditor.getNode(num.id)).toBe(num);
    expect(dockedNodeStore.get(fc.id)?.hostNodeId).toBe(num.id);
    expect(nodeNameStore.get(num.id)).toBe("rate");
    expect(collapseStore.get(disp.id)).toBe(true);

    nodeNameStore.ensure(comp.id, "CompositeNode");
    expect(await unpackComposite(editor, view, comp.id)).toBe(true);
    expect(nodeNameStore.get(comp.id)).toBeUndefined();
    expect(nodeNameStore.get(num.id)).toBe("rate");
    expect(dockedNodeStore.get(fc.id)?.hostNodeId).toBe(num.id);
  });

  it("an ungated removal still forgets", async () => {
    const { editor } = drillLevel();
    const num = new NumberInputNode({ value: 1 });
    await editor.addNode(num as SolenoidNode);
    nodeNameStore.rename(num.id, "gone_soon");
    await editor.removeNode(num.id);
    expect(nodeNameStore.get(num.id)).toBeUndefined();
  });
});
