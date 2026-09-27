// [[C114]] cardsView
import { describe, it, expect } from "vitest";
import { freeSpotRightOf } from "../../src/graph/recordCardsFromPopup";

describe("freeSpotRightOf: where Add Record: Cards puts the new node", () => {
  const host = { x: 0, y: 0, w: 240, h: 200 };
  it("sits right of the host when that spot is clear", () => {
    expect(freeSpotRightOf(host, [host])).toEqual({ x: 320, y: 0 });
  });
  it("steps down past a card in the way, then over a column when the column is full", () => {
    const blocker = { x: 320, y: 0, w: 240, h: 300 };
    expect(freeSpotRightOf(host, [host, blocker])).toEqual({ x: 320, y: 320 });
    const wall = { x: 320, y: -100, w: 240, h: 5000 };
    expect(freeSpotRightOf(host, [host, wall])).toEqual({ x: 640, y: 0 });
  });
});
