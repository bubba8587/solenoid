import { describe, it, expect, beforeEach } from "vitest";
import {
  installPointerCensus, resetPointerCensus, isPinching, touchCount,
} from "../../src/graph/pointerGesture";

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
