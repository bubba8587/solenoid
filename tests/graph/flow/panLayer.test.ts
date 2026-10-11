// [[C120]] linearWork
import { describe, expect, it } from "vitest";
import { alignedViewport, createPanLayer, isPressPan, promotesPans } from "../../../src/graph/flow/panLayer";

const fakeViewport = () => {
  const classes = new Set<string>();
  const el = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } as unknown as HTMLElement;
  return { el, promoted: () => classes.has("sol-pan-layer") };
};
const setup = () => {
  const vp = fakeViewport();
  return { vp, layer: createPanLayer(() => vp.el, () => true, () => 1) };
};
const cam = (x: number, y: number, zoom: number) => ({ x, y, zoom });

describe("pan layer", () => {
  it("goes up on the first move of a press pan", () => {
    const { vp, layer } = setup();
    layer.start({ type: "mousedown" }, 0.5);
    expect(vp.promoted()).toBe(false);
    layer.move(cam(10, 20, 0.5));
    expect(vp.promoted()).toBe(true);
  });

  it("stays up through a release and the next stroke, so a flick doesn't re-record every card", () => {
    const { vp, layer } = setup();
    layer.start({ type: "touchstart" }, 0.2);
    layer.move(cam(10, 20, 0.2));
    layer.release({ type: "touchend" });
    expect(vp.promoted()).toBe(true);
    layer.start({ type: "touchstart" }, 0.2);
    layer.move(cam(40, 20, 0.2));
    expect(vp.promoted()).toBe(true);
  });

  it("drops when the zoom changes", () => {
    const { vp, layer } = setup();
    layer.start({ type: "pointerdown" }, 1);
    layer.move(cam(0, 0, 1));
    layer.release({ type: "pointerup" });
    layer.move(cam(3, 4, 1.1));
    expect(vp.promoted()).toBe(false);
  });

  it("drops when a move it didn't drive leaves the camera off whole pixels, and keeps it on them", () => {
    const { vp, layer } = setup();
    layer.start({ type: "mousedown" }, 1);
    layer.move(cam(0, 0, 1));
    layer.release({ type: "mouseup" });
    layer.move(cam(12, 30, 1));
    expect(vp.promoted()).toBe(true);
    layer.move(cam(12.4, 30, 1));
    expect(vp.promoted()).toBe(false);
  });

  it("never promotes a click that moves nothing, a wheel zoom or a programmatic move", () => {
    const { vp, layer } = setup();
    layer.start({ type: "mousedown" }, 1);
    layer.release({ type: "mouseup" });
    layer.start(null, 1);
    layer.move(cam(5, 5, 1));
    expect(vp.promoted()).toBe(false);
  });

  it("ignores a programmatic start or end inside a press pan", () => {
    const { vp, layer } = setup();
    layer.start({ type: "mousedown" }, 1);
    layer.start(null, 1);
    layer.release(null);
    layer.move(cam(5, 5, 1));
    expect(vp.promoted()).toBe(true);
  });

  it("promotes an app-driven pan through begin", () => {
    const { vp, layer } = setup();
    layer.begin(0.4);
    layer.move(cam(1, 1, 0.4));
    expect(vp.promoted()).toBe(true);
    layer.drop();
    expect(vp.promoted()).toBe(false);
  });

  it("primes at rest, and a press pan then keeps the primed layer", () => {
    const { vp, layer } = setup();
    layer.prime(0.3);
    expect(vp.promoted()).toBe(true);
    layer.start({ type: "touchstart" }, 0.3);
    layer.move(cam(4, 4, 0.3));
    layer.release({ type: "touchend" });
    expect(vp.promoted()).toBe(true);
  });

  it("doesn't prime mid-press or where the gate refuses", () => {
    const { vp, layer } = setup();
    layer.start({ type: "touchstart" }, 1);
    layer.prime(1);
    expect(vp.promoted()).toBe(false);
    const off = fakeViewport();
    createPanLayer(() => off.el, () => false, () => 1).prime(1);
    expect(off.promoted()).toBe(false);
  });

  it("stays off where the gate refuses", () => {
    const vp = fakeViewport();
    const layer = createPanLayer(() => vp.el, () => false, () => 1);
    layer.start({ type: "mousedown" }, 1);
    layer.move(cam(1, 1, 1));
    expect(vp.promoted()).toBe(false);
  });

  it("gates on Chromium, outside the HTML-in-Canvas mode", () => {
    expect(promotesPans(true, "dom")).toBe(true);
    expect(promotesPans(false, "dom")).toBe(false);
    expect(promotesPans(true, "html")).toBe(false);
    expect(isPressPan({ type: "touchstart" })).toBe(true);
    expect(isPressPan({ type: "wheel" })).toBe(false);
  });
});

describe("alignedViewport", () => {
  it("snaps the camera to whole device pixels and leaves an aligned one alone", () => {
    expect(alignedViewport({ x: 37.3, y: 41.7, zoom: 0.5 }, 1)).toEqual({ x: 37, y: 42, zoom: 0.5 });
    expect(alignedViewport({ x: 10.3, y: 0, zoom: 1 }, 1.25)).toEqual({ x: 10.4, y: 0, zoom: 1 });
    expect(alignedViewport({ x: 12, y: -3, zoom: 2 }, 1)).toBeNull();
  });
});
