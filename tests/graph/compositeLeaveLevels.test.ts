// [[C77]] compositeIsSubgraph
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes, SolenoidConnection } from "../../src/graph/schemes";
import { CompositeNode, CompositeInputNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { reconcileLeftPorts } from "../../src/graph/compositeLogic";

describe("reconcileLeftPorts", () => {
  it("drops a port whose marker was deleted inside, with the parent's cables on it, and keeps the rest", async () => {
    const parent = new NodeEditor<Schemes>();
    const comp = new CompositeNode();
    const src = new NumberInputNode({ value: 1 });
    await parent.addNode(comp as never);
    await parent.addNode(src);
    const kept = new CompositeInputNode({ label: "Kept" });
    await comp.internalEditor.addNode(kept as never);
    const keptId = comp.addInputPort({ label: "Kept", exposure: "exposed", tier: "basic", internalNodeId: kept.id });
    const goneId = comp.addInputPort({ label: "Gone", exposure: "exposed", tier: "basic", internalNodeId: "deleted-marker" });
    await parent.addConnection(new ClassicPreset.Connection(src, "value", comp, goneId) as SolenoidConnection);
    await parent.addConnection(new ClassicPreset.Connection(src, "value", comp, keptId) as SolenoidConnection);

    expect(await reconcileLeftPorts(comp, parent)).toEqual({ cables: 1, ports: 1 });
    expect(comp.inputPorts.map((p) => p.id)).toEqual([keptId]);
    expect(parent.getConnections().map((c) => c.targetInput)).toEqual([keptId]);
  });
});
