// [[C43]] oneFlowSurface, [[C52]] visibleSelection, [[D41]] formatFlowsDownstream
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidConnection, SolenoidNode } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { setEditorRefs } from "../../src/graph/process";
import { setSelectNode, setUnselectAllNodes } from "../../src/graph/canvasCommands";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { DisplayNode } from "../../src/graph/nodes/display";
import { GroupNode } from "../../src/graph/nodes/group";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { CompositeInputNode } from "../../src/graph/nodes/composite";
import { insertFcInline } from "../../src/graph/fcDocking";
import { dockedNodeStore } from "../../src/graph/dockedNodeStore";
import { copySelected, copySet, pasteClipboard } from "../../src/graph/copyPaste";
import { mergeFlowNodes, toFlowNodes } from "../../src/graph/flow/flowModel";
import { setActiveGraph } from "../../src/graph/activeGraph";

let editor: NodeEditor<Schemes>;

beforeEach(() => {
  editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const view = {
    position: (id: string) => editor.getNode(id)?.position,
    moveNode: async (id: string, p: { x: number; y: number }) => { const n = editor.getNode(id); if (n) n.position = { ...p }; },
    rerenderNode: async () => {},
    nodeElement: () => null,
    hasNode: (id: string) => !!editor.getNode(id),
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  setUnselectAllNodes(() => { for (const n of editor.getNodes()) n.selected = false; });
  setSelectNode((id, acc) => { for (const n of editor.getNodes()) n.selected = n.id === id || (acc && n.selected === true); });
});

async function add<T extends SolenoidNode>(n: T, x = 0, y = 0): Promise<T> {
  await editor.addNode(n);
  n.position = { x, y };
  return n;
}

async function dockedPair() {
  const host = await add(new NumberInputNode({ value: 5 }));
  const sink = await add(new DisplayNode(), 300, 0);
  await editor.addConnection(new ClassicPreset.Connection(host, "value", sink, "in") as SolenoidConnection);
  const fc = await add(new FormatControllerNode({ hostNodeId: host.id, socketKey: "value", side: "output" }), 150, 0);
  fc.dockSelf(editor);
  await insertFcInline(editor, fc);
  return { host, sink, fc };
}

describe("copy", () => {
  it("brings a copied host's docked FC", async () => {
    const { host, fc } = await dockedPair();
    host.selected = true;
    expect(copySet(editor).map((n) => n.id).sort()).toEqual([host.id, fc.id].sort());
  });

  it("never takes a boundary marker, even as a selected group's member", async () => {
    const marker = await add(new CompositeInputNode({ label: "Input 1" }) as unknown as SolenoidNode);
    const inner = await add(new DisplayNode());
    const group = await add(new GroupNode({ members: [marker.id, inner.id] }));
    group.selected = true;
    expect(copySet(editor).map((n) => n.id).sort()).toEqual([group.id, inner.id].sort());
  });
});

describe("paste", () => {
  it("pastes what was copied, not what the source became", async () => {
    const src = await add(new NumberInputNode({ value: 1 }));
    src.selected = true;
    copySelected();
    (src as unknown as { value: number }).value = 99;
    await editor.removeNode(src.id);
    await pasteClipboard(0, 0);
    const pasted = editor.getNodes().filter((n) => n instanceof NumberInputNode);
    expect(pasted).toHaveLength(1);
    expect((pasted[0] as unknown as { value: number }).value).toBe(1);
  });

  it("selects the clones and re-docks a pasted docked FC onto the pasted host", async () => {
    const { host, fc } = await dockedPair();
    host.selected = true;
    copySelected();
    await pasteClipboard(0, 400);
    const clones = editor.getNodes().filter((n) => n.id !== host.id && n.id !== fc.id && !(n instanceof DisplayNode));
    const hostClone = clones.find((n) => n instanceof NumberInputNode)!;
    const fcClone = clones.find((n) => n instanceof FormatControllerNode)!;
    expect(hostClone.selected && fcClone.selected).toBe(true);
    expect(host.selected || fc.selected).toBe(false);
    expect(dockedNodeStore.get(fcClone.id)?.hostNodeId).toBe(hostClone.id);
    expect(editor.getConnections().some((c) => c.source === hostClone.id && c.target === fcClone.id)).toBe(true);
  });
});

describe("paste inside a drill-in", () => {
  it("gates and settles through the drill-in's own scope, never the main canvas's", async () => {
    const drill = new NodeEditor<Schemes>();
    const drillView = {
      position: (id: string) => drill.getNode(id)?.position,
      moveNode: async (id: string, p: { x: number; y: number }) => { const n = drill.getNode(id); if (n) n.position = { ...p }; },
      rerenderNode: async () => {},
      nodeElement: () => null,
      hasNode: (id: string) => !!drill.getNode(id),
    } as unknown as View;
    const calls: string[] = [];
    let settled: Set<string> | undefined;
    const scope = {
      begin: () => { calls.push("begin"); },
      end: () => { calls.push("end"); },
      settle: async (renderOnly?: Set<string>) => { calls.push("settle"); settled = renderOnly; },
    };
    const src = await add(new NumberInputNode({ value: 3 }));
    src.selected = true;
    copySelected();
    setActiveGraph({ editor: drill, view: drillView, scope });
    try {
      await pasteClipboard(0, 0);
    } finally {
      setActiveGraph(null);
    }
    expect(calls).toEqual(["begin", "end", "settle"]);
    expect(drill.getNodes()).toHaveLength(1);
    expect([...settled!]).toEqual([drill.getNodes()[0].id]);
    expect(editor.getNodes()).toHaveLength(1);
  });
});

describe("mergeFlowNodes", () => {
  it("a node RF hasn't seen takes the model's selection; a known one keeps RF's", async () => {
    const a = await add(new DisplayNode());
    const b = await add(new DisplayNode());
    const m = { editor } as Parameters<typeof toFlowNodes>[0];
    const first = toFlowNodes(m).filter((n) => n.id === a.id).map((n) => ({ ...n, selected: true }));
    a.selected = false;
    b.selected = true;
    const merged = mergeFlowNodes(first, toFlowNodes(m));
    expect(merged.find((n) => n.id === a.id)?.selected).toBe(true);
    expect(merged.find((n) => n.id === b.id)?.selected).toBe(true);
  });
});
