// [[C43]] oneFlowSurface: a locked canvas is view-only, from the right-click menus too
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import type { Schemes, SolenoidNode, SolenoidConnection } from "../../src/graph/schemes";
import { socketMenuFor, cableTargetFor, nodeTargetFor } from "../../src/graph/canvasContextMenu";
import { cableSelectionStore } from "../../src/graph/cableState";
import { CompositeNode } from "../../src/graph/nodes/composite";
import { NumberInputNode } from "../../src/graph/nodes/input";
import { DisplayNode } from "../../src/graph/nodes/display";

const at = { clientX: 10, clientY: 20, target: null };

async function graph() {
  const editor = new NodeEditor<Schemes>();
  const num = new NumberInputNode({ value: 1 });
  const disp = new DisplayNode();
  const comp = new CompositeNode();
  for (const n of [num, disp, comp]) await editor.addNode(n as SolenoidNode);
  const cable = new ClassicPreset.Connection(num, "value", disp, "in") as SolenoidConnection;
  await editor.addConnection(cable);
  return { editor, num, comp, cable };
}

describe("right-click on a locked canvas", () => {
  it("offers no Attach Format Controller on a socket", async () => {
    const { editor, num } = await graph();
    const sock = { nodeId: num.id, socketKey: "value", side: "output" as const, screenX: 0, screenY: 0 };
    expect(socketMenuFor(editor, sock, false)).toBe(sock);
    expect(socketMenuFor(editor, sock, true)).toBeNull();
  });

  it("opens no cable menu and leaves the cable selection alone", async () => {
    const { editor, cable } = await graph();
    cableSelectionStore.set(null);
    expect(cableTargetFor(editor, cable.id, at, true)).toBeNull();
    expect(cableSelectionStore.ids()).toHaveLength(0);
    expect(cableTargetFor(editor, cable.id, at, false)?.connIds).toEqual([cable.id]);
  });

  it("marks the node menu view-only and offers no standoff link", async () => {
    const { editor, comp, num } = await graph();
    num.selected = true; comp.selected = true;
    expect(nodeTargetFor(editor, comp.id, at, false)?.standoff).toBeDefined();
    const t = nodeTargetFor(editor, comp.id, at, true)!;
    expect(t.viewOnly).toBe(true);
    expect(t.standoff).toBeUndefined();
  });
});
