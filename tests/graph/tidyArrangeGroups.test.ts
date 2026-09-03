import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { makeArrangeFn, makeCleanupFn, makeEnsureElk } from "../../src/graph/tidyArrange";
import { settingsStore } from "../../src/graph/settingsStore";
import { GroupNode } from "../../src/graph/nodes/group";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import { DisplayNode } from "../../src/graph/nodes/display";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { dockedNodeStore } from "../../src/graph/dockedNodeStore";
import { GROUP_PAD, GROUP_HEADER, autofitGroupWithHistory } from "../../src/graph/groupLogic";
import { COLLAPSE_LAYOUT, groupCollapseStore } from "../../src/graph/groupCollapse";
import { socketFlipStore } from "../../src/graph/socketFlipStore";
import { collapseStore } from "../../src/graph/collapseStore";
import { nodeSizeStore } from "../../src/graph/nodeSizeStore";

// ─── Headless Tidy/Cleanup harness ──────────────────────────────────────────────
// The real arrangeFn is DOM-coupled: it measures node sizes off view.nodeViews
// (offsetWidth/Height), stamps sizes back via view.resize, and moves nodes via
// async view.translate. This harness runs the REAL makeArrangeFn / makeCleanupFn
// against a real NodeEditor and a FAKE view whose views model exactly that DOM
// contract (position + a measurable element whose size reflects resize stamps),
// with elkjs running for real. It exists to pin the expanded-group invariants:
//
//   1. A global Tidy treats an expanded group as a rigid unit: members keep
//      their offsets relative to the group box.
//   2. Nothing (member or loose node) overlaps another node after the pass.
//   3. Cleanup (tidy groups → autofit → collapse → top-level tidy) keeps every
//      member riding its group.
//
// requestAnimationFrame is queued and flushed manually so the deferred FC
// snap-back / standoff settle phases run deterministically.

type Pos = { x: number; y: number };

interface FakeView {
  position: Pos;
  element: {
    offsetWidth: number;
    offsetHeight: number;
    querySelector: (sel: string) => { classList: { contains: (c: string) => boolean }; style: { removeProperty: (p: string) => void; width: string } };
    style: Record<string, string>;
  };
  /** test-side handle: the size resize() stamped (null = content-driven) */
  stamped: { w: number; h: number } | null;
  /** content-driven size (what the DOM would measure with no stamp) */
  natural: { w: number; h: number };
  heightPinned: boolean;
  /** the width the tidy pin-drop stamped on the card (null = removed/none) */
  stampedWidth: string | null;
}

/** The fake exposes its per-node handles as `fakes` beside the real View API. */
type FakeViewHandle = View & { fakes: Map<string, FakeView> };

function makeFakeView() {
  const nodeViews = new Map<string, FakeView>();
  // `naturalFn` models a React-driven size (groups: expanded box vs compact
  // collapsed card). When it changes what it reports (collapse flip → React
  // rewrites the style attribute), any earlier view.resize stamp dies with it.
  const addView = (id: string, x: number, y: number, w: number, h: number, naturalFn?: () => { w: number; h: number }) => {
    let lastNatural = naturalFn ? naturalFn() : { w, h };
    const natural = () => {
      if (naturalFn) {
        const now = naturalFn();
        if (now.w !== lastNatural.w || now.h !== lastNatural.h) {
          view.stamped = null; // React re-wrote the inline style
          view.heightPinned = false;
          lastNatural = now;
        }
        return now;
      }
      return view.natural;
    };
    const view: FakeView = {
      position: { x, y },
      stamped: null,
      natural: { w, h },
      heightPinned: false,
      stampedWidth: null,
      element: {
        get offsetWidth() { return view.stamped?.w ?? natural().w; },
        get offsetHeight() {
          // A dropped height pin returns the card to content-driven height.
          const n = natural();
          return view.heightPinned && view.stamped ? view.stamped.h : n.h;
        },
        querySelector: (sel: string) =>
          // Socket lookups ([data-socket-key=…]) have no DOM here → null (the
          // callers fall back); the card selector returns the pin-drop stub.
          sel.startsWith("[data-socket")
            ? null as never
            : {
                classList: { contains: (c: string) => c === "solenoid-node" },
                style: {
                  removeProperty: (p: string) => {
                    if (p === "height") view.heightPinned = false;
                    if (p === "width") view.stampedWidth = null;
                  },
                  set width(v: string) { view.stampedWidth = v; },
                  get width() { return view.stampedWidth ?? ""; },
                },
              },
        style: {},
      },
    };
    nodeViews.set(id, view);
    return view;
  };
  const view = {
    fakes: nodeViews,
    hasNode: (id: string) => nodeViews.has(id),
    position: (id: string) => nodeViews.get(id)?.position,
    nodeElement: (id: string) => (nodeViews.get(id)?.element ?? null) as unknown as HTMLElement | null,
    connectionElement: () => null,
    async moveNode(id: string, pos: Pos) {
      const v = nodeViews.get(id);
      if (v) v.position = { ...pos };
    },
    async rerenderCables() {},
    async rerenderNode() { /* re-render — nothing to do headless */ },
    transform: { k: 1, x: 0, y: 0 },
  };
  return { view: view as unknown as FakeViewHandle, addView };
}



function connect(
  editor: NodeEditor<Schemes>,
  src: ClassicPreset.Node, srcOut: string, tgt: ClassicPreset.Node, tgtIn: string,
) {
  return editor.addConnection(
    new ClassicPreset.Connection(src, srcOut, tgt, tgtIn) as Schemes["Connection"],
  );
}

type Box = { id: string; x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;

// rAF queue — flushed manually so the deferred phases run when the test says so.
let rafQueue: FrameRequestCallback[] = [];
async function flushRafs(rounds = 5) {
  for (let i = 0; i < rounds && rafQueue.length; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(performance.now());
    // let any promises the callbacks kicked off settle
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

// Build the standard scene: src → [group: m1 → m2] → sink, group expanded.
async function buildScene() {
  const editor = new NodeEditor<Schemes>();
  const { view, addView } = makeFakeView();

  const src = new ArithmeticNode({ op: "add" });
  const m1 = new ArithmeticNode({ op: "add" });
  const m2 = new ArithmeticNode({ op: "add" });
  const sink = new DisplayNode();
  for (const n of [src, m1, m2, sink]) await editor.addNode(n as never);

  await connect(editor, src, "result", m1, "a");
  await connect(editor, m1, "result", m2, "a");
  await connect(editor, m2, "result", sink, "in");

  // Sizes: what the DOM would measure (node.width/height mirrors kept in sync,
  // the way NodeCard's ResizeObserver does).
  const size = (n: ClassicPreset.Node & { width: number; height: number }, w: number, h: number) => {
    n.width = w; n.height = h;
  };
  size(src as never, 180, 100);
  size(m1 as never, 180, 100);
  size(m2 as never, 180, 100);
  size(sink as never, 180, 80);

  // Members inside the group interior; group wraps them with the standard pads.
  addView(m1.id, 424, 358, 180, 100);
  addView(m2.id, 660, 358, 180, 100);
  const gw = (660 + 180 + GROUP_PAD) - (424 - GROUP_PAD);
  const gh = 100 + GROUP_PAD * 2 + GROUP_HEADER;
  const group = new GroupNode({ members: [m1.id, m2.id], width: gw, height: gh });
  await editor.addNode(group as never);
  addView(group.id, 424 - GROUP_PAD, 358 - GROUP_PAD - GROUP_HEADER, gw, gh, () =>
    group.collapsed
      ? {
          w: COLLAPSE_LAYOUT.width,
          h: COLLAPSE_LAYOUT.headerH + COLLAPSE_LAYOUT.padTop * 2 +
             Math.max(groupCollapseStore.retainedFor(group.id).length,
                      groupCollapseStore.inputPillsFor(group.id).length) * COLLAPSE_LAYOUT.rowH,
        }
      : { w: group.width, h: group.height });

  addView(src.id, 60, 380, 180, 100);
  addView(sink.id, 980, 380, 180, 80);

  const ensureElk = makeEnsureElk(() => false);
  const arrangeFn = makeArrangeFn({
    editor, view,
    container: {} as HTMLElement,
    ensureElk,
    repositionDockedTo: () => {},
    isDestroyed: () => false,
  });
  return { editor, view, arrangeFn, src, m1, m2, sink, group };
}

function boxOf(view: FakeViewHandle, id: string): Box {
  const v = view.fakes.get(id) as unknown as FakeView;
  return { id, x: v.position.x, y: v.position.y, w: v.element.offsetWidth, h: v.element.offsetHeight };
}

describe("global Tidy with an expanded group (headless, real ELK + real arrangeFn)", () => {
  it("members keep their offsets relative to the group box (rigid carry)", async () => {
    const { view, arrangeFn, m1, m2, group } = await buildScene();
    const gv = view.fakes.get(group.id)!;
    const before = {
      m1: { dx: view.fakes.get(m1.id)!.position.x - gv.position.x, dy: view.fakes.get(m1.id)!.position.y - gv.position.y },
      m2: { dx: view.fakes.get(m2.id)!.position.x - gv.position.x, dy: view.fakes.get(m2.id)!.position.y - gv.position.y },
    };
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const after = {
      m1: { dx: view.fakes.get(m1.id)!.position.x - gv.position.x, dy: view.fakes.get(m1.id)!.position.y - gv.position.y },
      m2: { dx: view.fakes.get(m2.id)!.position.x - gv.position.x, dy: view.fakes.get(m2.id)!.position.y - gv.position.y },
    };
    expect(after.m1.dx).toBeCloseTo(before.m1.dx, 6);
    expect(after.m1.dy).toBeCloseTo(before.m1.dy, 6);
    expect(after.m2.dx).toBeCloseTo(before.m2.dx, 6);
    expect(after.m2.dy).toBeCloseTo(before.m2.dy, 6);
  });

  it("loose nodes never land inside the expanded group box", async () => {
    const { view, arrangeFn, src, sink, group } = await buildScene();
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const g = boxOf(view, group.id);
    for (const id of [src.id, sink.id]) {
      const b = boxOf(view, id);
      expect(overlaps(g, b), `${id} overlaps the group box`).toBe(false);
    }
  });

  it("a position-locked group stays put and nothing lands on it", async () => {
    const { editor, view, arrangeFn, src, sink, m1, m2, group } = await buildScene();
    group.lockedPosition = true;
    const gBefore = { ...view.fakes.get(group.id)!.position };
    const m1Before = { ...view.fakes.get(m1.id)!.position };
    const m2Before = { ...view.fakes.get(m2.id)!.position };
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    // The locked group and its members never moved.
    expect(view.fakes.get(group.id)!.position).toEqual(gBefore);
    expect(view.fakes.get(m1.id)!.position).toEqual(m1Before);
    expect(view.fakes.get(m2.id)!.position).toEqual(m2Before);
    // No tidied loose node overlaps the fixed group.
    const g = boxOf(view, group.id);
    for (const id of [src.id, sink.id]) {
      expect(overlaps(g, boxOf(view, id)), `${id} overlaps the locked group`).toBe(false);
    }
    // Sanity: the pass still ran (loose nodes are the layout targets).
    expect(editor.getNodes().length).toBe(5);
  });

  it("the group's rendered box is unchanged by the pass (rigid unit, not resized)", async () => {
    const { view, arrangeFn, group } = await buildScene();
    const before = boxOf(view, group.id);
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const after = boxOf(view, group.id);
    expect(after.w).toBeCloseTo(before.w, 6);
    expect(after.h).toBeCloseTo(before.h, 6);
  });

  async function expectSecondTidyIdempotent() {
    const { view, arrangeFn, editor } = await buildScene();
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const first = new Map(editor.getNodes().map((n) => [n.id, { ...view.fakes.get(n.id)!.position }]));
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    for (const n of editor.getNodes()) {
      const p = view.fakes.get(n.id)!.position;
      const f = first.get(n.id)!;
      expect(Math.abs(p.x - f.x), `${n.label} drifted x`).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y - f.y), `${n.label} drifted y`).toBeLessThanOrEqual(1);
    }
  }

  it("a second Tidy is (near-)idempotent — everything stays within 1px", async () => {
    await expectSecondTidyIdempotent();
  });

  it("stays idempotent under DOWN (the anchor transpose is a fixed point too)", async () => {
    settingsStore.set("tidyDirection", "down");
    try { await expectSecondTidyIdempotent(); }
    finally { settingsStore.set("tidyDirection", "right"); }
  });

  it("stays idempotent with a width cap of 3", async () => {
    settingsStore.set("tidyWidthCap", "3");
    try { await expectSecondTidyIdempotent(); }
    finally { settingsStore.set("tidyWidthCap", "off"); }
  });
});

describe("global Tidy — two expanded groups + docked FC on a member", () => {
  async function buildTwoGroupScene() {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();

    const src = new ArithmeticNode({ op: "add" });
    const a1 = new ArithmeticNode({ op: "add" });
    const a2 = new ArithmeticNode({ op: "add" });
    const b1 = new ArithmeticNode({ op: "add" });
    const b2 = new DisplayNode();
    const loose = new DisplayNode(); // unwired bystander
    for (const n of [src, a1, a2, b1, b2, loose]) await editor.addNode(n as never);

    await connect(editor, src, "result", a1, "a");
    await connect(editor, a1, "result", a2, "a");
    await connect(editor, a2, "result", b1, "a"); // group A → group B crossing
    await connect(editor, b1, "result", b2, "in");

    for (const n of [src, a1, a2, b1] as Array<{ width: number; height: number }>) { n.width = 180; n.height = 100; }
    (b2 as never as { width: number; height: number }).width = 180;
    (b2 as never as { width: number; height: number }).height = 80;
    (loose as never as { width: number; height: number }).width = 160;
    (loose as never as { width: number; height: number }).height = 90;

    // A docked FC on a2's output (a2 is a member of group A).
    const fc = new FormatControllerNode({ hostNodeId: a2.id, socketKey: "result", side: "output" });
    await editor.addNode(fc as never);
    fc.dockSelf(editor as never);

    addView(a1.id, 224, 358, 180, 100);
    addView(a2.id, 460, 358, 180, 100);
    const gaW = (460 + 180 + GROUP_PAD) - (224 - GROUP_PAD);
    const gaH = 100 + GROUP_PAD * 2 + GROUP_HEADER;
    const gA = new GroupNode({ members: [a1.id, a2.id, fc.id], width: gaW, height: gaH });
    await editor.addNode(gA as never);
    addView(gA.id, 224 - GROUP_PAD, 358 - GROUP_PAD - GROUP_HEADER, gaW, gaH);
    addView(fc.id, 460 + 180 + 8, 358 + 20, 116, 64);

    addView(b1.id, 1024, 158, 180, 100);
    addView(b2.id, 1260, 158, 180, 80);
    const gbW = (1260 + 180 + GROUP_PAD) - (1024 - GROUP_PAD);
    const gbH = 100 + GROUP_PAD * 2 + GROUP_HEADER;
    const gB = new GroupNode({ members: [b1.id, b2.id], width: gbW, height: gbH });
    await editor.addNode(gB as never);
    addView(gB.id, 1024 - GROUP_PAD, 158 - GROUP_PAD - GROUP_HEADER, gbW, gbH);

    addView(src.id, -160, 380, 180, 100);
    addView(loose.id, 400, 800, 160, 90);

    const ensureElk = makeEnsureElk(() => false);
    const arrangeFn = makeArrangeFn({
      editor, view,
      container: {} as HTMLElement,
      ensureElk,
      repositionDockedTo: () => {},
      isDestroyed: () => false,
    });
    return { editor, view, arrangeFn, src, a1, a2, b1, b2, loose, fc, gA, gB };
  }

  it("members of both groups ride rigidly; no group/loose overlaps; no stray height pins", async () => {
    const s = await buildTwoGroupScene();
    const relBefore = new Map<string, Pos>();
    for (const [gid, mids] of [[s.gA.id, [s.a1.id, s.a2.id]], [s.gB.id, [s.b1.id, s.b2.id]]] as Array<[string, string[]]>) {
      const gv = s.view.fakes.get(gid)!;
      for (const mid of mids) {
        const mv = s.view.fakes.get(mid)!;
        relBefore.set(mid, { x: mv.position.x - gv.position.x, y: mv.position.y - gv.position.y });
      }
    }
    await s.arrangeFn({ skipConfirm: true });
    await flushRafs();

    for (const [gid, mids] of [[s.gA.id, [s.a1.id, s.a2.id]], [s.gB.id, [s.b1.id, s.b2.id]]] as Array<[string, string[]]>) {
      const gv = s.view.fakes.get(gid)!;
      for (const mid of mids) {
        const mv = s.view.fakes.get(mid)!;
        const rel = relBefore.get(mid)!;
        expect(mv.position.x - gv.position.x, `${mid} rel-x drifted`).toBeCloseTo(rel.x, 6);
        expect(mv.position.y - gv.position.y, `${mid} rel-y drifted`).toBeCloseTo(rel.y, 6);
      }
    }
    // Visible top-level units don't overlap.
    const units = [s.gA.id, s.gB.id, s.src.id, s.loose.id, s.b2.id].filter(
      (id, i, arr) => arr.indexOf(id) === i,
    );
    const boxes = [s.gA.id, s.gB.id, s.src.id, s.loose.id].map((id) => boxOf(s.view, id));
    void units;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j]), `${boxes[i].id} ∩ ${boxes[j].id}`).toBe(false);
      }
    }
    // No node left with a stamped, undropped height pin (a frozen card): the
    // arrange stamps sizes via view.resize and MUST clear every pin it created
    // on regular nodes (groups excluded — React owns their size).
    for (const n of s.editor.getNodes()) {
      if (n instanceof GroupNode) continue;
      const v = s.view.fakes.get(n.id) as unknown as FakeView;
      expect(v.heightPinned, `${n.id} (${n.label}) left with a pinned height`).toBe(false);
    }
    dockedNodeStore.undock(s.fc.id);
  });
});

describe("within-group Tidy (group Tidy button): grow → push → autofit", () => {
  it("members land inside the final box; a right-hand neighbor is pushed clear", { timeout: 20000 }, async () => {
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();

    // A chain of three members crammed into a box that's too small for the
    // laid-out row, plus a neighbor parked just off the box's right edge.
    const m1 = new ArithmeticNode({ op: "add" });
    const m2 = new ArithmeticNode({ op: "add" });
    const m3 = new ArithmeticNode({ op: "add" });
    const neighbor = new DisplayNode();
    for (const n of [m1, m2, m3, neighbor]) await editor.addNode(n as never);
    await connect(editor, m1, "result", m2, "a");
    await connect(editor, m2, "result", m3, "a");
    for (const n of [m1, m2, m3] as Array<{ width: number; height: number }>) { n.width = 180; n.height = 100; }
    (neighbor as never as { width: number; height: number }).width = 180;
    (neighbor as never as { width: number; height: number }).height = 80;

    // Members stacked almost on top of each other inside a minimal box.
    addView(m1.id, 124, 158, 180, 100);
    addView(m2.id, 134, 168, 180, 100);
    addView(m3.id, 144, 178, 180, 100);
    const group = new GroupNode({ members: [m1.id, m2.id, m3.id], width: 260, height: 200 });
    await editor.addNode(group as never);
    addView(group.id, 100, 100, 260, 200, () =>
      group.collapsed ? { w: COLLAPSE_LAYOUT.width, h: 60 } : { w: group.width, h: group.height });

    // Neighbor sits just past the box's right edge — the grown box must push it.
    addView(neighbor.id, 380, 140, 180, 80);

    const ensureElk = makeEnsureElk(() => false);
    const arrangeFn = makeArrangeFn({
      editor, view,
      container: {} as HTMLElement,
      ensureElk,
      repositionDockedTo: () => {},
      isDestroyed: () => false,
    });

    // The GroupNode Tidy button flow: within-group arrange → two frames →
    // autofit (wrap-to-members).
    await arrangeFn({ groupId: group.id });
    await flushRafs();
    await autofitGroupWithHistory(editor, view, group);
    await flushRafs();

    // Every member sits inside the final box interior.
    const gv = view.fakes.get(group.id)!;
    for (const id of [m1.id, m2.id, m3.id]) {
      const v = view.fakes.get(id)!;
      expect(v.position.x, `${id} left of box`).toBeGreaterThanOrEqual(gv.position.x - 1);
      expect(v.position.y, `${id} above box interior`).toBeGreaterThanOrEqual(gv.position.y + GROUP_HEADER - 1);
      expect(v.position.x + v.element.offsetWidth, `${id} past right edge`).toBeLessThanOrEqual(gv.position.x + group.width + 1);
      expect(v.position.y + v.element.offsetHeight, `${id} past bottom edge`).toBeLessThanOrEqual(gv.position.y + group.height + 1);
    }
    // The neighbor is clear of the grown box.
    const g = boxOf(view, group.id);
    const nb = boxOf(view, neighbor.id);
    expect(overlaps(g, nb), "neighbor overlaps the grown group box").toBe(false);
  });
});

describe("Cleanup with an expanded group (headless)", () => {
  it("members ride their group through tidy→autofit→collapse→top-level tidy", { timeout: 20000 }, async () => {
    const { editor, view, arrangeFn, m1, m2, group } = await buildScene();
    const cleanup = makeCleanupFn(editor, view, arrangeFn);
    const run = cleanup();
    // Cleanup awaits two rAFs mid-flight (and ELK runs for real between them);
    // keep yielding + flushing until it resolves.
    let done = false;
    void run.then(() => { done = true; });
    for (let i = 0; i < 400 && !done; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await flushRafs(1);
    }
    await run;
    await flushRafs();

    // After cleanup the group is collapsed; members must sit inside the
    // group's STORED (expanded) box at its final position, so a later expand
    // shows them inside it.
    const gv = view.fakes.get(group.id)!;
    for (const id of [m1.id, m2.id]) {
      const v = view.fakes.get(id) as unknown as FakeView;
      const inX = v.position.x >= gv.position.x - 1 && v.position.x + v.natural.w <= gv.position.x + group.width + 1;
      const inY = v.position.y >= gv.position.y + GROUP_HEADER - 1 && v.position.y + v.natural.h <= gv.position.y + group.height + 1;
      expect(inX, `${id} left the group box horizontally`).toBe(true);
      expect(inY, `${id} left the group box vertically`).toBe(true);
    }
    expect(group.collapsed).toBe(true);
  });
});

describe("Tidy with a flipped node (predecessor layering, real ELK)", () => {
  afterEach(() => { socketFlipStore.clear(); settingsStore.set("tidyDirection", "right"); });

  async function buildPair() {
    settingsStore.set("tidyDirection", "right");
    const editor = new NodeEditor<Schemes>();
    const { view, addView } = makeFakeView();
    const a = new ArithmeticNode({ op: "add" });
    const b = new DisplayNode();
    for (const n of [a, b]) await editor.addNode(n as never);
    await connect(editor, a, "result", b, "in");
    (a as unknown as { width: number; height: number }).width = 180;
    (a as unknown as { width: number; height: number }).height = 100;
    (b as unknown as { width: number; height: number }).width = 180;
    (b as unknown as { width: number; height: number }).height = 80;
    addView(a.id, 100, 100, 180, 100);
    addView(b.id, 400, 100, 180, 80);
    const ensureElk = makeEnsureElk(() => false);
    const arrangeFn = makeArrangeFn({
      editor, view, container: {} as HTMLElement, ensureElk,
      repositionDockedTo: () => {}, isDestroyed: () => false,
    });
    return { view, arrangeFn, a, b };
  }

  it("lays the sink to the RIGHT of its source with no flip (normal flow)", async () => {
    const { view, arrangeFn, a, b } = await buildPair();
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    expect(view.fakes.get(b.id)!.position.x).toBeGreaterThan(view.fakes.get(a.id)!.position.x);
  });

  it("lays a FLIPPED sink to the LEFT of its source (acts as a predecessor)", async () => {
    const { view, arrangeFn, a, b } = await buildPair();
    socketFlipStore.set(b.id, true);
    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    expect(view.fakes.get(b.id)!.position.x).toBeLessThan(view.fakes.get(a.id)!.position.x);
  });

  it("does NOT stamp a manual (expanded) width onto a COLLAPSED node", async () => {
    const { view, arrangeFn, a, b } = await buildPair();
    // b was resized wider than its collapsed form while expanded, then collapsed.
    nodeSizeStore.set(b.id, { w: 420, h: 200 });
    collapseStore.set(b.id, true);
    try {
      await arrangeFn({ skipConfirm: true });
      await flushRafs();
      // The collapsed card must keep its compact width — the pin-drop skips the
      // manual stamp (mirrors NodeCard dropping the manual size while collapsed).
      expect(view.fakes.get(b.id)!.stampedWidth).toBeNull();
      // A non-collapsed sized node still gets its manual width.
      nodeSizeStore.set(a.id, { w: 300, h: 100 });
      await arrangeFn({ skipConfirm: true });
      await flushRafs();
      expect(view.fakes.get(a.id)!.stampedWidth).toBe("300px");
    } finally {
      collapseStore.clear();
      nodeSizeStore.clear();
    }
  });
});
