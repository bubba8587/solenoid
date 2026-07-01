import { describe, it, expect } from "vitest";
import { buildSyntheticScene, buildLiveScene } from "./pixiScenes";
import type { GraphSnapshot } from "./pixiGraphSnapshot";

// Minimal fake of the bits of pixi.js the scene builders touch — lets us test the
// real scene LOGIC (counts, picking, drag, LOD, cull, selection, groups) in the
// node test env with no GPU/DOM. The builders take the module as a param, so we
// just inject this.
class FContainer {
  x = 0; y = 0; visible = true; children: FContainer[] = [];
  scale = { set: (_: number) => {} };
  position = { set: (x: number, y: number) => { this.x = x; this.y = y; } };
  addChild(...c: FContainer[]) { this.children.push(...c); return c[0]; }
  destroy() {}
}
class FGraphics extends FContainer {
  roundRect() { return this; }
  rect() { return this; }
  fill() { return this; }
  stroke() { return this; }
  circle() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  bezierCurveTo() { return this; }
  poly() { return this; }
  clear() { return this; }
}
class FText { text: string; x = 0; y = 0; visible = true; anchor = { set: (_x: number, _y: number) => {} }; constructor(o: { text: string }) { this.text = o.text; } }
const fakePixi = { Container: FContainer, Graphics: FGraphics, BitmapText: FText, Text: FText } as unknown as typeof import("pixi.js");

describe("buildSyntheticScene", () => {
  it("builds N cards + a populated picker + cables", () => {
    const scene = buildSyntheticScene(fakePixi, 100, "bitmap");
    expect(scene.nodeCount).toBe(100);
    expect(scene.cableCount).toBeGreaterThan(0);
    expect(scene.picker.size()).toBe(100);
    // n5 sits at grid col 5 (cols = ceil(sqrt(100)) = 10) → (5*240, 0).
    expect(scene.picker.pick(5 * 240 + 5, 5)).toBe("n5");
  });

  it("moveCard relocates the card + its pick rect", () => {
    const scene = buildSyntheticScene(fakePixi, 25, "bitmap");
    expect(scene.picker.pick(5, 5)).toBe("n0");
    scene.moveCard("n0", 9999, 9999);
    expect(scene.picker.pick(5, 5)).toBeNull();
    expect(scene.picker.pick(9999 + 5, 9999 + 5)).toBe("n0");
  });

  it("setLod hides per-card detail; setCablesVisible toggles the cable layer", () => {
    const scene = buildSyntheticScene(fakePixi, 10, "bitmap");
    const detail = scene.cards.get("n0")!.detail;
    expect(detail.every((d) => d.visible)).toBe(true);
    scene.setLod(true);
    expect(detail.every((d) => !d.visible)).toBe(true);
    scene.setLod(false);
    expect(detail.every((d) => d.visible)).toBe(true);
    // world children: [cableLayer, cardLayer] → index 0 is the cable layer.
    const cableLayer = (scene.world as unknown as FContainer).children[0];
    scene.setCablesVisible(false);
    expect(cableLayer.visible).toBe(false);
  });

  it("cull hides offscreen cards, null shows all", () => {
    const scene = buildSyntheticScene(fakePixi, 100, "bitmap");
    scene.cull({ minX: -10, minY: -10, maxX: 250, maxY: 200 }); // ~the first card only
    expect(scene.cards.get("n0")!.container.visible).toBe(true);
    expect(scene.cards.get("n99")!.container.visible).toBe(false);
    scene.cull(null);
    expect(scene.cards.get("n99")!.container.visible).toBe(true);
  });
});

describe("buildLiveScene", () => {
  const snap: GraphSnapshot = {
    nodes: [
      { id: "a", x: 0, y: 0, w: 180, h: 70, headerH: 26, accent: 0x112233, body: 0x1b1e25, headerColor: 0x222530, border: 0x112233, borderAlpha: 0.78, texts: [{ text: "A", x: 9, y: 6, w: 0, h: 0, size: 13, color: 0xffffff, mono: false, bold: true, isTitle: true, boxed: false, chevron: false, letterSpacing: 0, boxFill: null, boxBorder: null, align: "left" }], sliders: [], checkboxes: [], decorations: [], images: [], isConduit: false, hasChevron: true, rotation: 0, selected: false, sockets: [{ key: "out", side: "output", x: 180, y: 35, kind: "circle", color: 0x888888, color2: null }] },
      { id: "b", x: 300, y: 0, w: 180, h: 70, headerH: 26, accent: 0x112233, body: 0x1b1e25, headerColor: 0x222530, border: 0x112233, borderAlpha: 0.78, texts: [{ text: "B", x: 309, y: 6, w: 0, h: 0, size: 13, color: 0xffffff, mono: false, bold: true, isTitle: true, boxed: false, chevron: false, letterSpacing: 0, boxFill: null, boxBorder: null, align: "left" }], sliders: [], checkboxes: [], decorations: [], images: [], isConduit: false, hasChevron: true, rotation: 0, selected: true, sockets: [{ key: "in", side: "input", x: 300, y: 35, kind: "circle", color: 0x888888, color2: null }] },
    ],
    groups: [{ id: "g", x: -20, y: -20, w: 520, h: 120, headerH: 34, label: "Group", color: 0x335577, border: 0x224466 }],
    cables: [{ id: "c", source: "a", sourceOutput: "out", target: "b", targetInput: "in", sx: 180, sy: 35, ex: 300, ey: 35, sourceAngleDeg: null, targetAngleDeg: null, color: 0x888888 }],
    standoffs: [],
    transform: { k: 1, x: 0, y: 0 },
  };

  it("renders nodes, the cable, and the group; reflects initial selection", () => {
    const scene = buildLiveScene(fakePixi, snap, "diagonal", "bitmap");
    expect(scene.nodeCount).toBe(2);
    expect(scene.cableCount).toBe(1);
    expect(scene.cards.get("b")!.selG!.visible).toBe(true); // b was selected
    expect(scene.cards.get("a")!.selG!.visible).toBe(false);
    // world children: [standoffLayer, groupLayer, cableLayer, cardLayer].
    const groupLayer = (scene.world as unknown as FContainer).children[1];
    expect(groupLayer.children.length).toBeGreaterThan(0);
  });

  it("dragging a card mutates its sockets (so cables follow)", () => {
    const fresh: GraphSnapshot = JSON.parse(JSON.stringify(snap));
    const scene = buildLiveScene(fakePixi, fresh, "diagonal", "bitmap");
    const aOut = fresh.nodes[0].sockets[0];
    scene.moveCard("a", 50, 80); // dx=50, dy=80
    expect(aOut.x).toBe(230);
    expect(aOut.y).toBe(115);
  });

  it("setSelected drives the highlight", () => {
    const scene = buildLiveScene(fakePixi, snap, "diagonal", "bitmap");
    scene.setSelected(new Set(["a"]));
    expect(scene.cards.get("a")!.selG!.visible).toBe(true);
    expect(scene.cards.get("b")!.selG!.visible).toBe(false);
  });

  it("updates the title text in place (the rename path)", () => {
    const scene = buildLiveScene(fakePixi, snap, "diagonal", "bitmap");
    const tt = scene.cards.get("a")!.titleText!;
    expect(tt.text).toBe("A");
    tt.text = "renamed";
    expect(scene.cards.get("a")!.titleText!.text).toBe("renamed");
  });
});
