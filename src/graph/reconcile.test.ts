import { describe, it, expect } from "vitest";
import { reconcileFrames } from "./frameVerbs";
import { solError } from "./errorValue";
import type { FrameValue } from "./frame";

// Regression tests for two audit findings in reconcileFrames (2026-07-05):
//   (a) rows with a blank/errored KEY were silently dropped from output AND counts;
//   (b) the price/volume/mix breakdown read an errored/missing price/qty cell as 0,
//       fabricating a bogus swing.

describe("reconcileFrames — (a) blank/invalid key rows are surfaced, not dropped", () => {
  it("emits a null-key row as 'skipped' and counts it (row total stays honest)", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", null] },
      { name: "qty", type: "number", values: [10, 99] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a"] },
      { name: "qty", type: "number", values: [12] },
    ] };
    const { frame, summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary.skipped).toBe(1);
    const statusCol = frame.columns.find((c) => c.name === "Status")!;
    // 1 matched ('a', changed) + 1 skipped (null key) — nothing lost
    expect(statusCol.values.length).toBe(2);
    expect(statusCol.values.filter((v) => v === "skipped").length).toBe(1);
  });

  it("counts an errored key on either side", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", solError("#REF!", "bad")] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: [null] },
    ] };
    const { summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary.skipped).toBe(2); // errored-left + null-right
  });

  it("a keyless row is NOT miscounted as added/removed/changed/unchanged", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: [null] },
      { name: "v", type: "number", values: [5] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: [] },
      { name: "v", type: "number", values: [] },
    ] };
    const { summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 0, skipped: 1 });
  });
});

describe("reconcileFrames — (b) PVM excludes errored/missing price or qty (never zeroes them)", () => {
  const mk = (rows: [string, number, number][]): FrameValue => ({
    __frame: true,
    columns: [
      { name: "id", type: "string", values: rows.map((r) => r[0]) },
      { name: "price", type: "number", values: rows.map((r) => r[1]) },
      { name: "qty", type: "number", values: rows.map((r) => r[2]) },
    ],
  });
  const pvmOpts = { leftKey: "id", rightKey: "id", priceColumn: "price", qtyColumn: "qty" };

  it("clean rows: price+volume+mix sums exactly to delta, excluded=0", () => {
    const before = mk([["a", 10, 2], ["b", 5, 4]]);
    const after = mk([["a", 12, 2], ["b", 5, 5]]);
    const p = reconcileFrames(before, after, pvmOpts).summary.pvm!;
    expect(p.excluded).toBe(0);
    expect(p.delta).toBeCloseTo(9, 9); // (12·2+5·5) − (10·2+5·4) = 49 − 40
    expect(p.price + p.volume + p.mix).toBeCloseTo(p.delta, 9);
  });

  it("a matched row with an errored after-price is EXCLUDED, not read as a $0 price", () => {
    const before = mk([["a", 10, 2], ["b", 5, 4]]);
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", "b"] },
      { name: "price", type: "number", values: [solError("#REF!", "x"), 5] },
      { name: "qty", type: "number", values: [2, 5] },
    ] };
    const p = reconcileFrames(before, after, pvmOpts).summary.pvm!;
    expect(p.excluded).toBe(1);        // the 'a' row can't be decomposed
    expect(p.delta).toBeCloseTo(5, 9); // only 'b': 5·5 − 5·4
    expect(p.price + p.volume + p.mix).toBeCloseTo(p.delta, 9);
    // the OLD bug read the errored price as 0 → a −20 price swing on 'a'. Gone now:
    expect(p.price).toBeCloseTo(0, 9);
  });

  it("a matched row with a missing (null) qty is excluded", () => {
    const before = mk([["a", 10, 2]]);
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a"] },
      { name: "price", type: "number", values: [12] },
      { name: "qty", type: "number", values: [null] },
    ] };
    const p = reconcileFrames(before, after, pvmOpts).summary.pvm!;
    expect(p.excluded).toBe(1);
    expect(p.delta).toBeCloseTo(0, 9); // nothing decomposable
  });

  it("an ADDED row keeps the structural-0 convention (not excluded), landing in mix", () => {
    const before = mk([["a", 10, 2]]);
    const after = mk([["a", 10, 2], ["b", 3, 4]]); // 'b' is brand new
    const p = reconcileFrames(before, after, pvmOpts).summary.pvm!;
    expect(p.excluded).toBe(0);       // a new row's 0-before is real, not unknown
    expect(p.delta).toBeCloseTo(12, 9);
    expect(p.mix).toBeCloseTo(12, 9); // whole new-row value lands in mix
    expect(p.price + p.volume + p.mix).toBeCloseTo(p.delta, 9);
  });
});
