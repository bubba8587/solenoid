// [[A1]], [[B3]], [[react-flow-surface-contract#The flow model]], [[react-flow-surface-contract#Groups are sub-flows]], [[react-flow-surface-contract#Isolate]]
import { describe, it, expect } from "vitest";
import { buildModel, toFlowNodes, toFlowEdges, toFlowPosition, fromFlowPosition, nodeClassName } from "../../../src/graph/flow/flowModel";
import { isolateStore } from "../../../src/graph/isolateStore";
import { DisplayNode } from "../../../src/graph/nodeClasses";
import { SEEDS as FLOW_SEEDS, DEFAULT_SEED_ID } from "../../../src/graph/seeds";

describe("flow model (React Flow port C0)", () => {
  it("projects RF nodes/edges with positions and handle ids", async () => {
    const g = FLOW_SEEDS[DEFAULT_SEED_ID].graph;
    const m = await buildModel(g);
    const nodes = toFlowNodes(m);
    const edges = toFlowEdges(m);

    expect(nodes.length).toBe(g.nodes.length);
    for (const n of nodes) {
      expect(n.type).toBe("sol");
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
      expect(n.data.node).toBeDefined();
    }

    expect(edges.length).toBe(g.connections.length);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) {
      const src = byId.get(e.source);
      const tgt = byId.get(e.target);
      // Handle ids are the socket keys — they must exist on the live node.
      const srcNode = src!.data.node as unknown as { outputs: Record<string, unknown> };
      const tgtNode = tgt!.data.node as unknown as { inputs: Record<string, unknown> };
      expect(srcNode.outputs[e.sourceHandle], `output ${e.sourceHandle}`).toBeDefined();
      expect(tgtNode.inputs[e.targetHandle], `input ${e.targetHandle}`).toBeDefined();
    }
  });
});

describe("group members as RF children", () => {
  // Live nodes mint their own ids; the loader remaps a group's saved member ids the
  // same way (persistence.ts idMap).
  async function groupedModel() {
    const seed = FLOW_SEEDS[DEFAULT_SEED_ID].graph;
    const leaf = seed.nodes.find((n) => n.type !== "GroupNode")!;
    const m = await buildModel({
      v: seed.v,
      nodes: [
        { ...leaf, id: "m1", x: 150, y: 180 },
        { id: "g", type: "GroupNode", x: 100, y: 100, init: { members: ["m1"], width: 300, height: 200 } },
      ],
      connections: [],
    });
    const group = m.editor.getNodes().find((n) => n.constructor.name === "GroupNode") as unknown as { id: string; members: string[] };
    const member = m.editor.getNodes().find((n) => n.constructor.name !== "GroupNode")!;
    group.members = [member.id];
    return { m, g: group.id, m1: member.id };
  }

  it("projects a member relative to its group, group first", async () => {
    const { m, g, m1 } = await groupedModel();
    const nodes = toFlowNodes(m);
    expect(nodes.map((n) => n.id)).toEqual([g, m1]);
    expect(nodes[1].parentId).toBe(g);
    expect(nodes[1].position).toEqual({ x: 50, y: 80 });
    expect(nodes[0].parentId).toBeUndefined();
    expect(nodes[0].position).toEqual({ x: 100, y: 100 });
  });

  it("converts both ways at the boundary", async () => {
    const { m, g, m1 } = await groupedModel();
    expect(toFlowPosition(m, m1, { x: 160, y: 190 })).toEqual({ x: 60, y: 90 });
    expect(toFlowPosition(m, g, { x: 160, y: 190 })).toEqual({ x: 160, y: 190 });
    expect(fromFlowPosition(m, { x: 60, y: 90 }, g)).toEqual({ x: 160, y: 190 });
    expect(fromFlowPosition(m, { x: 60, y: 90 }, undefined)).toEqual({ x: 60, y: 90 });
  });
});

describe("isolate dims through RF's className", () => {
  it("a receded card carries sol-isolate-dim, so a className rebuild cannot drop it", () => {
    const kept = new DisplayNode();
    const receded = new DisplayNode();
    isolateStore.set([kept.id]);
    try {
      expect(nodeClassName(receded as never)).toContain("sol-isolate-dim");
      expect(nodeClassName(kept as never) ?? "").not.toContain("sol-isolate-dim");
    } finally {
      isolateStore.exit();
    }
    expect(nodeClassName(receded as never) ?? "").not.toContain("sol-isolate-dim");
  });
});
