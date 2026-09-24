// [[B12]] losslessSaves, [[C77]] compositeIsSubgraph
import { describe, it, expect } from "vitest";
import { CompositeNode, type CompositeSavedNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { extractInit } from "../../src/graph/copyPaste";
import { nodeSizeStore } from "../../src/graph/nodeSizeStore";
import { collapseStore } from "../../src/graph/collapseStore";
import { socketFlipStore } from "../../src/graph/socketFlipStore";
import type { SavedNode } from "../../src/graph/persistence";

// Every field the main save keeps per node, bar the ones a composite holds elsewhere or not yet.
type Keys<T> = { [K in keyof T]-?: K }[keyof T];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const fieldsMatch: Same<Exclude<Keys<SavedNode>, "name">, Keys<CompositeSavedNode>> = true;

async function reload(init: Record<string, unknown>): Promise<CompositeNode> {
  const c = new CompositeNode(structuredClone(init) as ConstructorParameters<typeof CompositeNode>[0]);
  await c.hydrate(ctorRegistry());
  return c;
}

describe("an inner card keeps its size, collapse and flip", () => {
  it("the composite snapshot carries the main save's per-node fields", () => {
    expect(fieldsMatch).toBe(true);
  });

  it("through a save and load, and through a drill-in undo restore", async () => {
    const c = await reload({});
    const a = new NumberInputNode({});
    await c.internalEditor.addNode(a as never);
    nodeSizeStore.set(a.id, { w: 312.4, h: 180 });
    collapseStore.set(a.id, true);
    socketFlipStore.set(a.id, true);

    const saved = extractInit(c) as { internal: { nodes: CompositeSavedNode[] } };
    expect(saved.internal.nodes[0]).toMatchObject({ size: { w: 312, h: 180 }, collapsed: true, flipped: true });

    const c2 = await reload(saved);
    const a2 = c2.internalEditor.getNodes()[0];
    expect(a2.id).not.toBe(a.id);
    expect(nodeSizeStore.get(a2.id)).toEqual({ w: 312, h: 180 });
    expect(collapseStore.get(a2.id)).toBe(true);
    expect(socketFlipStore.get(a2.id)).toBe(true);

    await c2.restoreInternal(c2.snapshotInternal(), ctorRegistry());
    const a3 = c2.internalEditor.getNodes()[0];
    expect(a3.id).not.toBe(a2.id);
    expect(collapseStore.get(a3.id)).toBe(true);
    expect(socketFlipStore.get(a3.id)).toBe(true);
    expect(extractInit(c2)).toEqual(extractInit(await reload(extractInit(c2))));
  });
});
