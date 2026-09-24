// [[B12]] losslessSaves, [[C77]] compositeIsSubgraph, [[B10]] reactFlowView
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidNode } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { setEditorRefs } from "../../src/graph/process";
import { CompositeNode, type CompositeInternalSnapshot } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { extractInit } from "../../src/graph/copyPaste";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";
import { nodeNameStore } from "../../src/graph/nodeNameStore";
import { pinStore } from "../../src/graph/pinStore";
import { commentStore } from "../../src/graph/commentStore";
import { frameFormatStore } from "../../src/graph/frameFormatStore";
import { standoffStore } from "../../src/graph/standoffs";
import { serializeGraph, loadGraph } from "../../src/graph/persistence";
import { createCompositeFromSelection, unpackComposite } from "../../src/graph/compositeLogic";
import type { FormatAnnotation } from "../../src/graph/formatAnnotationStore";

const ANN = { format: "percent" } as FormatAnnotation;

let editor: NodeEditor<Schemes>;
let view: View;

beforeEach(() => {
  forgetAllNodes();
  editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const pos = new Map<string, { x: number; y: number }>();
  view = {
    hasNode: (id: string) => pos.has(id),
    position: (id: string) => pos.get(id) ?? { x: 0, y: 0 },
    moveNode: async (id: string, p: { x: number; y: number }) => { pos.set(id, { ...p }); },
    nodeElement: () => null,
    measured: () => ({ w: 100, h: 60 }),
    container: { clientWidth: 800, clientHeight: 600 },
    pan: async () => {},
    zoom: async () => {},
    rerenderNode: async () => {},
    transform: { x: 0, y: 0, k: 1 },
  } as unknown as View;
  setEditorRefs(editor, engine, view);
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

/** A composite holding two cards, the first pinned, commented, column-formatted and bound to the second by a standoff. */
async function annotatedComposite(): Promise<CompositeNode> {
  const c = new CompositeNode({});
  await c.hydrate(ctorRegistry());
  const a = new NumberInputNode({ value: 1 });
  const b = new NoteNode({});
  await c.internalEditor.addNode(a as never);
  await c.internalEditor.addNode(b as never);
  pinStore.toggle(a.id, "value");
  commentStore.add(a.id, "Ann", "check this");
  frameFormatStore.set(a.id, "Rate", ANN);
  standoffStore.add({ nodeId: b.id, anchor: "e" }, { nodeId: a.id, anchor: "w" }, 40, 80);
  return c;
}

function innerIds(c: CompositeNode): { a: string; b: string } {
  const [a, b] = c.internalEditor.getNodes();
  return { a: a.id, b: b.id };
}

function expectAnnotated(c: CompositeNode) {
  const { a, b } = innerIds(c);
  expect(pinStore.list().filter((p) => p.nodeId === a)).toEqual([{ nodeId: a, outputKey: "value" }]);
  expect(commentStore.forNode(a).map((x) => x.text)).toEqual(["check this"]);
  expect(frameFormatStore.get(a, "Rate")).toEqual(ANN);
  expect(standoffStore.all().filter((s) => s.a.nodeId === b && s.b.nodeId === a)).toHaveLength(1);
}

async function reload(init: Record<string, unknown>): Promise<CompositeNode> {
  const c = new CompositeNode(structuredClone(init) as ConstructorParameters<typeof CompositeNode>[0]);
  await c.hydrate(ctorRegistry());
  return c;
}

describe("an inner card's pins, comments, frame formats and standoffs travel with the composite", () => {
  it("through its snapshot, a copy, and a drill-in undo", async () => {
    const c = await annotatedComposite();
    const before = innerIds(c);
    const snap = extractInit(c).internal as CompositeInternalSnapshot;
    expect(snap.pins).toHaveLength(1);
    expect(snap.comments).toHaveLength(1);
    expect(snap.frameFormats).toHaveLength(1);
    expect(snap.standoffs).toHaveLength(1);

    const copy = await reload(extractInit(c));
    expect(innerIds(copy).a).not.toBe(before.a);
    expectAnnotated(copy);
    expect(new Set(commentStore.list().map((x) => x.id)).size).toBe(commentStore.list().length);

    await copy.restoreInternal(copy.snapshotInternal(), ctorRegistry());
    expectAnnotated(copy);
    expect(pinStore.list()).toHaveLength(2);
  });

  it("through a document save and load, and the main undo that reloads", async () => {
    const c = await annotatedComposite();
    await editor.addNode(c as SolenoidNode);
    const outer = new NumberInputNode({ value: 2 });
    await editor.addNode(outer as SolenoidNode);
    pinStore.toggle(outer.id, "value");

    const g = serializeGraph()!;
    expect(g.pins).toEqual([{ nodeId: nodeNameStore.get(outer.id), outputKey: "value" }]);
    expect(g.comments).toBeUndefined();

    expect(await loadGraph(g, { curtain: false })).toBe(true);
    const c2 = editor.getNodes().find((n) => n instanceof CompositeNode) as CompositeNode;
    expectAnnotated(c2);
    expect(pinStore.list()).toHaveLength(2);
    const internalOf = (x: typeof g) => x.nodes.find((n) => n.type === "CompositeNode")!.init.internal;
    expect(internalOf(serializeGraph()!)).toEqual(internalOf(g));
  });

  it("through Wrap and Unpack, which drop a standoff the boundary would split", async () => {
    const a = new NumberInputNode({ value: 1 });
    const inside = new NoteNode({});
    const outside = new NoteNode({});
    for (const n of [a, inside, outside]) await editor.addNode(n as SolenoidNode);
    pinStore.toggle(a.id, "value");
    standoffStore.add({ nodeId: inside.id, anchor: "e" }, { nodeId: a.id, anchor: "w" }, 40, 80);
    standoffStore.add({ nodeId: outside.id, anchor: "e" }, { nodeId: a.id, anchor: "w" }, 40, 80);
    a.selected = true;
    inside.selected = true;

    const compId = await createCompositeFromSelection(editor, view);
    const comp = editor.getNode(compId!) as CompositeNode;
    expect(standoffStore.all()).toHaveLength(1);
    expect(serializeGraph()!.pins).toBeUndefined();
    const snap = comp.snapshotInternal();
    expect(snap.pins).toEqual([{ nodeId: a.id, outputKey: "value" }]);
    expect(snap.standoffs).toHaveLength(1);

    expect(await unpackComposite(editor, view, compId!)).toBe(true);
    const g = serializeGraph()!;
    expect(g.pins).toEqual([{ nodeId: nodeNameStore.get(a.id), outputKey: "value" }]);
    expect(g.standoffs).toHaveLength(1);
  });
});
