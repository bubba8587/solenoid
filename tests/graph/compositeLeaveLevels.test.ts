// [[C77]] compositeIsSubgraph, [[composite-nodes#Edits inside and how they reach the outside]], [[composite-drill-in-mount-lifecycle#Leaving a level]]
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection } from "../../src/graph/graphModel";
import type { Schemes, SolenoidConnection } from "../../src/graph/schemes";
import { CompositeNode, CompositeInputNode, CompositeOutputNode } from "../../src/graph/nodes/composite";
import { ValueInputNode } from "../../src/graph/nodes/control";
import { reconcileLeftPorts, adoptMarkerPorts } from "../../src/graph/compositeLogic";

describe("reconcileLeftPorts", () => {
  it("drops a port whose marker was deleted inside, with the parent's cables on it, and keeps the rest", async () => {
    const parent = new GraphEditor<Schemes>();
    const comp = new CompositeNode();
    const src = new ValueInputNode({ value: "1" });
    await parent.addNode(comp as never);
    await parent.addNode(src);
    const kept = new CompositeInputNode({ label: "Kept" });
    await comp.internalEditor.addNode(kept as never);
    const keptId = comp.addInputPort({ label: "Kept", exposure: "exposed", tier: "basic", internalNodeId: kept.id });
    const goneId = comp.addInputPort({ label: "Gone", exposure: "exposed", tier: "basic", internalNodeId: "deleted-marker" });
    await parent.addConnection(new GraphConnection(src, "value", comp, goneId) as SolenoidConnection);
    await parent.addConnection(new GraphConnection(src, "value", comp, keptId) as SolenoidConnection);

    expect(await reconcileLeftPorts(comp, parent)).toEqual({ cables: 1, ports: 1 });
    expect(comp.inputPorts.map((p) => p.id)).toEqual([keptId]);
    expect(parent.getConnections().map((c) => c.targetInput)).toEqual([keptId]);
  });

  it("gives a port to a marker that has none, as an undo or redo inside can leave one", async () => {
    const parent = new GraphEditor<Schemes>();
    const comp = new CompositeNode();
    await parent.addNode(comp as never);
    const back = new CompositeInputNode({ label: "Rate" });
    const out = new CompositeOutputNode({ label: "Total" });
    await comp.internalEditor.addNode(back as never);
    await comp.internalEditor.addNode(out as never);
    expect(adoptMarkerPorts(comp)).toBe(2);
    expect(comp.inputPorts.map((p) => [p.label, p.internalNodeId])).toEqual([["Rate", back.id]]);
    expect(comp.outputPorts.map((p) => [p.label, p.internalNodeId])).toEqual([["Total", out.id]]);
    expect(Object.keys(comp.inputs)).toHaveLength(1);
    // Nothing more to adopt, and leaving keeps both.
    expect(adoptMarkerPorts(comp)).toBe(0);
    expect(await reconcileLeftPorts(comp, parent)).toEqual({ cables: 0, ports: 0 });
    expect(comp.inputPorts).toHaveLength(1);
  });
});
