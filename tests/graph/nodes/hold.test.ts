// [[C23]] calcModes
import { describe, it, expect } from "vitest";
import { HoldNode } from "../../../src/graph/nodes/control";
import { extractInit } from "../../../src/graph/nodeInit";
import { solError, isSolError } from "../../../src/graph/errorValue";
import type { FrameValue } from "../../../src/graph/frame";
import { throughBoundary } from "../boundaryKit";

const frame = (xs: number[]): FrameValue => ({ __frame: true, columns: [{ name: "x", type: "number", values: xs }] });

describe("Hold (HoldNode)", () => {
  it("Live passes the input on and never reads as changed", () => {
    const n = new HoldNode();
    expect(n.data({ in: [5] })).toEqual({ out: 5, changed: false });
    expect(n.cachedLive).toBe(5);
  });

  it("Held keeps the captured value while the input moves, and Changed follows", () => {
    const n = new HoldNode();
    n.data({ in: [5] });
    expect(n.capture(n.cachedLive)).toBe(true);
    expect(n.mode).toBe("held");
    expect(n.data({ in: [5] })).toEqual({ out: 5, changed: false });
    expect(n.data({ in: [9] })).toEqual({ out: 5, changed: true });
    expect(n.cachedLive).toBe(9);
  });

  it("Recapture takes the input as it is now", () => {
    const n = new HoldNode();
    n.capture(1);
    n.data({ in: [2] });
    n.capture(n.cachedLive);
    expect(n.data({ in: [2] })).toEqual({ out: 2, changed: false });
  });

  it("Live after Held drops the held value", () => {
    const n = new HoldNode();
    n.capture(1);
    n.release();
    expect(n.heldText).toBe("");
    expect(n.data({ in: [3] }).out).toBe(3);
  });

  it("holds lists, text, logicals and blanks", () => {
    for (const v of [[1, 2, 3], "abc", true, null]) {
      const n = new HoldNode();
      n.capture(v);
      expect(n.data({ in: [7] }).out).toEqual(v);
    }
  });

  it("holds a Frame, and compares it by content", () => {
    const n = new HoldNode();
    n.capture(frame([1, 2]));
    const r = n.data({ in: [frame([1, 2])] });
    expect((r.out as FrameValue).columns[0].values).toEqual([1, 2]);
    expect(r.changed).toBe(false);
    expect(n.data({ in: [frame([1, 3])] }).changed).toBe(true);
  });

  it("an upstream error doesn't reach a held value, and an error can itself be held", () => {
    const n = new HoldNode();
    n.capture(4);
    throughBoundary(n);
    const r = n.data({ in: [solError("#DIV/0!", "boom")] });
    expect(r.out).toBe(4);
    expect(r.changed).toBe(true);
    const e = new HoldNode();
    e.capture(solError("#N/A", "missing"));
    const out = e.data({ in: [1] }).out;
    expect(isSolError(out) && out.code).toBe("#N/A");
  });

  it("the held value survives a save and reload", () => {
    const n = new HoldNode({ label: "Baseline" });
    n.capture([10, 20]);
    const init = extractInit(n) as { mode: string; heldText: string; label: string };
    expect(init.mode).toBe("held");
    const back = new HoldNode(init as ConstructorParameters<typeof HoldNode>[0]);
    expect(back.data({ in: [0] }).out).toEqual([10, 20]);
  });
});
