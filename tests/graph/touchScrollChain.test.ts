// [[B11]] maximalMerge
import { describe, it, expect } from "vitest";
import { scrollRoom } from "../../src/graph/touchScrollChain";

describe("scrollRoom: what an inner scroller can still take of a swipe", () => {
  const el = (scrollTop: number) => ({ scrollTop, scrollHeight: 300, clientHeight: 100 });
  it("takes all of it with room to spare", () => {
    expect(scrollRoom(el(50), 40)).toBe(40);
    expect(scrollRoom(el(50), -40)).toBe(-40);
  });
  it("takes only up to its end, so the rest spills to the outer scroller", () => {
    expect(scrollRoom(el(180), 40)).toBe(20);
    expect(scrollRoom(el(10), -40)).toBe(-10);
  });
  it("takes none at its end", () => {
    expect(scrollRoom(el(200), 40)).toBe(0);
    expect(scrollRoom(el(0), -40)).toBe(-0);
  });
});
