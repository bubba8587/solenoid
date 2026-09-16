import { describe, it, expect } from "vitest";
import { scrollsInDirection } from "../../src/graph/flow/flowWheel";
import { frameSize } from "../../src/graph/zoomAt";

describe("surface review pins", () => {
  it("a .nowheel body that cannot scroll lets the wheel zoom through; a scrolling one keeps it", () => {
    const body = { scrollHeight: 400, clientHeight: 400, scrollWidth: 200, clientWidth: 200, parentElement: null };
    const inner = { scrollHeight: 100, clientHeight: 100, scrollWidth: 100, clientWidth: 100, parentElement: body };
    expect(scrollsInDirection(inner, body, 0, 10)).toBe(false);
    const tall = { ...body, scrollHeight: 900 };
    const inner2 = { ...inner, parentElement: tall };
    expect(scrollsInDirection(inner2, tall, 0, 10)).toBe(true);
    expect(scrollsInDirection(inner2, tall, 10, 0)).toBe(false); // horizontal: nothing to scroll
  });

  it("zoom framing takes RF's measure before the declared class size", () => {
    const node = { id: "n", width: 240, height: 320 };
    const measured = frameSize({ measured: () => ({ w: 240, h: 36 }), nodeElement: () => null }, node);
    expect(measured).toEqual({ width: 240, height: 36 }); // collapsed: the measure wins
    const declared = frameSize({ measured: () => undefined, nodeElement: () => null }, node);
    expect(declared).toEqual({ width: 240, height: 320 });
  });
});
