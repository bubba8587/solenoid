import type { View } from "../../src/graph/view";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import type { Schemes } from "../../src/graph/schemes";
import { makeArrangeFn, makeEnsureElk } from "../../src/graph/tidyArrange";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import { DisplayNode } from "../../src/graph/nodes/display";
import { FormatControllerNode } from "../../src/graph/nodes/formatController";
import { NoteNode } from "../../src/graph/nodes/annotation";
import { nodeSizeStore } from "../../src/graph/nodeSizeStore";

// ── Regression: "num → Display + Format Controller widens on every Tidy" ────────
// The FC-host footprint restore captured measuredBox().w — which is offsetWidth,
// a BORDER-BOX read that INCLUDES the card's 1px border — and re-stamped it as
// style.width via view.resize onto the CONTENT-BOX `.solenoid-node` card. Each
// Tidy therefore grew the host card by the border width, compounding without
// bound (and dragging any group autofit along with it). Only the height pin was
// dropped afterward, so height stayed put while width crept.
//
// This fake view models exactly that content-box contract: offsetWidth =
// (inline style.width ?? natural content width) + BORDER, an inline width pin
// persists until removeProperty("width") clears it, and view.resize stamps that
// pin. The real makeArrangeFn drives real ELK over it. Pre-fix this test fails
// (the host width climbs); with the width pin dropped it stays flat.

const BORDER = 2; // 1px card border each side (content-box: offsetWidth = content + border)

interface FakeView {
  position: { x: number; y: number };
  naturalW: number;
  naturalH: number;
  stampedW: number | null;
  stampedH: number | null;
  /** true once the pin-drop loop called removeProperty("width") on this card */
  widthCleared: boolean;
  element: {
    offsetWidth: number;
    offsetHeight: number;
    querySelector: (sel: string) => unknown;
    style: Record<string, string>;
  };
}

function makeFakeView() {
  const nodeViews = new Map<string, FakeView>();
  // rootClass models the card root's CSS class: "solenoid-node" for standard
  // NodeCard roots, "solenoid-note" etc. for React-sized roots the pin-drop
  // loop must leave alone.
  const add = (id: string, x: number, y: number, w: number, h: number, rootClass = "solenoid-node") => {
    const view: FakeView = {
      position: { x, y },
      naturalW: w,
      naturalH: h,
      stampedW: null,
      stampedH: null,
      widthCleared: false,
      element: {
        get offsetWidth() { return (view.stampedW ?? view.naturalW) + BORDER; },
        get offsetHeight() { return (view.stampedH ?? view.naturalH) + BORDER; },
        querySelector(sel: string) {
          // The socket lookups the FC-footprint path makes have no DOM here.
          if (sel.startsWith("[data-socket")) return null;
          // The pin-drop loop selects the card and clears the inline dims.
          return {
            classList: { contains: (c: string) => c === rootClass },
            style: {
              removeProperty: (p: string) => {
                if (p === "width") { view.stampedW = null; view.widthCleared = true; }
                if (p === "height") view.stampedH = null;
              },
              // A manual re-apply writes style.width back onto the card.
              set width(v: string) { view.stampedW = parseFloat(v); },
              get width() { return view.stampedW == null ? "" : `${view.stampedW}px`; },
            },
          };
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
    async moveNode(id: string, pos: { x: number; y: number }) {
      const v = nodeViews.get(id);
      if (v) v.position = { ...pos };
    },
    async rerenderCables() {},
    async rerenderNode() { /* no-op headless */ },
    transform: { k: 1, x: 0, y: 0 },
  };
  return { view: view as unknown as View & { fakes: Map<string, FakeView> }, add };
}

let rafQueue: FrameRequestCallback[] = [];
async function flushRafs(rounds = 5) {
  for (let i = 0; i < rounds && rafQueue.length; i++) {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
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
  nodeSizeStore.clear();
  delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
});

async function buildScene() {
  const editor = new NodeEditor<Schemes>();
  const { view, add } = makeFakeView();

  const num = new ArithmeticNode({ op: "add" });
  const disp = new DisplayNode();
  for (const n of [num, disp]) await editor.addNode(n as never);
  await editor.addConnection(
    new ClassicPreset.Connection(num, "result", disp, "in") as Schemes["Connection"],
  );

  // An FC docked to the Display's output — the footprint-restore path is what
  // stamped offsetWidth and compounded.
  const fc = new FormatControllerNode({ hostNodeId: disp.id, socketKey: "in", side: "output" });
  await editor.addNode(fc as never);
  fc.dockSelf(editor as never);

  (num as never as { width: number; height: number }).width = 180;
  (num as never as { width: number; height: number }).height = 100;
  (disp as never as { width: number; height: number }).width = 180;
  (disp as never as { width: number; height: number }).height = 80;
  (fc as never as { width: number; height: number }).width = 116;
  (fc as never as { width: number; height: number }).height = 64;

  add(num.id, 60, 200, 180, 100);
  add(disp.id, 340, 200, 180, 80);
  add(fc.id, 340 + 180 + 8, 220, 116, 64);

  const arrangeFn = makeArrangeFn({
    editor, view,
    container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) } as unknown as HTMLElement,
    ensureElk: makeEnsureElk(() => false),
    repositionDockedTo: () => {},
    isDestroyed: () => false,
  });
  return { editor, view, arrangeFn, disp, add };
}

describe("Tidy with a docked FC does not widen the host on repeat", () => {
  it("the Display host card width is stable across three Tidies", async () => {
    const { view, arrangeFn, disp } = await buildScene();
    const widthOf = () => view.nodeElement(disp.id)!.offsetWidth;

    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const w1 = widthOf();

    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const w2 = widthOf();

    await arrangeFn({ skipConfirm: true });
    await flushRafs();
    const w3 = widthOf();

    expect(w2).toBe(w1);
    expect(w3).toBe(w1);
  });

  it("a manually-resized Display keeps its chosen width after Tidy", async () => {
    const { view, arrangeFn, disp } = await buildScene();
    nodeSizeStore.set(disp.id, { w: 260, h: 120 });
    const fv = view.fakes.get(disp.id)!;
    // Reflect the manual size the way the ResizeObserver would.
    fv.naturalW = 260;

    await arrangeFn({ skipConfirm: true });
    await flushRafs();

    // The card carries the manual width (re-applied), not a dropped/CSS default.
    expect(fv.stampedW).toBe(260);
  });

  // Regression: "Tidy makes Notes very very wide (sockets misaligned), fixed by
  // touching the resize grip". Note / Image / Conduit / Obsidian roots set their
  // inline width from React's style prop (data.width) — removeProperty("width")
  // strips React's own value, React doesn't re-stamp an unchanged style, and the
  // unsized element shrink-wraps against the zoom plane. The pin-drop loop must
  // only touch .solenoid-node (NodeCard) roots.
  it("Tidy never clears the inline width of a React-sized root (Note)", async () => {
    const { editor, view, arrangeFn, add } = await buildScene();
    const note = new NoteNode({ body: "hello" });
    await editor.addNode(note as never);
    const fv = add(note.id, 600, 200, note.width, note.height, "solenoid-note");

    await arrangeFn({ skipConfirm: true });
    await flushRafs();

    expect(fv.widthCleared).toBe(false);
    // The standard cards in the same pass DID get their pins dropped.
    const cleared = [...view.fakes.entries()]
      .filter(([id]) => id !== note.id)
      .map(([, v]) => v.widthCleared);
    expect(cleared.some(Boolean)).toBe(true);
  });
});
