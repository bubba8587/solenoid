// [[D16]] retypeReconciles, [[D41]] formatFlowsDownstream, [[B12]] losslessSaves
import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidConnection, SolenoidNode } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { ctorRegistry } from "../../src/graph/nodeCtorRegistry";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { dockedNodeStore } from "../../src/graph/dockedNodeStore";
import { dropInputCables } from "../../src/graph/components/cablePrune";

const fcIn = (c: CompositeNode) =>
  c.internalEditor.getNodes().find((n): n is FormatControllerNode & SolenoidNode => n instanceof FormatControllerNode)!;

/** A composite saved with a Number Input and an FC docked on its output, cabled host → FC. */
function savedComposite(hostId = "n1") {
  return new CompositeNode({
    internal: {
      nodes: [
        { id: "n1", type: "NumberInputNode", init: { value: 5 } },
        { id: "fc", type: "FormatControllerNode", init: { hostNodeId: hostId, socketKey: "value", side: "output" } },
      ],
      connections: [{ source: "n1", sourceOutput: "value", target: "fc", targetInput: "in" }],
    },
  });
}

describe("a composite's FCs settle without a drill-in", () => {
  it("hydrate docks each internal FC and types it from its host", async () => {
    const c = savedComposite();
    await c.hydrate(ctorRegistry());
    const fc = fcIn(c);
    const host = c.internalEditor.getNode(fc.hostNodeId)!;
    expect(dockedNodeStore.get(fc.id)?.hostNodeId).toBe(host.id);
    expect(fc.socketDataType).toBe((host.outputs.value!.socket as unknown as { dataType: string }).dataType);
    expect(fc.socketDataType).not.toBe("trueany");
  });

  it("an undo restore docks and types the FC again", async () => {
    const c = savedComposite();
    await c.hydrate(ctorRegistry());
    await c.restoreInternal(c.snapshotInternal(), ctorRegistry());
    const fc = fcIn(c);
    expect(dockedNodeStore.get(fc.id)?.hostNodeId).toBe(fc.hostNodeId);
    expect(fc.socketDataType).not.toBe("trueany");
  });

  it("a saved host that no longer exists loads the FC free", async () => {
    const c = savedComposite("missing");
    await c.hydrate(ctorRegistry());
    const fc = fcIn(c);
    expect(fc.hostNodeId).toBe("");
    expect(dockedNodeStore.get(fc.id)).toBeUndefined();
  });

  it("a data()-time prune in a closed composite re-types the FC", async () => {
    const main = new NodeEditor<Schemes>();
    main.use(new DataflowEngine<Schemes>());
    setEditorRefs(main, new DataflowEngine<Schemes>(), {} as View);
    const c = new CompositeNode();
    await main.addNode(c as never);
    const num = new NumberInputNode({ value: 5 });
    const fc = new FormatControllerNode({});
    await c.internalEditor.addNode(num as SolenoidNode);
    await c.internalEditor.addNode(fc as SolenoidNode);
    await c.internalEditor.addConnection(new ClassicPreset.Connection(num, "value", fc, "in") as SolenoidConnection);
    expect(fc.socketDataType).not.toBe("trueany");

    await dropInputCables(fc.id, ["in"]);
    expect(c.internalEditor.getConnections()).toHaveLength(0);
    expect(fc.socketDataType).toBe("trueany");
  });
});

describe("dockSelf", () => {
  it("leaves an FC free when its host is not in the editor", async () => {
    const editor = new NodeEditor<Schemes>();
    const fc = new FormatControllerNode({ hostNodeId: "stale", socketKey: "value", side: "output" });
    await editor.addNode(fc as SolenoidNode);
    fc.dockSelf(editor as never);
    expect(fc.hostNodeId).toBe("");
    expect(fc.socketKey).toBe("");
    expect(dockedNodeStore.get(fc.id)).toBeUndefined();
  });
});
