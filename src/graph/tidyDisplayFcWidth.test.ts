import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { AutoArrangePlugin } from "rete-auto-arrange-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import type { AreaPlugin } from "rete-area-plugin";
import { makeArrangeFn, symmetricPortPreset } from "./tidyArrange";
import { ArithmeticNode } from "./nodes/scalar";
import { DisplayNode } from "./nodes/display";
import { FormatControllerNode } from "./nodes/formatController";
import { nodeSizeStore } from "./nodeSizeStore";

// ── Regression: "num → Display + Format Controller widens on every Tidy" ────────
// The FC-host footprint restore captured measuredBox().w — which is offsetWidth,
// a BORDER-BOX read that INCLUDES the card's 1px border — and re-stamped it as
// style.width via area.resize onto the CONTENT-BOX `.solenoid-node` card. Each
// Tidy therefore grew the host card by the border width, compounding without
// bound (and dragging any group autofit along with it). Only the height pin was
// dropped afterward, so height stayed put while width crept.
//
// This fake area models exactly that content-box contract: offsetWidth =
// (inline style.width ?? natural content width) + BORDER, an inline width pin
// persists until removeProperty("width") clears it, and area.resize stamps that
// pin. The real makeArrangeFn drives real ELK over it. Pre-fix this test fails
// (the host width climbs); with the width pin dropped it stays flat.

const BORDER = 2; // 1px card border each side (content-box: offsetWidth = content + border)

interface FakeView {
  position: { x: number; y: number };
  naturalW: number;
  naturalH: number;
  stampedW: number | null;
  stampedH: number | null;
  translate: (x: number, y: number) => Promise<void>;
  element: {
    offsetWidth: number;
    offsetHeight: number;
    querySelector: (sel: string) => unknown;
    style: Record<string, string>;
  };
}

function makeFakeArea() {
  const nodeViews = new Map<string, FakeView>();
  const add = (id: string, x: number, y: number, w: number, h: number) => {
    const view: FakeView = {
      position: { x, y },
      naturalW: w,
      naturalH: h,
      stampedW: null,
      stampedH: null,
      translate: async (x2: number, y2: number) => { view.position = { x: x2, y: y2 }; },
      element: {
        get offsetWidth() { return (view.stampedW ?? view.naturalW) + BORDER; },
        get offsetHeight() { return (view.stampedH ?? view.naturalH) + BORDER; },
        querySelector(sel: string) {
          // The socket lookups the FC-footprint path makes have no DOM here.
          if (sel.startsWith("[data-socket")) return null;
          // The pin-drop loop selects the card and clears the inline dims.
          return {
            style: {
              removeProperty: (p: string) => {
                if (p === "width") view.stampedW = null;
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
  const area = {
    nodeViews,
    async translate(id: string, pos: { x: number; y: number }) {
      const v = nodeViews.get(id);
      if (v) v.position = { ...pos };
    },
    async resize(id: string, w: number, h: number) {
      const v = nodeViews.get(id);
      if (!v) return;
      v.stampedW = w; // area.resize sets style.width on the content-box card
      v.stampedH = h;
    },
    async update() { /* no-op headless */ },
    area: { transform: { k: 1, x: 0, y: 0 } },
  };
  return { area: area as unknown as AreaPlugin<Schemes, AreaExtra>, add };
}

function makeEnsureArrangeForTest(
  editor: NodeEditor<Schemes>,
  area: AreaPlugin<Schemes, AreaExtra>,
) {
  const plugin = new AutoArrangePlugin<Schemes>();
  plugin.addPreset(symmetricPortPreset);
  (plugin as unknown as { getArea: () => unknown }).getArea = () => area;
  (plugin as unknown as { getEditor: () => unknown }).getEditor = () => editor;
  return () => Promise.resolve(plugin);
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
  const { area, add } = makeFakeArea();

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
    editor, area,
    container: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) } as unknown as HTMLElement,
    ensureArrange: makeEnsureArrangeForTest(editor, area),
    repositionDockedTo: () => {},
    isDestroyed: () => false,
  });
  return { editor, area, arrangeFn, disp };
}

describe("Tidy with a docked FC does not widen the host on repeat", () => {
  it("the Display host card width is stable across three Tidies", async () => {
    const { area, arrangeFn, disp } = await buildScene();
    const widthOf = () => area.nodeViews.get(disp.id)!.element.offsetWidth;

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
    const { area, arrangeFn, disp } = await buildScene();
    nodeSizeStore.set(disp.id, { w: 260, h: 120 });
    const view = area.nodeViews.get(disp.id) as unknown as FakeView;
    // Reflect the manual size the way the ResizeObserver would.
    view.naturalW = 260;

    await arrangeFn({ skipConfirm: true });
    await flushRafs();

    // The card carries the manual width (re-applied), not a dropped/CSS default.
    expect(view.stampedW).toBe(260);
  });
});
