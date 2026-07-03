import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import { ctorRegistry } from "../nodeCtorRegistry";
import { extractInit } from "../copyPaste";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "./composite";
import { NumberInputNode } from "./input";
import { ArithmeticNode } from "./scalar";

function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

describe("CompositeNode shell", () => {
  it("starts with no ports and no sockets", () => {
    const c = new CompositeNode();
    expect(c.inputPorts).toEqual([]);
    expect(c.outputPorts).toEqual([]);
    expect(Object.keys(c.inputs)).toEqual([]);
    expect(Object.keys(c.outputs)).toEqual([]);
    expect(c.isHydrated).toBe(true); // nothing pending — a freshly-built shell
  });

  it("addInputPort/addOutputPort add real sockets keyed by the returned port id", () => {
    const c = new CompositeNode();
    const inId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: "marker-1" });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: "marker-2" });
    expect(c.inputs[inId]).toBeDefined();
    expect(c.outputs[outId]).toBeDefined();
    expect(c.inputPorts).toHaveLength(1);
    expect(c.outputPorts).toHaveLength(1);
  });

  it("a hidden input port gets NO outer socket, only a baked default", () => {
    const c = new CompositeNode();
    const inId = c.addInputPort({ label: "K", exposure: "hidden", tier: "advanced", internalNodeId: "marker-1", default: 42 });
    expect(c.inputs[inId]).toBeUndefined();
    expect(c.inputPorts[0].default).toBe(42);
  });

  it("computes through its internal subgraph: exposed input → internal add → output", async () => {
    const c = new CompositeNode();
    // Build the internal graph BY HAND (mirrors what createCompositeFromSelection
    // does programmatically): one real ArithmeticNode plus the two boundary markers.
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 0, b: 10 }; // "a" is the exposed input; "b" is baked into the node itself
    const inMarker = new CompositeInputNode({ label: "A" });
    const outMarker = new CompositeOutputNode({ label: "Result" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", add, "a");
    await connect(c.internalEditor, add, "result", outMarker, "value");

    const inId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inMarker.id });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: outMarker.id });

    const out = await c.data({ [inId]: [5] });
    expect(out[outId]).toBe(15); // 5 (exposed input) + 10 (baked into the internal node)
    expect(c.cachedOutputs[outId]).toBe(15);

    // A second call with a different injected value recomputes fresh (no stale cache).
    const out2 = await c.data({ [inId]: [100] });
    expect(out2[outId]).toBe(110);
  });

  it("an unwired exposed input falls back to its declared default", async () => {
    const c = new CompositeNode();
    const passthrough = new CompositeOutputNode({ label: "Result" });
    const inMarker = new CompositeInputNode({ label: "A" });
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(passthrough as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", passthrough, "value");
    c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inMarker.id, default: 7 });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: passthrough.id });

    const out = await c.data({}); // nothing wired into the exposed input
    expect(out[outId]).toBe(7);
  });

  it("a hidden input port always uses its baked default, ignoring any injected value", async () => {
    const c = new CompositeNode();
    const passthrough = new CompositeOutputNode({ label: "Result" });
    const inMarker = new CompositeInputNode({ label: "K" });
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(passthrough as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", passthrough, "value");
    const inId = c.addInputPort({ label: "K", exposure: "hidden", tier: "advanced", internalNodeId: inMarker.id, default: 3 });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: passthrough.id });

    // No outer socket exists for a hidden port, so nothing could be wired to
    // it anyway — data() must still resolve to the baked default.
    const out = await c.data({ [inId]: [999] });
    expect(out[outId]).toBe(3);
  });

  it("snapshotInternal() + hydrate() round-trips the internal graph losslessly", async () => {
    const c = new CompositeNode();
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 2, b: 3 };
    const outMarker = new CompositeOutputNode({ label: "Result" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: outMarker.id });

    const snapshot = c.snapshotInternal();
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.connections).toHaveLength(1);

    // Rebuild a FRESH composite purely from the snapshot + ports, the same shape
    // persistence.ts's rebuildGraph constructs on load.
    const reloaded = new CompositeNode({
      label: c.label,
      outputPorts: c.outputPorts,
      internal: snapshot,
    });
    expect(reloaded.isHydrated).toBe(false);
    await reloaded.hydrate(ctorRegistry());
    expect(reloaded.isHydrated).toBe(true);
    expect(reloaded.internalEditor.getNodes()).toHaveLength(2);

    const out = await reloaded.data({});
    expect(out[outId]).toBe(5); // 2 + 3, recomputed from the rebuilt internal graph
  });

  it("NumberInputNode survives a snapshot/hydrate round-trip with its literal intact", async () => {
    const c = new CompositeNode();
    const num = new NumberInputNode({ value: 99 });
    const outMarker = new CompositeOutputNode({ label: "Value" });
    await c.internalEditor.addNode(num as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, num, "value", outMarker, "value");
    const outId = c.addOutputPort({ label: "Value", tier: "basic", internalNodeId: outMarker.id });

    const reloaded = new CompositeNode({ outputPorts: c.outputPorts, internal: c.snapshotInternal() });
    await reloaded.hydrate(ctorRegistry());
    const out = await reloaded.data({});
    expect(out[outId]).toBe(99);
  });

  it("hydrate() is a no-op the second time (already hydrated)", async () => {
    const c = new CompositeNode();
    await c.hydrate(ctorRegistry()); // freshly-built shell — nothing pending
    expect(c.isHydrated).toBe(true);
    expect(c.internalEditor.getNodes()).toHaveLength(0);
  });

  it("round-trips through extractInit — the EXACT path persistence.ts and paste use", async () => {
    const c = new CompositeNode({ label: "Adder" });
    const add = new ArithmeticNode({ op: "add" });
    add.literals = { a: 4, b: 6 };
    const inMarker = new CompositeInputNode({ label: "A" });
    const outMarker = new CompositeOutputNode({ label: "Result" });
    await c.internalEditor.addNode(add as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(inMarker as unknown as Schemes["Node"]);
    await c.internalEditor.addNode(outMarker as unknown as Schemes["Node"]);
    await connect(c.internalEditor, inMarker, "value", add, "a");
    await connect(c.internalEditor, add, "result", outMarker, "value");
    const inId = c.addInputPort({ label: "A", exposure: "exposed", tier: "basic", internalNodeId: inMarker.id });
    const outId = c.addOutputPort({ label: "Result", tier: "basic", internalNodeId: outMarker.id });

    // persistence.ts's serializeGraph calls extractInit(n) for a SavedNode's
    // `init`; on load it does `new Ctor({ ...sn.init })` then (for a Composite)
    // `node.hydrate(reg)`. Reproduce exactly that, with no composite-specific
    // code on either side beyond what's already in copyPaste.ts.
    const init = extractInit(c as unknown as ClassicPreset.Node);
    expect(init.label).toBe("Adder");
    expect(Array.isArray(init.inputPorts)).toBe(true);
    expect(Array.isArray(init.outputPorts)).toBe(true);
    expect(init.internal).toBeDefined();

    const reloaded = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    expect(reloaded.label).toBe("Adder");
    expect(reloaded.inputs[inId]).toBeDefined();
    expect(reloaded.outputs[outId]).toBeDefined();
    await reloaded.hydrate(ctorRegistry());

    const out = await reloaded.data({ [inId]: [1] });
    expect(out[outId]).toBe(7); // 1 (exposed input) + 6 (add's baked "b")
  });
});
