// [[C52]] visibleSelection, [[C92]] pinchUnvetoable
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installLassoSelection, type LassoState } from "../../src/graph/canvasLasso";
import { lassoActiveStore } from "../../src/graph/lasso";

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
    fire(type: string, e: object = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(e as Event);
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
  };
}

describe("lasso — an unfinished lasso never sticks", () => {
  const g = globalThis as Record<string, unknown>;
  let win: ReturnType<typeof fakeTarget>;
  let container: ReturnType<typeof fakeTarget>;
  let lasso: LassoState;
  let uninstall: () => void;

  beforeEach(() => {
    win = fakeTarget();
    container = fakeTarget();
    g.window = win;
    g.requestAnimationFrame = () => 1;
    g.cancelAnimationFrame = () => {};
    lassoActiveStore.set(false);
    uninstall = installLassoSelection({
      container: container as unknown as HTMLElement,
      editorRef: { current: { getNodes: () => [], getConnections: () => [] } } as never,
      viewRef: { current: { nodeElement: () => null, connectionElement: () => null, transform: { x: 0, y: 0, k: 1 } } } as never,
      setLasso: (l) => { lasso = l; },
    });
  });
  afterEach(() => {
    uninstall();
    delete g.window;
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
  });

  const press = () => container.fire("pointerdown", {
    shiftKey: true, button: 0, target: null, clientX: 10, clientY: 10,
    preventDefault() {}, stopPropagation() {},
  });
  const started = () => {
    press();
    expect(lassoActiveStore.get()).toBe(true);
    expect(lasso).not.toBeNull();
  };
  const ended = () => {
    expect(lassoActiveStore.get()).toBe(false);
    expect(lasso).toBeNull();
    expect(win.count()).toBe(0);
  };

  it("a cancelled pointer ends it", () => { started(); win.fire("pointercancel"); ended(); });
  it("losing the window ends it", () => { started(); win.fire("blur"); ended(); });
  it("Escape ends it", () => { started(); win.fire("keydown", { key: "Escape" }); ended(); });
  it("unmounting the surface ends it", () => { started(); uninstall(); ended(); uninstall = () => {}; });
});
