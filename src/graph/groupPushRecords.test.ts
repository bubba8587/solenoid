import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import type { AreaPlugin } from "rete-area-plugin";
import { GroupNode } from "./nodes/group";
import { DisplayNode } from "./nodes/display";
import { setGroupsCollapsed } from "./groupPush";

// ─── Expand-push record staleness across a Tidy ─────────────────────────────────
// The reported "Tidy/Cleanup around expanded groups misplaces nodes" sequence:
//
//   1. Expand group A → its push moves neighbour N aside; a restore record is
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

function makeFakeArea() {
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
  const area = {
    nodeViews,
    async translate(id: string, pos: Pos) {
      const v = nodeViews.get(id);
      if (v) v.position = { ...pos };
    },
    async update() {},
    area: { transform: { k: 1, x: 0, y: 0 } },
  };
  return { area: area as unknown as AreaPlugin<Schemes, AreaExtra>, addView };
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
    const { area, addView } = makeFakeArea();

    // Two collapsed groups and a loose, unwired neighbour.
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
    await setGroupsCollapsed(editor, area, [gA], false);
    await flushRafs();
    const pushedX = nView.position.x;
    expect(pushedX).toBeGreaterThan(420); // the push actually happened

    // 2. A Tidy-style programmatic move relocates N (the applier does exactly
    //    this: area.translate with no drag events, so no record invalidation).
    await area.translate(n.id, { x: 1200, y: 140 });

    // 3. Expand B — its footprint (1000..1600 × 80..380) covers N's new spot,
    //    so N is pushed again. This merge must treat the old record as stale.
    await setGroupsCollapsed(editor, area, [gB], false);
    await flushRafs();
    expect(nView.position.x).toBeGreaterThan(1200); // pushed again

    // 4. Collapse both. The restore must return N to where it stood BEFORE
    //    B's push (its post-Tidy spot, x=1200) — NOT to the pre-Tidy x=420.
    await setGroupsCollapsed(editor, area, [gA, gB], true);
    await flushRafs();
    expect(nView.position.x).toBe(1200);
  });

  it("the classic single-group cycle still restores exactly", async () => {
    const editor = new NodeEditor<Schemes>();
    const { area, addView } = makeFakeArea();
    const g = new GroupNode({ collapsed: true, width: 600, height: 300 });
    const n = new DisplayNode();
    (n as never as { width: number; height: number }).width = 180;
    (n as never as { width: number; height: number }).height = 80;
    for (const node of [g, n]) await editor.addNode(node as never);
    addView(g.id, 100, 100, groupView(g));
    const nView = addView(n.id, 420, 140, () => ({ w: 180, h: 80 }));

    await setGroupsCollapsed(editor, area, [g], false);
    await flushRafs();
    expect(nView.position.x).toBeGreaterThan(420);
    await setGroupsCollapsed(editor, area, [g], true);
    await flushRafs();
    expect(nView.position.x).toBe(420);
    expect(nView.position.y).toBe(140);
  });
});
