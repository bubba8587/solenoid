import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import type { AreaPlugin } from "rete-area-plugin";
import { autofitGroupBox, GROUP_PAD, GROUP_HEADER } from "./groupLogic";
import { ArithmeticNode } from "./nodes/scalar";
import { DisplayNode } from "./nodes/display";
import { FormatControllerNode } from "./nodes/formatController";
import { GroupNode } from "./nodes/group";

// autofitGroupBox must WRAP only the real members, never a docked FC — the FC is a
// host-riding adornment (placed in screen space, so its edge depends on the host's
// screen spot and drifts with the group's own position; wrapping it crept the box
// down/right on repeat Tidies). Here a docked FC sits well BELOW the real members;
// the fitted box must stop at the real members' extent, ignoring it.

interface FakeView {
  position: { x: number; y: number };
  element: { offsetWidth: number; offsetHeight: number };
}

function makeArea() {
  const nodeViews = new Map<string, FakeView>();
  const add = (id: string, x: number, y: number, w: number, h: number) =>
    nodeViews.set(id, { position: { x, y }, element: { offsetWidth: w, offsetHeight: h } });
  const area = {
    nodeViews,
    async translate(id: string, pos: { x: number; y: number }) {
      const v = nodeViews.get(id); if (v) v.position = { ...pos };
    },
    async update() {},
    area: { transform: { k: 1, x: 0, y: 0 } },
  };
  return { area: area as unknown as AreaPlugin<Schemes, AreaExtra>, add };
}

describe("autofitGroupBox ignores docked FCs", () => {
  it("wraps the real members, not a docked FC sitting below them", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area, add } = makeArea();

    const num = new ArithmeticNode({ op: "add" });
    const disp = new DisplayNode();
    for (const n of [num, disp]) await editor.addNode(n as never);
    await editor.addConnection(new ClassicPreset.Connection(num, "result", disp, "in") as Schemes["Connection"]);
    const fc = new FormatControllerNode({ hostNodeId: disp.id, socketKey: "out", side: "output" });
    await editor.addNode(fc as never);
    fc.dockSelf(editor as never); // registers in dockedNodeStore

    const group = new GroupNode({ members: [num.id, disp.id, fc.id], width: 400, height: 300 });
    await editor.addNode(group as never);

    // Real members span y 200..280 (80 tall). The docked FC hangs far below (y 400).
    add(num.id, 100, 200, 180, 80);
    add(disp.id, 320, 200, 180, 80);
    add(fc.id, 508, 400, 116, 64); // lowest + rightmost edge if it were counted
    add(group.id, 76, 142, 400, 300);

    const res = await autofitGroupBox(editor, area, group);
    expect(res).not.toBeNull();

    // Box wraps the real members (bottom = 280) + pad, NOT the FC's bottom (464).
    const realBottom = 280;
    expect(group.height).toBe(Math.round((realBottom - 200) + GROUP_PAD * 2 + GROUP_HEADER));
    // Top edge sits a header+pad above the real members' top (200).
    expect(area.nodeViews.get(group.id)!.position.y).toBe(200 - GROUP_PAD - GROUP_HEADER);
    // Width wraps num.x..disp.right (100..500), not the FC's right edge (624).
    expect(group.width).toBe(Math.round((500 - 100) + GROUP_PAD * 2));
  });
});
