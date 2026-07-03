import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import { DataflowEngine } from "rete-engine";
import type { Schemes, AreaExtra } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { createCompositeFromSelection } from "./compositeLogic";
import { CompositeNode } from "./nodes/composite";
import { NumberInputNode } from "./nodes/input";
import { ArithmeticNode } from "./nodes/scalar";
import { DisplayNode } from "./nodes/display";

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

// compositeLogic.ts only reads `area.nodeViews.get(id).position` (for the
// bounding-box top-left) and calls `area.translate` — a tiny fake area
// satisfies both without any real rendering/DOM.
function makeFakeArea(positions: Map<string, { x: number; y: number }>) {
  const translated: Array<{ id: string; x: number; y: number }> = [];
  const area = {
    nodeViews: {
      get: (id: string) => {
        const p = positions.get(id);
        return p ? { position: p, element: { offsetWidth: 100, offsetHeight: 60 } } : undefined;
      },
    },
    translate: async (id: string, pos: { x: number; y: number }) => {
      translated.push({ id, x: pos.x, y: pos.y });
    },
  };
  return { area: area as unknown as AreaPlugin<Schemes, AreaExtra>, translated };
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
    const { area } = makeFakeArea(new Map());
    expect(await createCompositeFromSelection(editor, area)).toBeNull();
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

    const { area } = makeFakeArea(new Map([
      [numA.id, { x: 100, y: 100 }],
      [add.id, { x: 300, y: 100 }],
    ]));

    const compositeId = await createCompositeFromSelection(editor, area);
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

    const { area } = makeFakeArea(new Map([
      [numA.id, { x: 0, y: 0 }], [numB.id, { x: 0, y: 40 }], [add.id, { x: 150, y: 20 }],
    ]));
    const compositeId = await createCompositeFromSelection(editor, area);
    const composite = editor.getNode(compositeId!) as unknown as CompositeNode;
    expect(composite.inputPorts).toHaveLength(0);
    expect(composite.outputPorts).toHaveLength(0);
    expect(editor.getNodes()).toHaveLength(1); // just the composite
    expect(composite.internalEditor.getNodes()).toHaveLength(3); // all three, no markers needed
  });

  it("excludes an already-selected Composite from a second collapse (no nesting yet)", async () => {
    const { editor } = makeEditor();
    const num = new NumberInputNode({ value: 5 });
    await editor.addNode(num);
    (num as unknown as { selected: boolean }).selected = true;
    const { area } = makeFakeArea(new Map([[num.id, { x: 0, y: 0 }]]));
    const firstId = await createCompositeFromSelection(editor, area);
    expect(firstId).not.toBeNull();

    const composite = editor.getNode(firstId!)!;
    (composite as unknown as { selected: boolean }).selected = true;
    const secondId = await createCompositeFromSelection(editor, area);
    expect(secondId).toBeNull(); // the only selected node was a Composite itself
  });
});
