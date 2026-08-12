import { describe, expect, it } from "vitest";
import { ATLAS_GUTTER, packAtlas } from "./rasterAtlas";

describe("packAtlas", () => {
  it("returns empty layout for no items", () => {
    const l = packAtlas([], 512, 512);
    expect(l.placements).toEqual([]);
    expect(l.unplaced).toEqual([]);
    expect(l.usedW).toBe(0);
    expect(l.usedH).toBe(0);
  });

  it("places a single item at origin, unscaled", () => {
    const l = packAtlas([{ id: "a", w: 100, h: 50 }], 512, 512);
    expect(l.placements).toEqual([{ id: "a", x: 0, y: 0, w: 100, h: 50, scale: 1 }]);
    expect(l.usedW).toBe(100);
    expect(l.usedH).toBe(50);
  });

  it("packs a row left-to-right with the gutter, then wraps to a new shelf", () => {
    const items = [
      { id: "a", w: 200, h: 40 },
      { id: "b", w: 200, h: 40 },
      { id: "c", w: 200, h: 40 },
    ];
    const l = packAtlas(items, 450, 512); // two fit per shelf (200+2+200=402), third wraps
    expect(l.placements).toHaveLength(3);
    const by = new Map(l.placements.map((p) => [p.id, p]));
    expect(by.get("a")).toMatchObject({ x: 0, y: 0 });
    expect(by.get("b")).toMatchObject({ x: 200 + ATLAS_GUTTER, y: 0 });
    expect(by.get("c")).toMatchObject({ x: 0, y: 40 + ATLAS_GUTTER });
    expect(l.usedH).toBe(40 + ATLAS_GUTTER + 40);
  });

  it("sorts tallest-first so shelves stay dense", () => {
    const l = packAtlas(
      [
        { id: "short", w: 50, h: 10 },
        { id: "tall", w: 50, h: 100 },
      ],
      512,
      512,
    );
    // tall placed first (x=0), short beside it on the same shelf
    const by = new Map(l.placements.map((p) => [p.id, p]));
    expect(by.get("tall")).toMatchObject({ x: 0, y: 0 });
    expect(by.get("short")).toMatchObject({ x: 50 + ATLAS_GUTTER, y: 0 });
  });

  it("scales an item that outsizes the atlas to fit alone", () => {
    const l = packAtlas([{ id: "big", w: 2000, h: 500 }], 1000, 1000);
    const p = l.placements[0];
    expect(p.scale).toBeCloseTo(0.5);
    expect(p.w).toBe(1000);
    expect(p.h).toBe(250);
    expect(l.unplaced).toEqual([]);
  });

  it("reports items that do not fit this round as unplaced", () => {
    const items = [
      { id: "a", w: 100, h: 100 },
      { id: "b", w: 100, h: 100 },
      { id: "c", w: 100, h: 100 },
    ];
    // one shelf of one item; the others exceed maxH on wrap
    const l = packAtlas(items, 100, 100);
    expect(l.placements).toHaveLength(1);
    expect(l.unplaced.sort()).toEqual(["b", "c"]);
  });

  it("degenerate atlas → everything unplaced", () => {
    const l = packAtlas([{ id: "a", w: 10, h: 10 }], 0, 0);
    expect(l.placements).toEqual([]);
    expect(l.unplaced).toEqual(["a"]);
  });

  it("placements never overlap and never exceed the atlas", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      w: 30 + ((i * 37) % 170),
      h: 20 + ((i * 53) % 120),
    }));
    const l = packAtlas(items, 480, 480);
    for (const p of l.placements) {
      expect(p.x + p.w).toBeLessThanOrEqual(480);
      expect(p.y + p.h).toBeLessThanOrEqual(480);
    }
    for (let i = 0; i < l.placements.length; i++) {
      for (let j = i + 1; j < l.placements.length; j++) {
        const a = l.placements[i], b = l.placements[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
    expect(l.placements.length + l.unplaced.length).toBe(items.length);
  });
});
