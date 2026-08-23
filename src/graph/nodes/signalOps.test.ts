import { describe, it, expect } from "vitest";
import { savgol, gaussianSmooth, lowess, findPeaks } from "./signalOps";

// scipy references computed locally 2026-08-23 (savgol_filter mode=interp,
// gaussian_filter1d reflect/truncate 4, find_peaks).
const X = [1, 3, 2, 5, 4, 6, 8, 7, 9, 12, 10, 11];
const close = (got: unknown, want: (number | null)[], digits = 5) => {
  const g = got as (number | null)[];
  expect(g.length).toBe(want.length);
  g.forEach((v, i) => (want[i] === null ? expect(v).toBeNull() : expect(v).toBeCloseTo(want[i] as number, digits)));
};

describe("Savitzky–Golay", () => {
  it("window 5 order 2 / window 7 order 3 match scipy (interp edges)", () => {
    close(savgol(X, 5, 2), [1.114286, 2.342857, 3.285714, 3.714286, 4.857143, 6.0, 7.228571, 7.685714, 9.342857, 10.8, 11.2, 10.6]);
    close(savgol(X, 7, 3), [1.119048, 2.404762, 3.190476, 3.809524, 4.952381, 6.095238, 6.619048, 8.428571, 9.380952, 10.47619, 11.047619, 10.761905]);
  });
  it("a blank stays blank and is left out of its neighbours' fits; an even window is refused", () => {
    const out = savgol([1, 2, null, 4, 5, 6, 7], 3, 1) as (number | null)[];
    expect(out[2]).toBeNull();
    expect(out[3]).toBeCloseTo(4, 6); // linear data, line fit through (4,5) at x=0 → 4
    expect(savgol(X, 4, 2).every((v) => v === null)).toBe(true);
  });
});

describe("Gaussian smoothing", () => {
  it("σ = 1 and σ = 2 match gaussian_filter1d", () => {
    close(gaussianSmooth(X, 1), [1.669012, 2.278785, 3.036109, 3.973424, 4.843028, 5.99597, 7.116009, 7.942147, 9.237138, 10.442966, 10.712619, 10.752794]);
    close(gaussianSmooth(X, 2), [2.331121, 2.667938, 3.280402, 4.085026, 5.011212, 6.008336, 7.037065, 8.054365, 8.991844, 9.75444, 10.266205, 10.512045]);
  });
});

describe("LOWESS", () => {
  it("reproduces a straight line exactly and smooths noise toward it", () => {
    const line = Array.from({ length: 20 }, (_, i) => 2 * i + 1);
    close(lowess(line, 0.5), line, 6);
    const noisy = line.map((v, i) => v + (i % 2 ? 0.8 : -0.8));
    const sm = lowess(noisy, 0.4) as number[];
    const err = (a: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - line[i]) ** 2, 0) / a.length);
    expect(err(sm)).toBeLessThan(err(noisy) / 2);
  });
  it("a single outlier is robustified away (bisquare passes)", () => {
    // a little noise keeps the MAD non-zero (on an EXACT line the classic algorithm stops
    // robustifying, as R's lowess does when cmad vanishes)
    const line = Array.from({ length: 25 }, (_, i) => i + (i % 3 - 1) * 0.1);
    const spiked = [...line]; spiked[12] = 40;
    const sm = lowess(spiked, 0.4) as number[];
    expect(Math.abs(sm[12] - 12)).toBeLessThan(1.5);
    expect(lowess([null, 5, null])).toEqual([null, 5, null]);
  });
});

describe("find_peaks", () => {
  const Y = [0, 1, 0, 2, 0, 3, 2, 3, 0, 5, 4, 0, 1, 1, 1, 0];
  const pos = (ps: { position: number }[]) => ps.map((p) => p.position);
  it("local maxima (plateau counted once at its middle), 1-based", () => {
    expect(pos(findPeaks(Y))).toEqual([2, 4, 6, 8, 10, 14]);
  });
  it("height / distance / prominence filters match scipy", () => {
    expect(pos(findPeaks(Y, { height: 2.5 }))).toEqual([6, 8, 10]);
    expect(pos(findPeaks(Y, { distance: 3 }))).toEqual([2, 6, 10, 14]);
    const pr = findPeaks(Y, { prominence: 2 });
    expect(pos(pr)).toEqual([4, 6, 8, 10]);
    expect(pr.map((p) => p.prominence)).toEqual([2, 3, 3, 5]);
    expect(findPeaks(Y, { prominence: 0 }).map((p) => p.prominence)).toEqual([1, 2, 3, 3, 5, 1]);
  });
});
