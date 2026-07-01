import { describe, it, expect } from "vitest";
import { CardPicker } from "./pixiPicker";

describe("CardPicker", () => {
  it("picks the card containing a point", () => {
    const p = new CardPicker();
    p.build([
      { id: "a", x: 0, y: 0, w: 100, h: 50, order: 0 },
      { id: "b", x: 300, y: 300, w: 100, h: 50, order: 1 },
    ]);
    expect(p.pick(50, 25)).toBe("a");
    expect(p.pick(350, 325)).toBe("b");
    expect(p.pick(200, 200)).toBeNull();
  });

  it("returns the topmost (highest order) on overlap", () => {
    const p = new CardPicker();
    p.build([
      { id: "under", x: 0, y: 0, w: 100, h: 100, order: 0 },
      { id: "over", x: 50, y: 50, w: 100, h: 100, order: 5 },
    ]);
    expect(p.pick(75, 75)).toBe("over"); // inside both → topmost
    expect(p.pick(10, 10)).toBe("under"); // only in the lower one
  });

  it("reflects a moved rect after update()", () => {
    const p = new CardPicker();
    p.build([{ id: "a", x: 0, y: 0, w: 100, h: 50, order: 0 }]);
    expect(p.pick(50, 25)).toBe("a");
    p.update({ id: "a", x: 1000, y: 1000, w: 100, h: 50, order: 0 });
    expect(p.pick(50, 25)).toBeNull();
    expect(p.pick(1050, 1025)).toBe("a");
  });

  it("scales to many cards (grid broad-phase)", () => {
    const p = new CardPicker();
    const rects = [];
    for (let i = 0; i < 5000; i++) rects.push({ id: `n${i}`, x: (i % 100) * 240, y: Math.floor(i / 100) * 150, w: 180, h: 80, order: i });
    p.build(rects);
    expect(p.size()).toBe(5000);
    // Pick a known card by its computed origin.
    expect(p.pick(240 * 3 + 5, 150 * 2 + 5)).toBe(`n${2 * 100 + 3}`);
  });
});
