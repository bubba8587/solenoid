import { describe, it, expect } from "vitest";
import { moveGroupMembers } from "./groupLogic";
import type { GroupNode } from "./rete-nodes";
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
