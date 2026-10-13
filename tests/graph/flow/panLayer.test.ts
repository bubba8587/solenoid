// [[C120]] linearWork
import { describe, expect, it } from "vitest";
import { alignedViewport, createPanLayer, isPressPan, promotesPans } from "../../../src/graph/flow/panLayer";

const fakeViewport = () => {
  const classes = new Set<string>();
  const el = { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } as unknown as HTMLElement;
  return { el, promoted: () => classes.has("sol-pan-layer") };
};

describe("pan layer", () => {
  it("promotes on the first move of a press pan and demotes at its end", () => {
    const vp = fakeViewport();
    const layer = createPanLayer(() => vp.el, () => true);
    layer.start({ type: "mousedown" }, 0.5);
    expect(vp.promoted()).toBe(false);
    layer.move(0.5);
    expect(vp.promoted()).toBe(true);
    layer.move(0.5);
    layer.end();
    expect(vp.promoted()).toBe(false);
  });

  it("never promotes a click that moves nothing, a wheel zoom or a programmatic move", () => {
    const vp = fakeViewport();
    const layer = createPanLayer(() => vp.el, () => true);
    layer.start({ type: "mousedown" }, 1);
    layer.end();
    layer.start(null, 1);
    layer.move(1);
    expect(vp.promoted()).toBe(false);
  });

  it("drops the layer for the rest of the gesture once the zoom moves", () => {
    const vp = fakeViewport();
    const layer = createPanLayer(() => vp.el, () => true);
    layer.start({ type: "pointerdown" }, 1);
    layer.move(1);
    layer.move(1.1);
    expect(vp.promoted()).toBe(false);
    layer.move(1.1);
    expect(vp.promoted()).toBe(false);
  });

  it("stays off where the gate refuses", () => {
    const vp = fakeViewport();
    const layer = createPanLayer(() => vp.el, () => false);
    layer.start({ type: "mousedown" }, 1);
    layer.move(1);
    expect(vp.promoted()).toBe(false);
  });

  it("gates on Chromium with a fine pointer, outside the HTML-in-Canvas mode", () => {
    expect(promotesPans(false, true, "dom")).toBe(true);
    expect(promotesPans(true, true, "dom")).toBe(false);
    expect(promotesPans(false, false, "dom")).toBe(false);
    expect(promotesPans(false, true, "html")).toBe(false);
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

describe("pan layer and programmatic moves", () => {
  it("keeps the layer through a programmatic move inside the pan", () => {
    const vp = fakeViewport();
    const layer = createPanLayer(() => vp.el, () => true);
    layer.start({ type: "mousedown" }, 1);
    layer.start(null, 1);
    layer.end(null);
    layer.move(1);
    expect(vp.promoted()).toBe(true);
    layer.end({ type: "mouseup" });
    expect(vp.promoted()).toBe(false);
  });
});
