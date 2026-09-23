// [[D10]] onePrunePath, [[C77]] compositeIsSubgraph
import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes, SolenoidConnection } from "../../src/graph/schemes";
import { setEditorRefs } from "../../src/graph/process";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { DisplayNode } from "../../src/graph/nodes/display";
import { getOwningEditor } from "../../src/graph/activeGraph";
import { dropInputCables } from "../../src/graph/components/cablePrune";

describe("a node inside a closed composite", () => {
  it("resolves to the composite's internal editor, nested too, so its prune reaches its cables", async () => {
    const main = new NodeEditor<Schemes>();
    main.use(new DataflowEngine<Schemes>());
    setEditorRefs(main, new DataflowEngine<Schemes>(), {} as View);
    const outer = new CompositeNode();
    await main.addNode(outer as never);
    const inner = new CompositeNode();
    await outer.internalEditor.addNode(inner as never);
    const src = new NumberInputNode({ value: 1 });
    const sink = new DisplayNode();
    await inner.internalEditor.addNode(src);
    await inner.internalEditor.addNode(sink);
    await inner.internalEditor.addConnection(new ClassicPreset.Connection(src, "value", sink, "in") as SolenoidConnection);

    expect(getOwningEditor(sink.id)).toBe(inner.internalEditor);
    await dropInputCables(sink.id, ["in"]);
    expect(inner.internalEditor.getConnections()).toHaveLength(0);
    expect(getOwningEditor("nowhere")).toBe(main);
  });
});
