// [[C85]] groupPushDeterministic, [[C112]] noOverlapsEver, [[D63]] lockedGroupIsObstacle
import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeEditor } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { GroupNode } from "../../src/graph/nodes/group";
import { DisplayNode } from "../../src/graph/nodes/display";
import { setGroupsCollapsed } from "../../src/graph/groupPush";
import { autofitGroupWithHistory, createGroupFromSelection, GROUP_PAD, GROUP_HEADER } from "../../src/graph/groupLogic";

// ─── Expand-push record staleness across a Tidy ─────────────────────────────────
// The reported "Tidy/Cleanup around expanded groups misplaces nodes" sequence:
//
//   1. Expand group A → its push moves neighbor N aside; a restore record is
//      written (preX = where N stood BEFORE the push, expX = where the push
//      left it).
//   2. A layout pass (Tidy / Cleanup / align) moves N somewhere new. The record
//      survives, silently pointing at a PRE-TIDY coordinate.
//   3. Expand group B → its push shoves N again. The merge path used to keep
//      the ancient preX/preY while refreshing expX/expY — re-arming the record.
//   4. Collapse A and B → the restore slides N back to the STEP-1 coordinate,
//      a spot that only made sense in the pre-Tidy arrangement. Misplaced.
//
// The restore path already guards against this ("only if the node is still
// where our push left it"); the MERGE path must apply the same staleness test:
// a record whose node moved since our last push is void — start fresh from the
// node's CURRENT position.

type Pos = { x: number; y: number };

function makeFakeView(lateSize?: (id: string) => { w: number; h: number }) {
  const nodeViews = new Map<string, {
    position: Pos;
    element: { offsetWidth: number; offsetHeight: number; style: Record<string, string> };
  }>();
  const sizes = new Map<string, () => { w: number; h: number }>();
  const addView = (id: string, x: number, y: number, sizeFn: () => { w: number; h: number }) => {
    sizes.set(id, sizeFn);
    const view = {
      position: { x, y },
      element: {
        get offsetWidth() { return sizes.get(id)!().w; },
        get offsetHeight() { return sizes.get(id)!().h; },
        style: {} as Record<string, string>,
      },
    };
    nodeViews.set(id, view);
    return view;
  };
  const view = {
    hasNode: (id: string) => nodeViews.has(id),
    position: (id: string) => nodeViews.get(id)?.position,
    nodeElement: (id: string) => (nodeViews.get(id)?.element ?? null) as unknown as HTMLElement | null,
    connectionElement: () => null,
    async moveNode(id: string, pos: Pos) {
      const v = nodeViews.get(id);
      if (v) v.position = { ...pos };
      else if (lateSize) addView(id, pos.x, pos.y, () => lateSize(id));
    },
    async rerenderCables() {},
    async rerenderNode() {},
    transform: { k: 1, x: 0, y: 0 },
  };
  return { view: view as unknown as View, addView };
}

let rafQueue: FrameRequestCallback[] = [];
async function flushRafs() {
  for (let i = 0; i < 5 && rafQueue.length; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(performance.now());
    await new Promise((r) => setTimeout(r, 0));
  }
}
beforeEach(() => {
  rafQueue = [];
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    ((cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; }) as never;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (() => {}) as never;
});
afterEach(() => {
  delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
});

const COLLAPSED_CARD = { w: 264, h: 60 };

function groupView(g: GroupNode) {
  return () => (g.collapsed ? COLLAPSED_CARD : { w: g.width, h: g.height });
}

describe("expand-push records survive a Tidy only with a fresh restore target", () => {
  it("a second push after a programmatic move does NOT re-arm the pre-move restore", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();

    // Two collapsed groups and a loose, unwired neighbor.
    const gA = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const gB = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const n = new DisplayNode();
    (n as never as { width: number; height: number }).width = 180;
    (n as never as { width: number; height: number }).height = 80;
    for (const node of [gA, gB, n]) await editor.addNode(node as never);

    addView(gA.id, 100, 100, groupView(gA));
    addView(gB.id, 1000, 80, groupView(gB));
    // N sits where A's EXPANDED footprint will land (right of the collapsed card).
    const nView = addView(n.id, 420, 140, () => ({ w: 180, h: 80 }));

    // 1. Expand A — N is pushed clear of the expanded box.
    await setGroupsCollapsed(editor, view, [gA], false);
    await flushRafs();
    const pushedX = nView.position.x;
    expect(pushedX).toBeGreaterThan(420); // the push actually happened

    // 2. A Tidy-style programmatic move relocates N (the applier does exactly
    //    this: view.translate with no drag events, so no record invalidation).
    await view.moveNode(n.id, { x: 1200, y: 140 });

    // 3. Expand B — its footprint (1000..1600 × 80..380) covers N's new spot,
    //    so N is pushed again. This merge must treat the old record as stale.
    await setGroupsCollapsed(editor, view, [gB], false);
    await flushRafs();
    expect(nView.position.x).toBeGreaterThan(1200); // pushed again

    // 4. Collapse both. The restore must return N to where it stood BEFORE
    //    B's push (its post-Tidy spot, x=1200) — NOT to the pre-Tidy x=420.
    await setGroupsCollapsed(editor, view, [gA, gB], true);
    await flushRafs();
    expect(nView.position.x).toBe(1200);
  });

  it("the classic single-group cycle still restores exactly", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const g = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const n = new DisplayNode();
    (n as never as { width: number; height: number }).width = 180;
    (n as never as { width: number; height: number }).height = 80;
    for (const node of [g, n]) await editor.addNode(node as never);
    addView(g.id, 100, 100, groupView(g));
    const nView = addView(n.id, 420, 140, () => ({ w: 180, h: 80 }));

    await setGroupsCollapsed(editor, view, [g], false);
    await flushRafs();
    expect(nView.position.x).toBeGreaterThan(420);
    await setGroupsCollapsed(editor, view, [g], true);
    await flushRafs();
    expect(nView.position.x).toBe(420);
    expect(nView.position.y).toBe(140);
  });
});

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
const boxAt = (v: { position: Pos; element: { offsetWidth: number; offsetHeight: number } }): Box =>
  ({ ...v.position, w: v.element.offsetWidth, h: v.element.offsetHeight });

function expectNoOverlaps(views: Record<string, { position: Pos; element: { offsetWidth: number; offsetHeight: number } }>) {
  const entries = Object.entries(views);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      expect(overlaps(boxAt(entries[i][1]), boxAt(entries[j][1])), `${entries[i][0]} overlaps ${entries[j][0]}`).toBe(false);
    }
  }
}

describe("no layout op leaves an overlap", () => {
  it("expand separates an overlap the user made, even far from the group", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const g = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const a = new DisplayNode();
    const b = new DisplayNode();
    for (const node of [g, a, b]) await editor.addNode(node as never);
    const gView = addView(g.id, 100, 100, groupView(g));
    const aView = addView(a.id, 3000, 3000, () => ({ w: 180, h: 80 }));
    const bView = addView(b.id, 3040, 3020, () => ({ w: 180, h: 80 }));

    await setGroupsCollapsed(editor, view, [g], false);
    await flushRafs();
    expect(aView.position).toEqual({ x: 3000, y: 3000 });
    expectNoOverlaps({ g: gView, a: aView, b: bView });
  });

  it("expand never moves a position-locked group; the neighbor yields", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const g = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const locked = new GroupNode({ width: 300, height: 200 });
    locked.lockedPosition = true;
    for (const node of [g, locked]) await editor.addNode(node as never);
    const gView = addView(g.id, 100, 100, groupView(g));
    const lView = addView(locked.id, 450, 150, groupView(locked));

    await setGroupsCollapsed(editor, view, [g], false);
    await flushRafs();
    expect(lView.position).toEqual({ x: 450, y: 150 });
    expectNoOverlaps({ g: gView, locked: lView });
  });

  it("collapse separates a restore that lands on a card placed while expanded", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const g = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const n = new DisplayNode();
    const m = new DisplayNode();
    for (const node of [g, n, m]) await editor.addNode(node as never);
    const gView = addView(g.id, 100, 100, groupView(g));
    const nView = addView(n.id, 420, 140, () => ({ w: 180, h: 80 }));
    const mView = addView(m.id, 5000, 5000, () => ({ w: 180, h: 80 }));

    await setGroupsCollapsed(editor, view, [g], false);
    await flushRafs();
    expect(nView.position.x).toBeGreaterThan(420);
    // Parked across the group's bottom edge, over N's old spot.
    await view.moveNode(m.id, { x: 450, y: 180 });
    await setGroupsCollapsed(editor, view, [g], true);
    await flushRafs();
    expectNoOverlaps({ g: gView, n: nView, m: mView });
  });
});

describe("autofit and group creation", () => {
  it("autofit keeps a locked group's corner and brings the members to it", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const a = new DisplayNode();
    for (const node of [a]) await editor.addNode(node as never);
    const g = new GroupNode({ members: [a.id], width: 600, height: 400 });
    g.lockedPosition = true;
    await editor.addNode(g as never);
    addView(g.id, 100, 100, groupView(g));
    const aView = addView(a.id, 300, 300, () => ({ w: 180, h: 80 }));

    await autofitGroupWithHistory(editor, view, g);
    expect(view.position(g.id)).toEqual({ x: 100, y: 100 });
    expect(aView.position).toEqual({ x: 100 + GROUP_PAD, y: 100 + GROUP_HEADER + GROUP_PAD });
  });

  it("autofit that grows the box pushes a neighbor off it", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const a = new DisplayNode();
    const n = new DisplayNode();
    for (const node of [a, n]) await editor.addNode(node as never);
    const g = new GroupNode({ members: [a.id], width: 200, height: 150 });
    await editor.addNode(g as never);
    const gView = addView(g.id, 100, 100, groupView(g));
    addView(a.id, 400, 150, () => ({ w: 180, h: 80 }));
    const nView = addView(n.id, 450, 200, () => ({ w: 180, h: 80 }));
    expect(overlaps(boxAt(gView), boxAt(nView))).toBe(false);

    await autofitGroupWithHistory(editor, view, g);
    expectNoOverlaps({ g: gView, n: nView });
  });

  it("grouping takes a node out of its old group and pushes a bystander off the new box", async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView((id) => groupView(editor.getNode(id) as GroupNode)());
    const a = new DisplayNode();
    const b = new DisplayNode();
    const bystander = new DisplayNode();
    for (const node of [a, b, bystander]) await editor.addNode(node as never);
    const old = new GroupNode({ members: [a.id], width: 260, height: 170 });
    await editor.addNode(old as never);
    const oldView = addView(old.id, 1000, 1000, groupView(old));
    const aView = addView(a.id, 1024, 1058, () => ({ w: 180, h: 80 }));
    const bView = addView(b.id, 1400, 1058, () => ({ w: 180, h: 80 }));
    const byView = addView(bystander.id, 1200, 1300, () => ({ w: 180, h: 80 }));
    (a as { selected?: boolean }).selected = true;
    (b as { selected?: boolean }).selected = true;

    const id = await createGroupFromSelection(editor, view);
    const fresh = editor.getNode(id!) as GroupNode;
    expect(old.members).toEqual([]);
    expect(fresh.members.sort()).toEqual([a.id, b.id].sort());
    const freshView = { position: view.position(fresh.id)!, element: { offsetWidth: fresh.width, offsetHeight: fresh.height } };
    expect(aView.position).toEqual({ x: 1024, y: 1058 });
    expect(bView.position).toEqual({ x: 1400, y: 1058 });
    expectNoOverlaps({ fresh: freshView, by: byView, old: oldView });
  });
});
