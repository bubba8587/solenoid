import { describe, it, expect, beforeEach } from "vitest";
import {
  installPointerCensus, resetPointerCensus, isPinching, touchCount,
} from "./pointerGesture";
import { CappedZoom } from "./areaPresets";

// The pointer census + the pinch-priority rule it feeds. The vitest env is `node`,
// so there's no DOM — these drive the census through a fake event target and the
// zoom handler through a fake container, which is enough to pin the two things that
// actually broke: WHICH PHASE the finger count listens in, and WHICH CONTACTS count.

/** A minimal EventTarget the census can install onto, so a test can fire pointer
 *  events without a DOM. Mirrors addEventListener/removeEventListener only. */
function fakeTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string, e: { pointerId: number; pointerType?: string }) {
      for (const fn of listeners.get(type) ?? []) fn(e as unknown as Event);
    },
  };
}

const pointer = (pointerId: number, pointerType: string) => ({ pointerId, pointerType });

describe("pointer census — what gesture is in flight", () => {
  let t: ReturnType<typeof fakeTarget>;
  let uninstall: () => void;

  beforeEach(() => {
    resetPointerCensus();
    t = fakeTarget();
    uninstall = installPointerCensus(t as unknown as Window);
    return () => uninstall();
  });

  const down = (id: number, kind: string) => t.fire("pointerdown", pointer(id, kind));
  const up = (id: number, kind: string) => t.fire("pointerup", pointer(id, kind));

  it("needs TWO fingers for a pinch — one is a pan, not a zoom", () => {
    expect(isPinching()).toBe(false);
    down(1, "touch");
    expect(touchCount()).toBe(1);
    expect(isPinching()).toBe(false);
    down(2, "touch");
    expect(isPinching()).toBe(true);
  });

  it("releases the pinch when a finger lifts, and re-arms on the next one", () => {
    down(1, "touch"); down(2, "touch");
    expect(isPinching()).toBe(true);
    up(2, "touch");
    expect(isPinching()).toBe(false);
    down(3, "touch");
    expect(isPinching()).toBe(true);
  });

  it("never counts a precise pointer as a finger — not a mouse, not a stylus", () => {
    // Neither can pinch, and counting them would let a stylus resting on the glass
    // become the second contact of a zoom.
    down(1, "mouse");
    down(2, "pen");
    expect(touchCount()).toBe(0);
    expect(isPinching()).toBe(false);
    // A finger alongside them still isn't two fingers.
    down(3, "touch");
    expect(isPinching()).toBe(false);
    down(4, "touch");
    expect(isPinching()).toBe(true);
  });

  it("treats an unknown/absent pointerType as touch, since only digitizers omit it", () => {
    t.fire("pointerdown", { pointerId: 1 });
    t.fire("pointerdown", { pointerId: 2 });
    expect(isPinching()).toBe(true);
  });

  it("drops a cancelled contact, so a lost pointer can't strand the census", () => {
    down(1, "touch"); down(2, "touch");
    expect(isPinching()).toBe(true);
    t.fire("pointercancel", pointer(1, "touch"));
    expect(isPinching()).toBe(false);
  });

  it("resets to empty — the backstop for a pointerup the browser never delivers", () => {
    down(1, "touch"); down(2, "touch");
    resetPointerCensus();
    expect(touchCount()).toBe(0);
    expect(isPinching()).toBe(false);
  });
});

describe("CappedZoom — the pinch-priority rule", () => {
  // rete's base `initialize` binds its move/up pair to `window`, which the node test
  // env doesn't have. Only the CONTAINER registrations are under test here, so a
  // no-op window is enough to let the base constructor run.
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      addEventListener() {}, removeEventListener() {},
    };
    return () => { delete (globalThis as { window?: unknown }).window; };
  });

  /** A container that records the phase each listener registered in, so the test can
   *  assert on position rather than on behavior we'd need a real DOM to observe. */
  function fakeContainer() {
    const on: Array<{ type: string; fn: EventListener; capture: boolean }> = [];
    return {
      on,
      addEventListener(type: string, fn: EventListener, capture?: boolean) {
        on.push({ type, fn, capture: !!capture });
      },
      removeEventListener(type: string, fn: EventListener, capture?: boolean) {
        const i = on.findIndex((l) => l.type === type && l.fn === fn && l.capture === !!capture);
        if (i >= 0) on.splice(i, 1);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    };
  }

  function mount() {
    const container = fakeContainer();
    const zoom = new CappedZoom(0.1);
    zoom.initialize(container as unknown as HTMLElement, container as unknown as HTMLElement, () => {});
    return { container, zoom };
  }

  const downs = (c: ReturnType<typeof fakeContainer>) => c.on.filter((l) => l.type === "pointerdown");

  it("counts fingers in CAPTURE phase — the whole reason a node can't kill a pinch", () => {
    // Stock rete registers this in bubble, below ~180 stopPropagation sites. If this
    // ever flips back to capture:false, pinch dies across most of the node surface.
    const { container } = mount();
    expect(downs(container)).toHaveLength(1);
    expect(downs(container)[0].capture).toBe(true);
  });

  it("leaves PAN vetoable — it registers no bubble-phase pointerdown of its own", () => {
    // The other half of the rule: a control that wants the pointer must still be able
    // to suppress a pan/node-drag by stopping the event. Only the zoom is unstoppable.
    const { container } = mount();
    expect(downs(container).filter((l) => !l.capture)).toHaveLength(0);
  });

  it("removes the capture listener on destroy — stock destroy would leak it", () => {
    // Base `destroy` removes pointerdown WITHOUT the capture flag, which doesn't match
    // a capture registration; every composite drill-in open/close would stack another.
    const { container, zoom } = mount();
    zoom.destroy();
    expect(downs(container)).toHaveLength(0);
  });

  it("only real fingers reach the zoom's pointer list — not a mouse, not a stylus", () => {
    resetPointerCensus();
    const t = fakeTarget();
    const uninstall = installPointerCensus(t as unknown as Window);
    const { container, zoom } = mount();
    const fire = (e: { pointerId: number; pointerType: string }) => {
      t.fire("pointerdown", e);                                   // census first (window capture)
      downs(container)[0].fn(e as unknown as Event);              // then the container's capture
    };
    const pointers = () => (zoom as unknown as { pointers: unknown[] }).pointers;

    fire(pointer(1, "mouse"));
    expect(pointers()).toHaveLength(0);
    fire(pointer(2, "pen"));
    expect(pointers()).toHaveLength(0);

    fire(pointer(4, "touch"));
    fire(pointer(5, "touch"));
    expect(pointers()).toHaveLength(2);
    uninstall();
  });
});
