// [[C43]] oneFlowSurface
import { describe, it, expect } from "vitest";
import { socketLocalCenter } from "../../src/graph/canvasGeometry";
import type { View } from "../../src/graph/view";

type El = { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number; offsetParent: El | null; querySelector?: (s: string) => El | null };

function viewWith(card: El): View {
  return { nodeElement: () => card } as unknown as View;
}

describe("socketLocalCenter", () => {
  it("sums the offset chain up to the card, so the zoom never enters", () => {
    const card: El = { offsetLeft: 999, offsetTop: 999, offsetWidth: 200, offsetHeight: 400, offsetParent: null };
    const row: El = { offsetLeft: 0, offsetTop: 120, offsetWidth: 200, offsetHeight: 24, offsetParent: card };
    const dot: El = { offsetLeft: 194, offsetTop: 7, offsetWidth: 11, offsetHeight: 11, offsetParent: row };
    card.querySelector = () => dot;
    expect(socketLocalCenter(viewWith(card), "n", "out", "output")).toEqual({ x: 199.5, y: 132.5 });
  });

  it("is null when the socket is not drawn, or its chain never reaches the card", () => {
    const card: El = { offsetLeft: 0, offsetTop: 0, offsetWidth: 200, offsetHeight: 400, offsetParent: null, querySelector: () => null };
    expect(socketLocalCenter(viewWith(card), "n", "out", "output")).toBeNull();
    const stray: El = { offsetLeft: 0, offsetTop: 5, offsetWidth: 10, offsetHeight: 10, offsetParent: null };
    card.querySelector = () => stray;
    expect(socketLocalCenter(viewWith(card), "n", "out", "output")).toBeNull();
  });
});
