import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { createCompositeFromSelection, unpackComposite } from "../../src/graph/compositeLogic";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import { DisplayNode } from "../../src/graph/nodes/display";

// A bare NodeEditor + DataflowEngine, wrapped exactly like Canvas wraps the
// real one (coercion inner, error guards outer) — mirrors errorIntegration.
// test.ts's makeEditor(). No AreaPlugin/ReactPlugin: this env has no DOM.
function makeEditor() {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  return { editor, engine };
}

// compositeLogic.ts only reads `view.position(id)` (for the bounding-box
// top-left) and calls `view.moveNode` — a tiny fake view satisfies both
// without any real rendering/DOM.
function makeFakeView(positions: Map<string, { x: number; y: number }>) {
  const translated: Array<{ id: string; x: number; y: number }> = [];
  const view = {
    hasNode: (id: string) => positions.has(id),
    position: (id: string) => positions.get(id),
    nodeElement: (id: string) =>
      (positions.has(id) ? { offsetWidth: 100, offsetHeight: 60 } : null) as unknown as HTMLElement | null,
    connectionElement: () => null,
    moveNode: async (id: string, pos: { x: number; y: number }) => {
      translated.push({ id, x: pos.x, y: pos.y });
      positions.set(id, pos); // keep the view in sync, like the real view
    },
  };
  return { view: view as unknown as View, translated };
}

function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

describe("createCompositeFromSelection", () => {
  it("returns null when nothing is selected", async () => {
    const { editor } = makeEditor();
    const { view } = makeFakeView(new Map());
    expect(await createCompositeFromSelection(editor, view)).toBeNull();
  });

  it("collapses a mixed selection into one card, preserving end-to-end computation", async () => {
    const { editor, engine } = makeEditor();
    const numA = new NumberInputNode({ value: 3 });
    const numB = new NumberInputNode({ value: 4 });
    const add = new ArithmeticNode({ op: "add" });
    const disp = new DisplayNode();
    for (const n of [numA, numB, add, disp]) await editor.addNode(n);
    await connect(editor, numA, "value", add, "a");
    await connect(editor, numB, "value", add, "b");
    await connect(editor, add, "result", disp, "in");

    // Select only numA + add: numB stays outside (crosses IN to `add`), disp
    // stays outside (crosses OUT from `add`) — the shape the plan calls out
    // explicitly (mirrors createGroupFromSelection's own selection read).
    (numA as unknown as { selected: boolean }).selected = true;
    (add as unknown as { selected: boolean }).selected = true;

    const { view } = makeFakeView(new Map([
      [numA.id, { x: 100, y: 100 }],
      [add.id, { x: 300, y: 100 }],
    ]));

    const compositeId = await createCompositeFromSelection(editor, view);
    expect(compositeId).not.toBeNull();

    // The selected nodes are GONE from the outer editor — physically relocated,
    // not just spatially framed like a Group.
    expect(editor.getNode(numA.id)).toBeUndefined();
    expect(editor.getNode(add.id)).toBeUndefined();
    expect(editor.getNodes()).toHaveLength(3); // numB, disp, composite

    const composite = editor.getNode(compositeId!) as unknown as CompositeNode;
    expect(composite).toBeInstanceOf(CompositeNode);
    expect(composite.inputPorts).toHaveLength(1);  // numB → add.b crossed in
    expect(composite.outputPorts).toHaveLength(1); // add.result → disp.in crossed out
    expect(composite.internalEditor.getNodes()).toHaveLength(4); // numA + add + 2 markers

    // The outer graph now reads numB → composite → disp — recompute end to end
    // and check the arithmetic still lands (3 + 4 = 7), unchanged by extraction.
    const dispOut = await engine.fetch(disp.id) as { out: unknown };
    expect(dispOut.out).toBe(7);
  });

  it("a selection with no crossing cables produces a composite with no ports", async () => {
    const { editor } = makeEditor();
    const numA = new NumberInputNode({ value: 1 });
    const numB = new NumberInputNode({ value: 2 });
    const add = new ArithmeticNode({ op: "add" });
    for (const n of [numA, numB, add]) await editor.addNode(n);
    await connect(editor, numA, "value", add, "a");
    await connect(editor, numB, "value", add, "b");
    for (const n of [numA, numB, add]) (n as unknown as { selected: boolean }).selected = true;

    const { view } = makeFakeView(new Map([
      [numA.id, { x: 0, y: 0 }], [numB.id, { x: 0, y: 40 }], [add.id, { x: 150, y: 20 }],
    ]));
    const compositeId = await createCompositeFromSelection(editor, view);
    const composite = editor.getNode(compositeId!) as unknown as CompositeNode;
    expect(composite.inputPorts).toHaveLength(0);
    expect(composite.outputPorts).toHaveLength(0);
    expect(editor.getNodes()).toHaveLength(1); // just the composite
    expect(composite.internalEditor.getNodes()).toHaveLength(3); // all three, no markers needed
  });

  it("captures each member's bbox-relative position for the drill-in editor", async () => {
    const { editor } = makeEditor();
    const numA = new NumberInputNode({ value: 3 });
    const add = new ArithmeticNode({ op: "add" });
    for (const n of [numA, add]) await editor.addNode(n);
    await connect(editor, numA, "value", add, "a");
    (numA as unknown as { selected: boolean }).selected = true;
    (add as unknown as { selected: boolean }).selected = true;

    const { view } = makeFakeView(new Map([
      [numA.id, { x: 100, y: 200 }],
      [add.id, { x: 350, y: 260 }],
    ]));
    const compositeId = await createCompositeFromSelection(editor, view);
    const composite = editor.getNode(compositeId!) as unknown as CompositeNode;
    expect(composite.internalPositions[numA.id]).toEqual({ x: 0, y: 0 });
    expect(composite.internalPositions[add.id]).toEqual({ x: 250, y: 60 });
    // Positions ride the snapshot (drill-in layout survives save/load).
    const snap = composite.snapshotInternal();
    const savedAdd = snap.nodes.find((n) => n.id === add.id)!;
    expect(savedAdd.x).toBe(250);
    expect(savedAdd.y).toBe(60);
  });

  it("excludes an already-selected Composite from a second collapse (no nesting yet)", async () => {
    const { editor } = makeEditor();
    const num = new NumberInputNode({ value: 5 });
    await editor.addNode(num);
    (num as unknown as { selected: boolean }).selected = true;
    const { view } = makeFakeView(new Map([[num.id, { x: 0, y: 0 }]]));
    const firstId = await createCompositeFromSelection(editor, view);
    expect(firstId).not.toBeNull();

    const composite = editor.getNode(firstId!)!;
    (composite as unknown as { selected: boolean }).selected = true;
    const secondId = await createCompositeFromSelection(editor, view);
    expect(secondId).toBeNull(); // the only selected node was a Composite itself
  });
});

describe("unpackComposite", () => {
  it("is a no-op (false) on a non-composite id", async () => {
    const { editor } = makeEditor();
    const num = new NumberInputNode({ value: 1 });
    await editor.addNode(num);
    const { view } = makeFakeView(new Map());
    expect(await unpackComposite(editor, view, num.id)).toBe(false);
    expect(editor.getNode(num.id)).toBeDefined();
  });

  it("restores nodes, wiring and computation — the inverse of collapse", async () => {
    const { editor, engine } = makeEditor();
    const numA = new NumberInputNode({ value: 3 });
    const numB = new NumberInputNode({ value: 4 });
    const add = new ArithmeticNode({ op: "add" });
    const disp = new DisplayNode();
    for (const n of [numA, numB, add, disp]) await editor.addNode(n);
    await connect(editor, numA, "value", add, "a");
    await connect(editor, numB, "value", add, "b");
    await connect(editor, add, "result", disp, "in");
    (numA as unknown as { selected: boolean }).selected = true;
    (add as unknown as { selected: boolean }).selected = true;

    const positions = new Map([
      [numA.id, { x: 100, y: 100 }],
      [add.id, { x: 300, y: 160 }],
    ]);
    const { view, translated } = makeFakeView(positions);
    const compositeId = await createCompositeFromSelection(editor, view);
    expect(compositeId).not.toBeNull();

    const ok = await unpackComposite(editor, view, compositeId!);
    expect(ok).toBe(true);

    // Card gone, members back, boundary cables restored as direct wires.
    expect(editor.getNode(compositeId!)).toBeUndefined();
    expect(editor.getNode(numA.id)).toBeDefined();
    expect(editor.getNode(add.id)).toBeDefined();
    expect(editor.getNodes()).toHaveLength(4); // numA numB add disp
    const conns = editor.getConnections();
    expect(conns).toHaveLength(3);
    expect(conns.some((c) => c.source === numA.id && c.target === add.id && c.targetInput === "a")).toBe(true);
    expect(conns.some((c) => c.source === numB.id && c.target === add.id && c.targetInput === "b")).toBe(true);
    expect(conns.some((c) => c.source === add.id && c.target === disp.id && c.targetInput === "in")).toBe(true);

    // Relative layout restored around the card's position (the card sat at the
    // old bbox origin, so absolute positions round-trip exactly here).
    const back = (id: string) => { const hits = translated.filter((t) => t.id === id); return hits[hits.length - 1]; };
    expect(back(numA.id)).toMatchObject({ x: 100, y: 100 });
    expect(back(add.id)).toMatchObject({ x: 300, y: 160 });

    // End-to-end computation still lands after the round trip.
    engine.reset();
    const dispOut = await engine.fetch(disp.id) as { out: unknown };
    expect(dispOut.out).toBe(7);
  });
});
