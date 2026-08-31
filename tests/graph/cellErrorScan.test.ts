import { describe, it, expect } from "vitest";
import {
  solError,
  findCellError,
  sampledCellIndices,
  CELL_SCAN_HEAD,
  CELL_SCAN_STRIDE_SAMPLES,
} from "../../src/graph/errorValue";

// Task 1 (Stream D): the bounded per-cell error scan that lets the Problems
// panel + model fuzzer see an error INSIDE a list/matrix/frame, not only a
// top-level scalar failure — while capping the work per pass (full scans were
// rejected on perf).

describe("sampledCellIndices — the bound", () => {
  it("returns every index when the container fits in the head", () => {
    expect(sampledCellIndices(0)).toEqual([]);
    expect(sampledCellIndices(3)).toEqual([0, 1, 2]);
    expect(sampledCellIndices(CELL_SCAN_HEAD)).toHaveLength(CELL_SCAN_HEAD);
  });

  it("caps a huge container at head + stride samples", () => {
    const idx = sampledCellIndices(1_000_000);
    // Head is examined in full; the tail contributes at most STRIDE_SAMPLES more.
    expect(idx.length).toBeLessThanOrEqual(CELL_SCAN_HEAD + CELL_SCAN_STRIDE_SAMPLES + 1);
    // The head is always covered.
    expect(idx.slice(0, CELL_SCAN_HEAD)).toEqual(
      Array.from({ length: CELL_SCAN_HEAD }, (_, i) => i),
    );
    // Strictly increasing.
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});

describe("findCellError", () => {
  const err = solError("#DIV/0!", "boom");

  it("finds a top-level scalar error (unchanged behavior)", () => {
    expect(findCellError(err)).toBe(err);
    expect(findCellError(42)).toBeNull();
    expect(findCellError(null)).toBeNull();
  });

  it("finds a per-cell error inside a list", () => {
    expect(findCellError([1, 2, err, 4])).toBe(err);
    expect(findCellError([1, 2, 3, null])).toBeNull(); // a missing is NOT an error
  });

  it("finds a per-cell error inside a matrix (nested rows)", () => {
    expect(findCellError([[1, 2], [3, err]])).toBe(err);
  });

  it("finds a per-cell error inside a frame column", () => {
    const frame = { __frame: true, columns: [
      { values: [1, 2, 3] },
      { values: [4, err, 6] },
    ] };
    expect(findCellError(frame)).toBe(err);
  });

  it("catches a WHOLE-COLUMN (systematic) error even in a huge list", () => {
    // A bad transform applied to every row — the common case — is always caught
    // because the head is scanned in full.
    const big = Array.from({ length: 100_000 }, () => err);
    expect(findCellError(big)).toBe(err);
  });

  it("is a BOUNDED scan: a lone error buried past the head between strides is missed", () => {
    // This documents the accepted cost of the cap. Index 100 sits after the head
    // (64) and before the first tail stride, so it is not sampled.
    const idx = sampledCellIndices(100_000);
    expect(idx).not.toContain(100);
    const big: unknown[] = Array.from({ length: 100_000 }, () => 0);
    big[100] = err;
    expect(findCellError(big)).toBeNull();
    // But an error at a sampled index (in the head) is caught.
    big[10] = err;
    expect(findCellError(big)).toBe(err);
  });
});
