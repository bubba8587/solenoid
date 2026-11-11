// [[C112]] noOverlapsEver, [[group-expand-push#LayoutFx]]
import type { View } from "../../src/graph/view";
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import type { Schemes, SolenoidNode } from "../../src/graph/schemes";
import { DisplayNode } from "../../src/graph/nodes/display";
import { GroupNode } from "../../src/graph/nodes/group";
import { settleMemberOverlaps } from "../../src/graph/groupLogic";

/** A group at the origin holding two 100 × 60 cards at the given spots. */
async function scene(a: { x: number; y: number }, b: { x: number; y: number }, box = { width: 300, height: 200 }) {
  const editor = new GraphEditor<Schemes>();
  const first: SolenoidNode = new DisplayNode();
  const second: SolenoidNode = new DisplayNode();
  const group = new GroupNode({ members: [first.id, second.id], ...box }) as GroupNode & SolenoidNode;
  for (const n of [group, first, second]) await editor.addNode(n);
  group.position = { x: 0, y: 0 };
  first.position = a;
  second.position = b;
  const view = {
    position: (id: string) => editor.getNode(id)?.position,
    measured: (id: string) => (id === group.id ? undefined : { w: 100, h: 60 }),
    nodeElement: () => null,
    moveNode: async (id: string, p: { x: number; y: number }) => { const n = editor.getNode(id); if (n) n.position = { ...p }; },
    rerenderNode: async () => {},
  } as unknown as View;
  return { editor, view, group, first, second };
}

const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + 100 && b.x < a.x + 100 && a.y < b.y + 60 && b.y < a.y + 60;

describe("the No-Overlap Pass inside a group", () => {
  it("pulls two stacked members apart, the placed one holding still", async () => {
    const { editor, view, first, second } = await scene({ x: 40, y: 60 }, { x: 40, y: 70 });
    await settleMemberOverlaps(editor, view, new Set([first.id]));
    expect(first.position).toEqual({ x: 40, y: 60 });
    expect(overlap(first.position!, second.position!)).toBe(false);
  });

  it("grows the box over a member pushed past its edge, and keeps the edges nothing passed", async () => {
    const { editor, view, group, first, second } = await scene({ x: 40, y: 120 }, { x: 40, y: 130 });
    await settleMemberOverlaps(editor, view, new Set([first.id, second.id]));
    expect(overlap(first.position!, second.position!)).toBe(false);
    const bottom = Math.max(first.position!.y, second.position!.y) + 60;
    expect(group.position!.y + group.height).toBeGreaterThanOrEqual(bottom);
    expect(group.width).toBe(300);
    expect(group.position!.x).toBe(0);
  });

  it("leaves a group alone when none of its members was placed, or nothing overlaps", async () => {
    const stacked = await scene({ x: 40, y: 60 }, { x: 40, y: 70 });
    await settleMemberOverlaps(stacked.editor, stacked.view, new Set(["someone-else"]));
    expect(stacked.second.position).toEqual({ x: 40, y: 70 });
    const apart = await scene({ x: 20, y: 60 }, { x: 160, y: 60 });
    await settleMemberOverlaps(apart.editor, apart.view, new Set([apart.first.id]));
    expect([apart.group.width, apart.group.height]).toEqual([300, 200]);
  });
});
