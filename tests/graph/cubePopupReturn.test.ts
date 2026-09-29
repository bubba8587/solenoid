// [[D90]] cubeTypesAtDepth
import { describe, it, expect, afterEach } from "vitest";
import { cubePopup, gridPosOf } from "../../src/graph/cubePopupStore";

afterEach(() => cubePopup.close());

describe("returning from a drilled list item", () => {
  it("focuses the item it left, in either list layout", () => {
    cubePopup.open({ kind: "list", label: "L", items: [1, [2], [3]] });
    cubePopup.drill({ kind: "list", label: "item", items: [3] }, { item: 2 });
    cubePopup.backTo(0);
    const focus = cubePopup.get()!.stack[0].focus!;
    expect(gridPosOf(focus, false)).toEqual({ r: 0, c: 2 });
    expect(gridPosOf(focus, true)).toEqual({ r: 2, c: 0 });
  });

  it("a grid cell returns to its own position", () => {
    expect(gridPosOf({ r: 4, c: 1 }, false)).toEqual({ r: 4, c: 1 });
    expect(gridPosOf({ r: 4 }, true)).toEqual({ r: 4 });
  });
});
