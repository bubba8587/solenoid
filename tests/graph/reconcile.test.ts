// [[C45]], [[C130]], [[C24]]
import { describe, it, expect } from "vitest";
import { reconcileFrames } from "./coreVerbs";
import { solError, isSolError } from "../../src/graph/errorValue";
import { ReconcileNode } from "../../src/graph/nodes/frame";
import type { FrameValue } from "../../src/graph/frame";

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

  it("skips a non-finite number key instead of dropping it", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "number", values: [1, NaN, Infinity] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "number", values: [1, -Infinity] },
    ] };
    const { frame, summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary).toMatchObject({ unchanged: 1, skipped: 3 });
    expect(frame.columns.find((c) => c.name === "Status")!.values).toHaveLength(4);
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

describe("reconcileFrames — (c) one-sided columns are surfaced, not silently ignored", () => {
  it("reports a left-only column as removed and carries its before-values", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", "b"] },
      { name: "qty", type: "number", values: [10, 20] },
      { name: "region", type: "string", values: ["N", "S"] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", "b"] },
      { name: "qty", type: "number", values: [10, 25] },
    ] };
    const { frame, summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary.removedColumns).toEqual(["region"]);
    expect(summary.addedColumns).toEqual([]);
    // A one-sided column does NOT change row status — 'a' is still unchanged (only the
    // shared 'qty' drives it), 'b' changed on qty.
    expect(summary).toMatchObject({ unchanged: 1, changed: 1 });
    const removedCol = frame.columns.find((c) => c.name === "region (removed)")!;
    expect(removedCol.values).toEqual(["N", "S"]);
  });

  it("reports a right-only column as added and carries its after-values", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a"] },
      { name: "qty", type: "number", values: [10] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a"] },
      { name: "qty", type: "number", values: [10] },
      { name: "segment", type: "string", values: ["X"] },
    ] };
    const { frame, summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary.addedColumns).toEqual(["segment"]);
    expect(summary.removedColumns).toEqual([]);
    expect(frame.columns.find((c) => c.name === "segment (added)")!.values).toEqual(["X"]);
  });

  it("a renamed column shows as removed+added (data reads unchanged, schema change visible)", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", "b"] },
      { name: "qty", type: "number", values: [10, 20] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", "b"] },
      { name: "quantity", type: "number", values: [10, 20] },
    ] };
    const { summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary.removedColumns).toEqual(["qty"]);
    expect(summary.addedColumns).toEqual(["quantity"]);
    // No SHARED non-key column, so every matched row reads unchanged — but the rename is
    // no longer hidden: it's in added/removed columns.
    expect(summary).toMatchObject({ unchanged: 2, changed: 0 });
  });

  it("a removed column's cells align to added/removed rows (null where the left row is absent)", () => {
    const before: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a"] },
      { name: "region", type: "string", values: ["N"] },
      { name: "v", type: "number", values: [1] },
    ] };
    const after: FrameValue = { __frame: true, columns: [
      { name: "id", type: "string", values: ["a", "b"] },
      { name: "v", type: "number", values: [1, 2] },
    ] };
    const { frame, summary } = reconcileFrames(before, after, { leftKey: "id", rightKey: "id" });
    expect(summary).toMatchObject({ unchanged: 1, added: 1, removedColumns: ["region"] });
    const statusCol = frame.columns.find((c) => c.name === "Status")!;
    const removedCol = frame.columns.find((c) => c.name === "region (removed)")!;
    // Row 'a' (matched) keeps its region; row 'b' (added — no left row) is null.
    expect(statusCol.values).toEqual(["unchanged", "added"]);
    expect(removedCol.values).toEqual(["N", null]);
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

describe("the Reconcile card", () => {
  const mk = (rows: [string | null, number | null, number | null][], extra?: { name: string; values: (string | null)[] }): FrameValue => ({
    __frame: true,
    columns: [
      { name: "id", type: "string", values: rows.map((r) => r[0]) },
      { name: "price", type: "number", values: rows.map((r) => r[1]) },
      { name: "qty", type: "number", values: rows.map((r) => r[2]) },
      ...(extra ? [{ name: extra.name, type: "string" as const, values: extra.values }] : []),
    ],
  });
  const card = (key: string, price = "", qty = "") => {
    const n = new ReconcileNode();
    n.stringLiterals = { key, priceColumn: price, qtyColumn: qty };
    return n;
  };

  it("reconciles by its key and sums up the rows as text", () => {
    const before = mk([["a", 10, 2], ["b", 5, 4], ["c", 1, 1]]);
    const after = mk([["a", 12, 2], ["b", 5, 4], ["d", 3, 3]]);
    const n = card("id");
    const out = n.data({ left: [before], right: [after] });
    expect(out.summary).toBe("**1** added · **1** removed · **1** changed · **1** unchanged");
    expect(n.cachedResult).toBe(out.frame);
  });

  it("breaks the change into price, volume and mix when it names both columns", () => {
    const before = mk([["a", 10, 2], ["b", 5, 4], ["x", 2.5, 3]]);
    const after = mk([["a", 12.25, 2], ["b", 5, 5], ["y", 1234.5, 1000]]);
    const out = card("id", "price", "qty").data({ left: [before], right: [after] });
    expect(out.summary).toContain("**Δ +");
    const blank = card(" id ", " price ", " qty ").data({ left: [mk([["a", 10, 2], ["b", null, 1]])], right: [mk([["a", 9, 3], ["b", 4, 1]])] });
    expect(blank.summary).toContain("_PVM excludes 1 row with blank or errored price or qty._");
  });

  it("names the columns only one side has, and counts a keyless row as skipped", () => {
    const before = mk([["a", 1, 1], [null, 2, 2]], { name: "old", values: ["p", "q"] });
    const after = mk([["a", 1, 1]], { name: "new", values: ["r"] });
    const out = card("id").data({ left: [before], right: [after] });
    expect(out.summary).toContain("**1** skipped");
    expect(out.summary).toContain("_Columns: +new · −old._");
  });

  it("answers an error for a key column the frames lack, and blank without a key or a frame", () => {
    const f = mk([["a", 1, 1]]);
    expect(isSolError(card("nope").data({ left: [f], right: [f] }).frame)).toBe(true);
    expect(card("").data({ left: [f], right: [f] }).frame).toBeNull();
    expect(card("id").data({ left: [f], right: [null] }).frame).toBeNull();
  });
});
