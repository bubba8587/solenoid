import { describe, it, expect } from "vitest";
import { moveGroupMembers, reconcileGroupMembership, absorbIntoContainingGroup } from "./groupLogic";
import { GroupNode } from "./rete-nodes";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";

// Regression: dragging a group whose members are ALSO selected moved the members
// twice (once by rete's selector, once by moveGroupMembers) — they "outran" the
// group. The drag/drop callers pass skipSelected=true so a selected member, already
// carried by the selector, isn't moved again; a programmatic push leaves it off.

type Editor = NodeEditor<Schemes>;
type Area = AreaPlugin<Schemes, AreaExtra>;

function harness(selected: Set<string>) {
  const start: Record<string, { x: number; y: number }> = {
    a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, c: { x: 200, y: 0 },
  };
  const final = new Map<string, { x: number; y: number }>();
  const nodeViews = new Map<string, { position: { x: number; y: number } }>();
  for (const [id, p] of Object.entries(start)) { nodeViews.set(id, { position: { ...p } }); final.set(id, { ...p }); }
  const translated: string[] = [];
  const editor = { getNode: (id: string) => ({ selected: selected.has(id) }) } as unknown as Editor;
  const area = {
    nodeViews,
    translate: (id: string, pos: { x: number; y: number }) => { translated.push(id); final.set(id, pos); return Promise.resolve(true); },
  } as unknown as Area;
  const group = { members: ["a", "b", "c"] } as unknown as GroupNode;
  return { editor, area, group, translated, final };
}

describe("moveGroupMembers — skipSelected guards the double-move", () => {
  it("moves every member when skipSelected is off (a programmatic push)", () => {
    const h = harness(new Set());
    moveGroupMembers(h.editor, h.area, h.group, 10, 5);
    expect([...h.translated].sort()).toEqual(["a", "b", "c"]);
    expect(h.final.get("b")).toEqual({ x: 110, y: 5 });
  });

  it("skips a SELECTED member when skipSelected is on (the selector already moved it)", () => {
    const h = harness(new Set(["b"]));
    moveGroupMembers(h.editor, h.area, h.group, 10, 5, true);
    expect([...h.translated].sort()).toEqual(["a", "c"]);      // b not moved again
    expect(h.final.get("b")).toEqual({ x: 100, y: 0 });        // untouched
    expect(h.final.get("a")).toEqual({ x: 10, y: 5 });
  });

  it("still moves UNSELECTED members with skipSelected on", () => {
    const h = harness(new Set(["a", "b", "c"])); // whole group + members selected
    moveGroupMembers(h.editor, h.area, h.group, 10, 5, true);
    expect(h.translated).toEqual([]);                          // all carried by the selector
  });

  it("no-op on a zero delta", () => {
    const h = harness(new Set());
    moveGroupMembers(h.editor, h.area, h.group, 0, 0, true);
    expect(h.translated).toEqual([]);
  });
});

// Regression: a COLLAPSED group renders as a small card, its members hidden. A node
// dragged/created over that card must NOT be absorbed — it would be hidden by the
// next syncGroupCollapse and visibly vanish ("incorrect membership" near collapsed
// groups). Membership edits require the group expanded.
describe("collapsed groups never absorb members", () => {
  // Geometry: collapsed A renders 160×40 at (0,0); expanded B is 400×300 at (600,0).
  // The loose node is 180×80.
  function harness2() {
    const groupA = new GroupNode({ label: "Group", collapsed: true,  width: 320, height: 220 });
    const groupB = new GroupNode({ label: "Group", collapsed: false, width: 400, height: 300 });
    const loose = { id: "n1" };
    const ids = new Map<string, unknown>([[groupA.id, groupA], [groupB.id, groupB], ["n1", loose]]);
    const nodeViews = new Map<string, { position: { x: number; y: number }; element: { offsetWidth: number; offsetHeight: number } }>([
      [groupA.id, { position: { x: 0, y: 0 },   element: { offsetWidth: 160, offsetHeight: 40 } }],
      [groupB.id, { position: { x: 600, y: 0 }, element: { offsetWidth: 400, offsetHeight: 300 } }],
      ["n1",      { position: { x: 0, y: 0 },   element: { offsetWidth: 180, offsetHeight: 80 } }],
    ]);
    const editor = {
      getNode: (id: string) => ids.get(id),
      getNodes: () => [...ids.values()],
    } as unknown as Editor;
    const area = { nodeViews } as unknown as Area;
    const setLoosePos = (x: number, y: number) => { nodeViews.get("n1")!.position = { x, y }; };
    return { groupA, groupB, editor, area, setLoosePos };
  }

  it("drag-drop onto a collapsed group's card does not join it", () => {
    const h = harness2();
    h.setLoosePos(-10, -10); // node center (80, 30) — inside A's 160×40 card
    reconcileGroupMembership(h.editor, h.area, "n1");
    expect(h.groupA.members).toEqual([]);
  });

  it("drag-drop into an expanded group still joins (guard doesn't overblock)", () => {
    const h = harness2();
    h.setLoosePos(650, 50); // center (740, 90) — inside B's 400×300 box
    reconcileGroupMembership(h.editor, h.area, "n1");
    expect(h.groupB.members).toEqual(["n1"]);
  });

  it("a new node fully over a collapsed card is not absorbed; over an expanded box it is", () => {
    const h = harness2();
    // A tiny node fully inside A's card bounds.
    h.area.nodeViews.get("n1")!.element = { offsetWidth: 40, offsetHeight: 20 } as unknown as HTMLElement;
    h.setLoosePos(10, 10);
    expect(absorbIntoContainingGroup(h.editor, h.area, "n1")).toBe(false);
    expect(h.groupA.members).toEqual([]);
    // Same node fully inside B's expanded box → absorbed.
    h.setLoosePos(650, 50);
    expect(absorbIntoContainingGroup(h.editor, h.area, "n1")).toBe(true);
    expect(h.groupB.members).toEqual(["n1"]);
  });
});
