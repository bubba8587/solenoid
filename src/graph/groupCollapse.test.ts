import { describe, it, expect, afterEach } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { GroupNode, FormatControllerNode, DisplayNode, NumberInputNode } from "./rete-nodes";
import { recomputeGroupCollapse, groupCollapseStore, groupReadouts } from "./groupCollapse";
import { dockedNodeStore } from "./dockedNodeStore";
import type { Schemes } from "./schemes";

type Editor = NodeEditor<Schemes>;

// v1.1 A3 audit fix: a node DOCKED to a member (an FC never absorbed as a
// member itself) is a VIRTUAL member for collapse — it hides with its host.
// Before, the FC chip floated visibly over the collapsed box.

const docked: string[] = [];
afterEach(() => {
  while (docked.length) dockedNodeStore.undock(docked.pop()!);
});
function dock(fcId: string, hostId: string) {
  dockedNodeStore.dock(fcId, { hostNodeId: hostId, socketKey: "result", side: "output" });
  docked.push(fcId);
}

async function build() {
  const editor = new NodeEditor<Schemes>() as Editor;
  const host = new NumberInputNode();
  const fc = new FormatControllerNode();
  const outside = new NumberInputNode();
  await editor.addNode(host as never);
  await editor.addNode(fc as never);
  await editor.addNode(outside as never);
  const group = new GroupNode({ members: [host.id], collapsed: true });
  await editor.addNode(group as never);
  return { editor, host, fc, outside, group };
}

describe("group collapse — docked satellites are virtual members", () => {
  it("an FC docked to a member hides with its host (never absorbed as a member)", async () => {
    const { editor, host, fc, outside } = await build();
    dock(fc.id, host.id);
    recomputeGroupCollapse(editor);
    expect(groupCollapseStore.isNodeHidden(host.id)).toBe(true);
    expect(groupCollapseStore.isNodeHidden(fc.id)).toBe(true); // the fix
    expect(groupCollapseStore.isNodeHidden(outside.id)).toBe(false);
  });

  it("an undocked FC outside the group stays visible", async () => {
    const { editor, fc } = await build();
    recomputeGroupCollapse(editor);
    expect(groupCollapseStore.isNodeHidden(fc.id)).toBe(false);
  });

  it("a docked FC to a NON-member host is untouched", async () => {
    const { editor, fc, outside } = await build();
    dock(fc.id, outside.id);
    recomputeGroupCollapse(editor);
    expect(groupCollapseStore.isNodeHidden(fc.id)).toBe(false);
  });

  it("the Display→FC hop resolves through an UNABSORBED docked FC (readouts)", async () => {
    const editor = new NodeEditor<Schemes>() as Editor;
    const disp = new DisplayNode();
    const fc = new FormatControllerNode();
    await editor.addNode(disp as never);
    await editor.addNode(fc as never);
    await editor.addConnection(new ClassicPreset.Connection(disp as never, "out", fc as never, "in") as never);
    dock(fc.id, disp.id);
    const group = new GroupNode({ members: [disp.id], collapsed: true });
    await editor.addNode(group as never);
    // The FC is a virtual member, so the hop is followed: the readout exposes
    // the FC's out (the formatted end), with the Display as the visible row.
    const rows = groupReadouts(editor, group);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayId).toBe(disp.id);
    expect(rows[0].effNodeId).toBe(fc.id);
  });
});
