// [[C112]] noOverlapsEver
import type { View } from "../../src/graph/view";
import { describe, it, expect, afterEach } from "vitest";
import { NodeEditor } from "rete";
import type { Schemes, SolenoidNode } from "../../src/graph/schemes";
import { DisplayNode } from "../../src/graph/nodes/display";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { GroupNode } from "../../src/graph/nodes/group";
import { dockedNodeStore } from "../../src/graph/dockedNodeStore";
import { settleOverlaps } from "../../src/graph/groupPush";

afterEach(() => dockedNodeStore.clear());

async function scene(side: "input" | "output") {
  const editor = new NodeEditor<Schemes>();
  const host: SolenoidNode = new DisplayNode();
  const fc: SolenoidNode = new FormatControllerNode();
  const neighbor: SolenoidNode = new DisplayNode();
  for (const n of [host, fc, neighbor]) await editor.addNode(n);
  const size = new Map([[host.id, { w: 100, h: 60 }], [fc.id, { w: 116, h: 60 }], [neighbor.id, { w: 100, h: 60 }]]);
  // The neighbor clears the host by 40 but sits under the FC on the host's docked side.
  host.position = { x: 300, y: 0 };
  fc.position = side === "input" ? { x: 184, y: 0 } : { x: 400, y: 0 };
  neighbor.position = side === "input" ? { x: 160, y: 0 } : { x: 440, y: 0 };
  dockedNodeStore.dock(fc.id, { hostNodeId: host.id, socketKey: side === "input" ? "in" : "out", side });
  const view = {
    position: (id: string) => editor.getNode(id)?.position,
    measured: (id: string) => size.get(id),
    nodeElement: () => null,
    moveNode: async (id: string, p: { x: number; y: number }) => { const n = editor.getNode(id); if (n) n.position = { ...p }; },
  } as unknown as View;
  return { editor, view, host, fc, neighbor };
}

const overlapX = (a: { x: number }, aw: number, b: { x: number }, bw: number) => a.x < b.x + bw && b.x < a.x + aw;

describe("the push world counts a docked FC on either side", () => {
  for (const side of ["input", "output"] as const) {
    it(`separates a neighbor from a host's ${side}-side FC`, async () => {
      const { editor, view, fc, neighbor } = await scene(side);
      settleOverlaps(editor, view);
      const sameRow = Math.abs(fc.position!.y - neighbor.position!.y) < 60;
      expect(sameRow && overlapX(fc.position!, 116, neighbor.position!, 100)).toBe(false);
    });
  }
});

describe("an open group's box reaches over a member's docked FC", () => {
  it("separates a neighbor from an FC that hangs past the group's edge", async () => {
    const editor = new NodeEditor<Schemes>();
    const host: SolenoidNode = new DisplayNode();
    const fc: SolenoidNode = new FormatControllerNode();
    const neighbor: SolenoidNode = new DisplayNode();
    for (const n of [host, fc, neighbor]) await editor.addNode(n);
    const group = new GroupNode({ members: [host.id], width: 200, height: 120 }) as unknown as SolenoidNode;
    await editor.addNode(group);
    const size = new Map([[host.id, { w: 100, h: 60 }], [fc.id, { w: 116, h: 60 }], [neighbor.id, { w: 100, h: 60 }]]);
    // The member sits at the group's left pad; its input FC hangs 92 past the group's left edge, over the neighbor.
    group.position = { x: 300, y: 0 };
    host.position = { x: 324, y: 34 };
    fc.position = { x: 208, y: 34 };
    neighbor.position = { x: 150, y: 34 };
    dockedNodeStore.dock(fc.id, { hostNodeId: host.id, socketKey: "in", side: "input" });
    const view = {
      position: (id: string) => editor.getNode(id)?.position,
      measured: (id: string) => size.get(id),
      nodeElement: () => null,
      moveNode: async (id: string, p: { x: number; y: number }) => { const n = editor.getNode(id); if (n) n.position = { ...p }; },
    } as unknown as View;

    settleOverlaps(editor, view);
    const sameRow = Math.abs(fc.position!.y - neighbor.position!.y) < 60;
    expect(sameRow && overlapX(fc.position!, 116, neighbor.position!, 100)).toBe(false);
  });
});
