import { describe, it, expect } from "vitest";
import { cardParts, distributeSockets, cardsBounds, rectIntersects, wrapText, CARD } from "./pixiCardLayout";

describe("cardParts", () => {
  it("splits a card into header + body with text anchors", () => {
    const p = cardParts(180, 80, 26);
    expect(p.header).toEqual({ x: 0, y: 0, w: 180, h: 26 });
    expect(p.body).toEqual({ x: 0, y: 26, w: 180, h: 54 });
    expect(p.title).toEqual({ x: CARD.bodyPad, y: CARD.titleTop });
    expect(p.value).toEqual({ x: CARD.bodyPad, y: 26 + CARD.valueTopInBody });
  });

  it("never produces a negative body height", () => {
    const p = cardParts(180, 10, 26);
    expect(p.body.h).toBe(0);
  });
});

describe("distributeSockets", () => {
  it("centers a single socket", () => {
    expect(distributeSockets(1, 0, 100)).toEqual([50]);
  });
  it("evenly spaces multiple sockets with equal gaps", () => {
    expect(distributeSockets(3, 0, 100)).toEqual([25, 50, 75]);
  });
  it("returns empty for zero/negative", () => {
    expect(distributeSockets(0, 0, 100)).toEqual([]);
    expect(distributeSockets(-2, 0, 100)).toEqual([]);
  });
});

describe("wrapText", () => {
  it("returns the text unchanged when it fits", () => {
    expect(wrapText("hello", 10)).toEqual(["hello"]);
  });
  it("wraps on word boundaries", () => {
    expect(wrapText("the quick brown fox", 10)).toEqual(["the quick", "brown fox"]);
  });
  it("hard-splits a word longer than the line", () => {
    const r = wrapText("supercalifragilistic", 8);
    expect(r.every((l) => l.length <= 8)).toBe(true);
    expect(r.join("")).toBe("supercalifragilistic");
  });
});

describe("rectIntersects", () => {
  const view = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  it("overlapping card intersects", () => {
    expect(rectIntersects({ x: 50, y: 50, w: 100, h: 100 }, view)).toBe(true);
  });
  it("fully-inside card intersects", () => {
    expect(rectIntersects({ x: 10, y: 10, w: 20, h: 20 }, view)).toBe(true);
  });
  it("offscreen card does not intersect", () => {
    expect(rectIntersects({ x: 200, y: 200, w: 20, h: 20 }, view)).toBe(false);
    expect(rectIntersects({ x: -50, y: 0, w: 20, h: 20 }, view)).toBe(false);
  });
});

describe("cardsBounds", () => {
  it("computes the union bbox", () => {
    const b = cardsBounds([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 200, y: 100, w: 80, h: 40 },
    ]);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 280, maxY: 140 });
  });
  it("degrades to a zero-area box when empty", () => {
    expect(cardsBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
