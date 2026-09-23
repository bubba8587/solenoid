// [[B12]] losslessSaves, [[C35]] unknownViaPlaceholder
import { describe, it, expect } from "vitest";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { GroupNode } from "../../src/graph/nodes/group";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { PlaceholderNode } from "../../src/graph/nodes/placeholder";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { extractInit } from "../../src/graph/copyPaste";
import { remapNodeRefs } from "../../src/graph/persistenceCore";

type Snap = { internal: { nodes: Array<{ id: string; type: string; init: Record<string, unknown> }> } };

async function reload(init: Record<string, unknown>): Promise<CompositeNode> {
  const c = new CompositeNode(structuredClone(init) as ConstructorParameters<typeof CompositeNode>[0]);
  await c.hydrate(ctorRegistry());
  return c;
}

describe("node references inside a Composite survive save and load", () => {
  it("a Group's members and a Format Controller's host resolve to the live internal nodes after a load", async () => {
    const c = await reload({});
    const a = new NumberInputNode({});
    const g = new GroupNode({ members: [a.id] });
    const fc = new FormatControllerNode({ hostNodeId: a.id });
    for (const n of [a, g, fc]) await c.internalEditor.addNode(n as never);
    const first = extractInit(c);

    const c2 = await reload(first);
    const nodes = c2.internalEditor.getNodes();
    const a2 = nodes.find((n) => n instanceof NumberInputNode)!;
    expect((nodes.find((n) => n instanceof GroupNode) as GroupNode).members).toEqual([a2.id]);
    expect((nodes.find((n) => n instanceof FormatControllerNode) as FormatControllerNode).hostNodeId).toBe(a2.id);

    expect(extractInit(c2)).toEqual(first);
    expect(extractInit(await reload(extractInit(c2)))).toEqual(first);
  });

  it("a Placeholder inside keeps its references in saved ids, and the load leaves the source untouched", async () => {
    const init = {
      internal: {
        nodes: [
          { id: "n1", type: "NumberInputNode", init: {} },
          { id: "p1", type: "NoSuchPackNode", init: { members: ["n1"], steps: [{ title: "s", nodeIds: ["n1"] }] } },
        ],
        connections: [],
      },
    };
    const before = structuredClone(init);
    const c = new CompositeNode(init as ConstructorParameters<typeof CompositeNode>[0]);
    await c.hydrate(ctorRegistry());
    expect(init).toEqual(before);
    const ph = c.internalEditor.getNodes().find((n) => n instanceof PlaceholderNode) as PlaceholderNode;
    const live = c.internalEditor.getNodes().find((n) => n instanceof NumberInputNode)!;
    expect(ph.savedInit.members).toEqual([live.id]);
    const saved = (extractInit(c) as unknown as Snap).internal.nodes.find((n) => n.id === "p1")!;
    expect(saved.init).toEqual(before.internal.nodes[1].init);
  });

  it("remapNodeRefs never writes through to the step objects it was given", () => {
    const step = { title: "s", nodeIds: ["old"] };
    const target = { steps: [step] };
    remapNodeRefs(target, new Map([["old", "new"]]), () => true);
    expect(target.steps[0].nodeIds).toEqual(["new"]);
    expect(step.nodeIds).toEqual(["old"]);
  });
});
